// A field of plowing must travel as a handful of commands, not hundreds.
//
// The farmer emits one plow/plant per plot as it works down the queue, and a drag-paint
// stroke can cover the whole board (289 plots on a 70x70 farm). The Worker's rolling
// budget is counted in SEMANTIC commands — 120 a minute — so unmerged, a single
// full-field pass physically cannot fit through it. The outbox then spends minutes
// draining behind 429s, and `settle()` holds the next invasion launch behind the outbox:
// "I can't start battles if I have a high number of planting/plowing queued".
//
// These tests pin the fold, and the two things the fold must never break: ordering, and
// the optimistic balance.
import { describe, expect, it } from "vitest";
import { GameState } from "../GameState";
import { EconomyClient } from "./economy";
import { FARM_BULK_LIMIT, type SequencedCommand } from "./protocol";

/** The outbox's own pending list, which is what actually goes on the wire. */
const pending = (economy: EconomyClient): SequencedCommand[] =>
  (economy as unknown as { queue: { pending: SequencedCommand[] } }).queue.pending;

const plow = (economy: EconomyClient, oc: number, or: number) =>
  economy.submitFarm({ type: "plow", oc, or }, { gold: -10, xp: 1 });

const plant = (economy: EconomyClient, oc: number, or: number, cropKey = "carrot") =>
  economy.submitFarm({ type: "plant", oc, or, cropKey }, { gold: -5 });

describe("bulk farm commands", () => {
  it("folds a whole field of plowing into a single command", () => {
    const economy = new EconomyClient(new GameState(), "bulk-plow");
    for (let i = 0; i < 200; i++) plow(economy, i * 4, 0);

    const queued = pending(economy);
    expect(queued).toHaveLength(1);
    expect(queued[0].command.type).toBe("farm.plow_many");
    expect((queued[0].command as { plots: unknown[] }).plots).toHaveLength(200);
  });

  it("folds planting only while the crop stays the same", () => {
    const economy = new EconomyClient(new GameState(), "bulk-plant");
    plant(economy, 0, 0, "carrot");
    plant(economy, 4, 0, "carrot");
    plant(economy, 8, 0, "pumpkin");
    plant(economy, 12, 0, "pumpkin");

    const queued = pending(economy);
    expect(queued.map((entry) => entry.command.type))
      .toEqual(["farm.plant_many", "farm.plant_many"]);
    expect(queued.map((entry) => (entry.command as { cropKey: string }).cropKey))
      .toEqual(["carrot", "pumpkin"]);
    expect(queued.map((entry) => (entry.command as { plots: unknown[] }).plots.length))
      .toEqual([2, 2]);
  });

  it("never folds across an unrelated command", () => {
    // The fold only ever offers the LAST pending command, so a plot cannot jump ahead
    // of the harvest queued between it and the earlier plots.
    const economy = new EconomyClient(new GameState(), "bulk-order");
    plow(economy, 0, 0);
    economy.submitFarm({ type: "harvest", oc: 0, or: 0 }, {});
    plow(economy, 4, 0);

    expect(pending(economy).map((entry) => entry.command.type))
      .toEqual(["farm.plow_many", "farm.harvest", "farm.plow_many"]);
  });

  it("does not fold plowing into planting or the reverse", () => {
    const economy = new EconomyClient(new GameState(), "bulk-mixed");
    plow(economy, 0, 0);
    plant(economy, 0, 0);
    plow(economy, 4, 0);

    expect(pending(economy).map((entry) => entry.command.type))
      .toEqual(["farm.plow_many", "farm.plant_many", "farm.plow_many"]);
  });

  it("starts a new command once one is full", () => {
    const economy = new EconomyClient(new GameState(), "bulk-cap");
    for (let i = 0; i < FARM_BULK_LIMIT + 3; i++) plow(economy, i * 4, 0);

    const queued = pending(economy);
    expect(queued).toHaveLength(2);
    expect((queued[0].command as { plots: unknown[] }).plots).toHaveLength(FARM_BULK_LIMIT);
    expect((queued[1].command as { plots: unknown[] }).plots).toHaveLength(3);
  });

  it("accumulates every folded plot's cost onto the command it joined", () => {
    // The optimistic balance is what the player sees while the batch is in flight. A
    // fold must still spend per plot, or a field of plowing looks free until the
    // server's answer lands and the money vanishes at once.
    const state = new GameState();
    const economy = new EconomyClient(state, "bulk-optimistic");
    for (let i = 0; i < 5; i++) plow(economy, i * 4, 0);

    const optimistic = (economy as unknown as {
      optimistic: Map<number, { gold: number; xp: number }>;
    }).optimistic;
    expect(optimistic.size).toBe(1);
    const [only] = [...optimistic.values()];
    expect(only.gold).toBe(-50);
    expect(only.xp).toBe(5);
  });

  it("keeps one plot's plow a plow", () => {
    const economy = new EconomyClient(new GameState(), "bulk-single");
    plow(economy, 8, 8);

    expect(pending(economy)[0].command)
      .toEqual({ type: "farm.plow_many", plots: [{ oc: 8, or: 8 }] });
  });
});
