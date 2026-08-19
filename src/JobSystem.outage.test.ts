// Queued farm work must survive the command lane going down.
//
// Online, the farm document is the server's. `apply` therefore refuses to mutate a plot
// while the command lane is paused — otherwise it produces work the server never hears
// about, which the next reconcile erases. That refusal used to be a bare early return
// with `update` finishing the job regardless, so every plot the farmer reached during an
// outage was silently consumed: the player watched the farmer walk the row and came back
// to holes in it, with no error anywhere. That is the "drag-plowing skips plots" report.
//
// The jobs now WAIT. These tests pin that they are neither applied nor lost, and that
// they resume on their own once the lane is back.
import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { JobSystem } from "./JobSystem";

class FakeWalk {
  moving = false;
  private remaining = 0;
  private onArrive: (() => void) | null = null;
  readonly arrivals: number[] = [];

  goToPoint(x: number, _y: number, onArrive?: () => void) {
    this.moving = true;
    this.remaining = 0.1;
    this.onArrive = onArrive ?? null;
    this.arrivals.push(x);
    return true;
  }

  update(dt: number) {
    if (!this.moving) return;
    this.remaining -= dt;
    if (this.remaining > 0) return;
    this.moving = false;
    const callback = this.onArrive;
    this.onArrive = null;
    callback?.();
  }
}

/** An ONLINE farm (`onFarm` set) whose command lane can be switched off, matching
 *  main.ts's `state.canMutateOnline = () => economy.available`. */
function onlineFarm(options: { fastWork?: boolean } = {}) {
  const tilled: string[] = [];
  const sent: string[] = [];
  const lane = { up: true };
  const field = {
    highlightLayer: new Container(),
    plowHighlightLayer: new Container(),
    labelLayer: new Container(),
    resolveTill: (col: number, row: number) => ({ valid: true, oc: col, or: row }),
    reserveTill: () => {},
    unreserveTill: () => {},
    plotCenterOf: (col: number, row: number) => ({ x: col, y: row }),
    hasFastWork: () => !!options.fastWork,
    hasPlowFree: () => false,
    tillAt: (col: number, row: number) => { tilled.push(`${col},${row}`); return true; },
  };
  const state = {
    gold: 100_000,
    spendGold: () => {},
    addXp: () => {},
    // Lifetime tally (GameState.record*): counted on every applied job.
    recordPlowed: () => {}, recordPlanted: () => {}, recordHarvest: () => {}, recordTreeHarvest: () => {},
    onFarm: (action: { type: string; oc: number; or: number }) => {
      sent.push(`${action.type}:${action.oc},${action.or}`);
    },
    onTreeHarvest: null,
    canMutateOnline: () => lane.up,
  };
  const jobs = new JobSystem(
    field as never,
    { setWorking: () => {} } as never,
    new FakeWalk() as never,
    state as never,
    () => {},
  );
  return { jobs, field, lane, tilled, sent };
}

describe("queued farm work waits out a command-lane outage", () => {
  it("does not consume plow jobs the server cannot be told about", () => {
    const farm = onlineFarm();
    expect(farm.jobs.enqueue("till", 10, 10)).toBe(true);
    expect(farm.jobs.enqueue("till", 20, 20)).toBe(true);

    farm.lane.up = false;
    farm.jobs.advanceElapsed(60); // a full minute of farming with the lane down

    expect(farm.tilled).toEqual([]);
    expect(farm.sent).toEqual([]);
    expect(farm.jobs.busy).toBe(true); // still queued, not quietly dropped
  });

  it("finishes every held job once the lane comes back", () => {
    const farm = onlineFarm();
    farm.jobs.enqueue("till", 10, 10);
    farm.jobs.enqueue("till", 20, 20);

    farm.lane.up = false;
    farm.jobs.advanceElapsed(60);
    farm.lane.up = true;
    farm.jobs.advanceElapsed(60);

    expect(farm.tilled).toEqual(["10,10", "20,20"]);
    expect(farm.sent).toEqual(["plow:10,10", "plow:20,20"]);
    expect(farm.jobs.busy).toBe(false);
  });

  it("holds a job the lane loses mid-swing rather than eating it", () => {
    // The lane can drop between the farmer starting the hoe animation and finishing it.
    // That job is already active, so the queue-head guard cannot catch it — `apply`
    // refuses at the payoff and the job goes back to the head of the queue.
    const farm = onlineFarm();
    farm.jobs.enqueue("till", 10, 10);
    farm.jobs.advanceElapsed(0.2); // walk there and begin working
    farm.lane.up = false;
    farm.jobs.advanceElapsed(10); // the work timer runs out with the lane down

    expect(farm.tilled).toEqual([]);
    expect(farm.jobs.busy).toBe(true);

    farm.lane.up = true;
    farm.jobs.advanceElapsed(10);
    expect(farm.tilled).toEqual(["10,10"]);
  });

  it("holds instant work too (Speed Monolith applies on arrival)", () => {
    const farm = onlineFarm({ fastWork: true });
    farm.jobs.enqueue("till", 10, 10);

    farm.lane.up = false;
    farm.jobs.advanceElapsed(10);
    expect(farm.tilled).toEqual([]);
    expect(farm.jobs.busy).toBe(true);

    farm.lane.up = true;
    farm.jobs.advanceElapsed(10);
    expect(farm.tilled).toEqual(["10,10"]);
    expect(farm.jobs.busy).toBe(false);
  });

  it("leaves the catch-up loop instead of grinding through the whole outage", () => {
    // advanceElapsed steps in 50 ms slices. A tab left overnight behind a dead lane
    // would otherwise run hundreds of thousands of no-op iterations on the way back.
    const farm = onlineFarm();
    farm.jobs.enqueue("till", 10, 10);
    farm.lane.up = false;

    const started = Date.now();
    farm.jobs.advanceElapsed(8 * 60 * 60); // eight hours
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("still runs an OFFLINE farm with no command lane at all", () => {
    // canMutateOnline is null offline, and onFarm is null: nothing to block on.
    const tilled: string[] = [];
    const field = {
      highlightLayer: new Container(),
      plowHighlightLayer: new Container(),
      labelLayer: new Container(),
      resolveTill: (col: number, row: number) => ({ valid: true, oc: col, or: row }),
      reserveTill: () => {},
      unreserveTill: () => {},
      plotCenterOf: (col: number, row: number) => ({ x: col, y: row }),
      hasFastWork: () => false,
      hasPlowFree: () => false,
      tillAt: (col: number, row: number) => { tilled.push(`${col},${row}`); return true; },
    };
    const state = {
      gold: 100_000, spendGold: () => {}, addXp: () => {},
      recordPlowed: () => {}, recordPlanted: () => {}, recordHarvest: () => {}, recordTreeHarvest: () => {},
      onFarm: null, onTreeHarvest: null, canMutateOnline: null,
    };
    const jobs = new JobSystem(
      field as never, { setWorking: () => {} } as never, new FakeWalk() as never,
      state as never, () => {},
    );
    jobs.enqueue("till", 10, 10);
    jobs.advanceElapsed(10);
    expect(tilled).toEqual(["10,10"]);
  });
});
