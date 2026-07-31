// Regression: mutations grown in the field (a plain zombie planted beside tomato /
// carrot crops) must satisfy the quests that name the Market's pre-mutated species.
// Before the fix the harvest / combine events carried only the parent SPECIES name,
// so quest 55 "Mutation Nation" and quest 56 "It's Alive!" were unreachable for a
// player who farmed their mutants instead of buying them.
import { describe, expect, it } from "vitest";
import type { SequencedCommand } from "../../src/net/protocol";
import { applyCommandBatch, freshGameplayState } from "../src/v3/engine";
import type { MutableGameplayState } from "../src/v3/engine";

const commands = (...values: SequencedCommand["command"][]): SequencedCommand[] =>
  values.map((command, index) => ({ sequence: index + 1, command }));

const TOMATO_BIT = 1;
const CARROT_BIT = 4;
const REGULAR = "ZombieActorRegularTier1";
const PLOT = 4; // a crop occupies a 4x4 base-tile plot

/** Level 3+ (quest 55's gate) with a ripe plain-zombie crop at (0,0) and one
 *  mutation-bearing vegetable cardinally adjacent to it. */
function farmWithNeighbour(cropKey: string): MutableGameplayState {
  const state = freshGameplayState();
  state.balance.xp = 200; // comfortably past quest 55's level 3 gate
  state.farm.plots["0:0"] = {
    state: "planted", cropKey: REGULAR, plantedAt: 0, growMs: 1,
    sell: 0, xp: 1, fertilized: false, zombie: true,
  };
  state.farm.plots[`${PLOT}:0`] = {
    state: "planted", cropKey, plantedAt: 0, growMs: 86_400_000,
    sell: 10, xp: 1, fertilized: false, zombie: false,
  };
  return state;
}

const progressOf = (state: MutableGameplayState, questId: string) =>
  state.quests.progress.find((entry) => entry.questId === questId)?.counts ?? [];

describe("quest 55 — natural mutations count as their Market mutant", () => {
  it("advances the Tomato Zombie objective from a field-grown tomato mutation", () => {
    const state = farmWithNeighbour("tomato");
    // random() = 0 always clears the 25%-per-adjacent-crop mutation roll.
    const result = applyCommandBatch(state, commands({ type: "farm.harvest", oc: 0, or: 0 }), {
      now: 1_000, random: () => 0, id: () => "grown",
    });

    const unit = result.state.roster.find((u) => u.id === "grown");
    expect(unit).toMatchObject({ key: REGULAR, mutation: TOMATO_BIT });
    // Requirement 0 is "Harvest a Tomato Zombie"; the species harvested is "Zombie".
    expect(progressOf(result.state, "55")[0]).toBe(1);
  });

  it("advances the Carrot objective from a field-grown carrot mutation", () => {
    const state = farmWithNeighbour("carrot");
    const result = applyCommandBatch(state, commands({ type: "farm.harvest", oc: 0, or: 0 }), {
      now: 1_000, random: () => 0, id: () => "grown",
    });
    expect(result.state.roster[0]).toMatchObject({ mutation: CARROT_BIT });
    expect(progressOf(result.state, "55")[1]).toBe(1);
  });

  it("leaves both objectives alone when the roll fails and no mutation lands", () => {
    const state = farmWithNeighbour("tomato");
    const result = applyCommandBatch(state, commands({ type: "farm.harvest", oc: 0, or: 0 }), {
      now: 1_000, random: () => 0.99, id: () => "grown",
    });
    expect(result.state.roster[0]).toMatchObject({ mutation: 0 });
    expect(progressOf(result.state, "55")).toEqual([0, 0]);
  });

  it("counts a harvest once against the wildcard 'any zombie' objective", () => {
    // Quest 3 "A Zombieful Harvest" is the format's wildcard: notificationObject ""
    // matches every zombie harvest. Aliases must not turn one harvest into two.
    const mutated = farmWithNeighbour("tomato");
    mutated.quests.completed = ["1"]; // quest 3's prerequisite
    const plain = freshGameplayState();
    plain.balance.xp = 200;
    plain.quests.completed = ["1"];
    plain.farm.plots["0:0"] = { ...mutated.farm.plots["0:0"] };

    const withMutation = applyCommandBatch(mutated, commands({ type: "farm.harvest", oc: 0, or: 0 }), {
      now: 1_000, random: () => 0, id: () => "a",
    });
    const withoutMutation = applyCommandBatch(plain, commands({ type: "farm.harvest", oc: 0, or: 0 }), {
      now: 1_000, random: () => 0, id: () => "b",
    });
    expect(withMutation.state.roster[0].mutation).toBe(TOMATO_BIT);
    expect(withoutMutation.state.roster[0].mutation).toBe(0);
    expect(progressOf(withMutation.state, "3")).toEqual(progressOf(withoutMutation.state, "3"));
    expect(progressOf(withMutation.state, "3")[0]).toBe(1);
  });
});

describe("quest 56 — combining field-grown mutants", () => {
  /** Quest 55 complete, a Zombie Pot placed, and two mutated Regular Zombies held. */
  function readyToCombine(): MutableGameplayState {
    const state = freshGameplayState();
    state.balance.xp = 200;
    state.quests.completed = ["55"];
    state.roster.push(
      { id: "a", key: REGULAR, mutation: TOMATO_BIT, invasions: 0, stored: false },
      { id: "b", key: REGULAR, mutation: CARROT_BIT, invasions: 0, stored: false }
    );
    return state;
  }

  it("completes 'It's Alive!' from two field-mutated Regular Zombies", () => {
    const state = readyToCombine();
    const result = applyCommandBatch(
      state,
      commands({ type: "roster.combine", parentAId: "a", parentBId: "b" }),
      { now: 1_000, random: () => 0.5, id: () => "child" }
    );
    expect(result.results[0]).toMatchObject({ status: "applied" });
    expect(result.state.quests.completed).toContain("56");
  });

  it("still completes it from two bought Market mutants", () => {
    const state = readyToCombine();
    state.roster = [
      { id: "a", key: "ZombieActorRegularTier1Tomatoes", mutation: TOMATO_BIT, invasions: 0, stored: false },
      { id: "b", key: "ZombieActorRegularTier1Carrots", mutation: CARROT_BIT, invasions: 0, stored: false },
    ];
    const result = applyCommandBatch(
      state,
      commands({ type: "roster.combine", parentAId: "a", parentBId: "b" }),
      { now: 1_000, random: () => 0.5, id: () => "child" }
    );
    expect(result.state.quests.completed).toContain("56");
  });

  it("does not complete it for an unrelated mutation pair", () => {
    const state = readyToCombine();
    state.roster[1].mutation = 2; // onion, not carrot
    const result = applyCommandBatch(
      state,
      commands({ type: "roster.combine", parentAId: "a", parentBId: "b" }),
      { now: 1_000, random: () => 0.5, id: () => "child" }
    );
    expect(result.results[0]).toMatchObject({ status: "applied" });
    expect(result.state.quests.completed).not.toContain("56");
  });
});
