import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("JobSystem elapsed-time catch-up", () => {
  afterEach(() => vi.useRealTimers());

  it("crosses movement callbacks and completes multiple queued jobs", () => {
    const walk = new FakeWalk();
    const jobs = new JobSystem(
      {} as never,
      {} as never,
      walk as never,
      {} as never,
      () => {},
    );

    jobs.enqueueWalk(10, 10);
    jobs.enqueueWalk(20, 20);
    jobs.advanceElapsed(1);

    expect(walk.arrivals).toEqual([10, 20]);
    expect(walk.moving).toBe(false);
    expect(jobs.busy).toBe(false);
  });

  it("reports whether a restore was accepted, so a refused journal can be retried", () => {
    const walk = new FakeWalk();
    const jobs = new JobSystem(
      {} as never, {} as never, walk as never, {} as never, () => {},
    );
    const save = { savedAt: 1, jobs: [{ kind: "walk" as const, oc: -1, or: -1, cx: 10, cy: 10 }] };

    jobs.enqueueWalk(5, 5); // a tap that landed before the journal could be replayed
    expect(jobs.busy).toBe(true);
    expect(jobs.restorePending(save, () => undefined)).toBe(false);

    jobs.advanceElapsed(1); // the live job finishes and the queue drains
    expect(walk.arrivals).toEqual([5]); // the refused journal queued nothing
    expect(jobs.busy).toBe(false);

    // The retry is accepted and replays the journal from its own elapsed time.
    expect(jobs.restorePending(save, () => undefined)).toBe(true);
    expect(walk.arrivals).toEqual([5, 10]);

    // An unusable save is consumed rather than retried forever.
    expect(jobs.restorePending(undefined, () => undefined)).toBe(true);
  });

  it("consumes walking and work time across multiple farm jobs in queue order", () => {
    const walk = new FakeWalk();
    const tilled: string[] = [];
    const feedback: { message: string; delay?: number }[] = [];
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
      gold: 100,
      spendGold: (amount: number) => { state.gold -= amount; },
      addXp: () => {},
      onFarm: null,
      onTreeHarvest: null,
      canMutateOnline: null,
    };
    const actor = { setWorking: () => {} };
    const jobs = new JobSystem(
      field as never,
      actor as never,
      walk as never,
      state as never,
      (_x, _y, message, delay) => feedback.push({ message, delay }),
    );

    expect(jobs.enqueue("till", 10, 10)).toBe(true);
    expect(jobs.enqueue("till", 20, 20)).toBe(true);
    expect(field.plowHighlightLayer.children).toHaveLength(2);
    expect(field.highlightLayer.children).toHaveLength(0);
    jobs.advanceElapsed(3);

    expect(tilled).toEqual(["10,10", "20,20"]);
    expect(state.gold).toBe(80);
    expect(feedback).toEqual([
      { message: "-10g", delay: undefined },
      { message: "+1xp", delay: 0.42 },
      { message: "-10g", delay: undefined },
      { message: "+1xp", delay: 0.42 },
    ]);
    expect(jobs.busy).toBe(false);
  });

  it("does not start queued work when no time elapsed", () => {
    const walk = new FakeWalk();
    const jobs = new JobSystem(
      {} as never,
      {} as never,
      walk as never,
      {} as never,
      () => {},
    );

    jobs.enqueueWalk(10, 10);
    jobs.advanceElapsed(0);

    expect(walk.arrivals).toEqual([]);
    expect(jobs.busy).toBe(true);
  });

  it("pauses queued farm work during a raid and resumes without replaying raid time", () => {
    const walk = new FakeWalk();
    const jobs = new JobSystem(
      {} as never,
      {} as never,
      walk as never,
      {} as never,
      () => {},
    );

    jobs.enqueueWalk(10, 10);
    jobs.setPaused(true);
    jobs.advanceElapsed(30);
    jobs.update(30);

    expect(walk.arrivals).toEqual([]);
    expect(jobs.busy).toBe(true);

    jobs.setPaused(false);
    jobs.advanceElapsed(1);

    expect(walk.arrivals).toEqual([10]);
    expect(jobs.busy).toBe(false);
  });

  it("suppresses one-shot audio while completing background catch-up work", () => {
    const walk = new FakeWalk();
    const sounds: string[] = [];
    const field = {
      highlightLayer: new Container(), plowHighlightLayer: new Container(), labelLayer: new Container(),
      resolveTill: (col: number, row: number) => ({ valid: true, oc: col, or: row }),
      reserveTill: () => {}, unreserveTill: () => {},
      plotCenterOf: (col: number, row: number) => ({ x: col, y: row }),
      hasFastWork: () => false, hasPlowFree: () => false,
      tillAt: () => true,
    };
    const state = {
      gold: 100, spendGold: () => {}, addXp: () => {},
      onFarm: null, onTreeHarvest: null, canMutateOnline: null,
    };
    const jobs = new JobSystem(
      field as never, { setWorking: () => {} } as never, walk as never, state as never,
      () => {}, (sound) => sounds.push(sound)
    );

    jobs.enqueue("till", 2, 2);
    jobs.advanceElapsed(3, true);

    expect(jobs.busy).toBe(false);
    expect(sounds).toEqual([]);
  });

  it("drops rejected walk destinations instead of freezing the job queue", () => {
    const walk = {
      moving: false,
      goToPoint: () => false,
      update: () => {},
    };
    const jobs = new JobSystem(
      {} as never,
      {} as never,
      walk as never,
      {} as never,
      () => {},
    );

    jobs.enqueueWalk(10, 10);
    jobs.enqueueWalk(20, 20);
    jobs.advanceElapsed(1);

    expect(jobs.busy).toBe(false);
  });

  it("walks to a queued zombie but skips harvesting when capacity filled before arrival", () => {
    const walk = new FakeWalk();
    const messages: string[] = [];
    const harvestAt = vi.fn();
    const setWorking = vi.fn();
    const field = {
      highlightLayer: new Container(), plowHighlightLayer: new Container(), labelLayer: new Container(),
      plotOriginAt: (col: number, row: number) => ({ oc: col, or: row }),
      isRipe: () => true, ripeZombieAt: () => true,
      plotCenterOf: (col: number, row: number) => ({ x: col, y: row }),
      hasFastWork: () => false,
      harvestAt,
    };
    const state = {
      onFarm: null, onTreeHarvest: null, canMutateOnline: null,
    };
    const jobs = new JobSystem(
      field as never, { setWorking } as never, walk as never, state as never,
      (_x, _y, message) => messages.push(message),
      () => {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      () => false,
    );

    expect(jobs.enqueue("harvest", 4, 8)).toBe(true);
    jobs.enqueueWalk(20, 20);
    jobs.update(0);
    walk.update(0.2);
    // The next queued task starts on the following foreground tick.
    jobs.update(0);

    expect(walk.arrivals).toEqual([4, 20]);
    expect(messages).toEqual(["Army full!"]);
    expect(setWorking).not.toHaveBeenCalled();
    expect(harvestAt).not.toHaveBeenCalled();
    expect(jobs.busy).toBe(true);
  });

  it("retains each planting's logical completion time during catch-up", () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    vi.setSystemTime(now);
    const walk = new FakeWalk();
    const plantedAt: number[] = [];
    const field = {
      highlightLayer: new Container(), plowHighlightLayer: new Container(), labelLayer: new Container(),
      plotOriginAt: (col: number, row: number) => ({ oc: col, or: row }),
      canPlant: () => true, isRipe: () => false,
      plotCenterOf: (col: number, row: number) => ({ x: col, y: row }),
      hasFastWork: () => false,
      plantAt: (_oc: number, _or: number, _cfg: unknown, at: number) => {
        plantedAt.push(at);
        return true;
      },
    };
    const state = {
      gold: 100, brains: 0, level: 1,
      spendGold: (amount: number) => { state.gold -= amount; },
      onFarm: null, onTreeHarvest: null, canMutateOnline: null,
    };
    const cfg = {
      key: "carrot", name: "Carrot", stages: [], growMs: 60_000,
      cost: 1, sell: 1, xp: 1, unlockLevel: 1,
    };
    const jobs = new JobSystem(
      field as never, { setWorking: () => {} } as never, walk as never, state as never,
      () => {},
    );

    expect(jobs.enqueue("plant", 0, 0, cfg)).toBe(true);
    expect(jobs.enqueue("plant", 4, 0, cfg)).toBe(true);
    jobs.advanceElapsed(10, true);

    expect(plantedAt).toHaveLength(2);
    expect(plantedAt[0]).toBeLessThan(plantedAt[1]);
    expect(plantedAt[0]).toBeLessThan(now - 5_000);
    expect(plantedAt[1]).toBeLessThan(now - 5_000);
  });

  it("rolls online fertilization immediately and includes it in the plant action", () => {
    const walk = new FakeWalk();
    const farmActions: unknown[] = [];
    const fertilize = vi.fn(() => "Zombee");
    const field = {
      highlightLayer: new Container(), plowHighlightLayer: new Container(), labelLayer: new Container(),
      plotOriginAt: (col: number, row: number) => ({ oc: col, or: row }),
      canPlant: () => true, isRipe: () => false,
      plotCenterOf: (col: number, row: number) => ({ x: col, y: row }),
      hasFastWork: () => false,
      plantAt: () => true,
    };
    const state = {
      gold: 100, brains: 0, level: 1,
      onFarm: (action: unknown) => farmActions.push(action),
      onTreeHarvest: null, canMutateOnline: () => true,
    };
    const jobs = new JobSystem(
      field as never, { setWorking: () => {} } as never, walk as never, state as never,
      () => {}, () => {}, undefined, undefined, fertilize,
    );

    expect(jobs.enqueue("plant", 0, 0, {
      key: "carrot", name: "Carrot", stages: [], growMs: 1, cost: 1, sell: 1, xp: 1,
      unlockLevel: 1,
    })).toBe(true);
    jobs.advanceElapsed(3);

    expect(fertilize).toHaveBeenCalledWith(0, 0, expect.objectContaining({ key: "carrot" }));
    expect(farmActions).toEqual([
      { type: "plant", oc: 0, or: 0, cropKey: "carrot", fertilized: true },
    ]);
  });

  it("reports the currency needed when an affordable-looking action is rejected", () => {
    const notices: [string, number][] = [];
    const field = {
      resolveTill: () => ({ valid: true, oc: 0, or: 0 }),
      hasPlowFree: () => false,
      plotOriginAt: () => ({ oc: 0, or: 0 }),
      canPlant: () => true,
      isRipe: () => false,
    };
    const jobs = new JobSystem(
      field as never, {} as never, {} as never, { gold: 0, brains: 0, level: 1 } as never,
      () => {}, () => {}, undefined, undefined, undefined, undefined, undefined,
      (currency, needed) => notices.push([currency, needed])
    );

    expect(jobs.enqueue("till", 0, 0)).toBe(false);
    expect(jobs.enqueue("plant", 0, 0, {
      key: "carrot", name: "Carrot", stages: [], growMs: 1, cost: 25, sell: 1, xp: 1,
      unlockLevel: 1,
    })).toBe(false);
    expect(notices).toEqual([["gold", 10], ["gold", 25]]);
  });

  it("serializes pending Local Farm intent and replays it after reopening", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const firstWalk = new FakeWalk();
    const field = {
      highlightLayer: new Container(), plowHighlightLayer: new Container(), labelLayer: new Container(),
      resolveTill: (col: number, row: number) => ({ valid: true, oc: col, or: row }),
      reserveTill: () => {}, unreserveTill: () => {},
      plotCenterOf: (col: number, row: number) => ({ x: col, y: row }),
      hasFastWork: () => false, hasPlowFree: () => false,
      tillAt: () => true,
    };
    const state = {
      gold: 100, spendGold: (amount: number) => { state.gold -= amount; }, addXp: () => {},
      onFarm: null, onTreeHarvest: null, canMutateOnline: null,
    };
    const first = new JobSystem(
      field as never, { setWorking: () => {} } as never, firstWalk as never, state as never, () => {},
    );
    first.enqueue("till", 4, 8);
    const saved = first.serializePending();
    expect(saved?.jobs).toMatchObject([{ kind: "till", oc: 4, or: 8 }]);

    vi.setSystemTime(1_010_000);
    const restored = new JobSystem(
      field as never, { setWorking: () => {} } as never, new FakeWalk() as never, state as never, () => {},
    );
    restored.restorePending(saved, () => undefined);

    expect(restored.busy).toBe(false);
    expect(state.gold).toBe(90);
  });
});
