import { describe, it, expect } from "vitest";
import { RaidManager } from "./RaidManager";
import { GameState } from "../GameState";
import { BRAIN_PITY_INVASIONS } from "./brainDrops";
import type { RaidDef, RaidOutcome } from "./types";

// The OFFLINE half of the silent brain pity (online lives in server/src/v3/raid.ts, on
// raid_state_v3.brain_dry_streak). beginRaid pre-rolls the drop with the streak as a
// floor; finishRaid is what SETTLES the streak, and that's what's pinned here: only a
// boss win moves it, and any brain at all clears it.

// Tier 0 (raidTier === 0, so no ability unlock) with an empty loot table, so the
// settlement reduces to exactly the currency bookkeeping this test is about.
const RAID = {
  id: 99, name: "Test Invasion", recommendedLevel: 20,
  goldReward: 100, bonusGold: 0, xp: 0, loot: [[], [], [], []],
} as unknown as RaidDef;

const PARTY = [{ id: "a" }] as never;
const WIN: RaidOutcome = { win: true, rounds: 1, survivors: ["a"], losses: [], enemiesBeaten: 1, playerDamage: 0 };
const LOSS: RaidOutcome = { win: false, rounds: 1, survivors: [], losses: ["a"], enemiesBeaten: 0, playerDamage: 0 };

function makeManager() {
  const state = new GameState();
  const zombies = { roster: () => [], recordInvasion: () => {}, removeCasualties: () => {} } as never;
  return { state, raids: new RaidManager({} as never, state, zombies, { save: () => {} }) };
}

describe("offline invasion brain pity", () => {
  it("counts a brainless boss win towards the guarantee", () => {
    const { state, raids } = makeManager();
    raids.finishRaid(RAID, PARTY, WIN, 0, false, 0, true);
    expect(state.brainDryStreak).toBe(1);
  });

  it("reaches the guarantee after exactly the threshold of dry boss wins", () => {
    const { state, raids } = makeManager();
    for (let i = 0; i < BRAIN_PITY_INVASIONS; i++) raids.finishRaid(RAID, PARTY, WIN, 0, false, 0, true);
    expect(state.brainDryStreak).toBe(BRAIN_PITY_INVASIONS);
  });

  it("clears the streak when brains are paid, and credits them", () => {
    const { state, raids } = makeManager();
    for (let i = 0; i < 3; i++) raids.finishRaid(RAID, PARTY, WIN, 0, false, 0, true);
    const before = state.brains;
    const view = raids.finishRaid(RAID, PARTY, WIN, 0, false, 1, true);
    expect(view.brains).toBe(1);
    expect(state.brains).toBe(before + 1);
    expect(state.brainDryStreak).toBe(0);
  });

  it("leaves the streak alone for fights that could never pay a brain", () => {
    const { state, raids } = makeManager();
    raids.finishRaid(RAID, PARTY, WIN, 0, false, 0, true);
    // A boss-less stage (the low-level McDonnell's ladder) rolls no brains...
    raids.finishRaid(RAID, PARTY, WIN, 0, false, 0, false);
    // ...and a loss pays nothing at all.
    raids.finishRaid(RAID, PARTY, LOSS, 0, false, 0, true);
    expect(state.brainDryStreak).toBe(1);
  });

  it("does not settle the local streak while the server owns the reward", () => {
    const { state, raids } = makeManager();
    raids.finishRaid(RAID, PARTY, WIN, 0, true, 0, true);
    expect(state.brainDryStreak).toBe(0);
  });
});
