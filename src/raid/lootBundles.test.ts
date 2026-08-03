import { describe, it, expect } from "vitest";
import { RAID_BOOST_BUNDLE, raidBoostBundle } from "./lootBundles";
import { RaidManager, lootDropLabel } from "./RaidManager";
import { GameState } from "../GameState";
import type { RaidDef, RaidOutcome } from "./types";

describe("raid boost bundles", () => {
  it("pays Insta-Grow ten at a time", () => {
    expect(RAID_BOOST_BUNDLE.insta_grow).toBe(10);
    expect(raidBoostBundle("insta_grow")).toBe(10);
  });

  it("leaves every other boost dropping singly", () => {
    for (const key of ["insta_harvest", "insta_plow", "concentration", "golden_dice", "invasion_voucher"]) {
      expect(raidBoostBundle(key)).toBe(1);
    }
    expect(raidBoostBundle("not_a_boost")).toBe(1);
    // Inherited Object properties must not read as a bundle size.
    expect(raidBoostBundle("constructor")).toBe(1);
  });

  it("labels a bundle in the results panel but not a single drop", () => {
    expect(lootDropLabel({ name: "Insta-Grow", icon: "", qty: 10 })).toBe("Insta-Grow x10");
    expect(lootDropLabel({ name: "Insta-Plow", icon: "", qty: 1 })).toBe("Insta-Plow");
    expect(lootDropLabel({ name: "Garden Gnome", icon: "" })).toBe("Garden Gnome");
  });
});

// The OFFLINE settlement (online is server/src/loot.ts resolveLoot + v3/raid.ts, which read
// the same table). A raid whose every loot tier holds one boost, so the roll can only pick it.
const PARTY = [{ id: "a" }] as never;
const WIN: RaidOutcome = { win: true, rounds: 1, survivors: ["a"], losses: [], enemiesBeaten: 1, playerDamage: 0 };

function raidDropping(name: string): RaidDef {
  return {
    id: 99, name: "Test Invasion", recommendedLevel: 20,
    goldReward: 100, bonusGold: 0, xp: 0,
    loot: [[name], [name], [name], [name], [name], [name]],
  } as unknown as RaidDef;
}

function makeManager() {
  const state = new GameState();
  const assets = {
    drops: {},
    placeables: [],
    boosts: [
      { key: "insta_grow", name: "Insta-Grow", icon: "insta_grow.png" },
      { key: "insta_plow", name: "Insta-Plow", icon: "insta_plow.png" },
    ],
  } as never;
  const zombies = { roster: () => [], recordInvasion: () => {}, removeCasualties: () => {} } as never;
  return { state, raids: new RaidManager(assets, state, zombies, { save: () => {} }) };
}

describe("offline raid loot — bundled boost grants", () => {
  it("banks ten Insta-Grows and says so on the results panel", () => {
    const { state, raids } = makeManager();
    const view = raids.finishRaid(raidDropping("Insta-Grow"), PARTY, WIN, 0, false, 0, false);
    expect(state.boostInv).toContainEqual({ key: "insta_grow", count: 10 });
    expect(view.loot[0]).toMatchObject({ name: "Insta-Grow", qty: 10 });
    expect(lootDropLabel(view.loot[0])).toBe("Insta-Grow x10");
  });

  it("stacks a second win's bundle on top", () => {
    const { state, raids } = makeManager();
    const raid = raidDropping("Insta-Grow");
    raids.finishRaid(raid, PARTY, WIN, 0, false, 0, false);
    raids.finishRaid(raid, PARTY, WIN, 0, false, 0, false);
    expect(state.boostInv).toContainEqual({ key: "insta_grow", count: 20 });
  });

  it("still drops an unbundled boost one at a time", () => {
    const { state, raids } = makeManager();
    const view = raids.finishRaid(raidDropping("Insta-Plow"), PARTY, WIN, 0, false, 0, false);
    expect(state.boostInv).toContainEqual({ key: "insta_plow", count: 1 });
    expect(lootDropLabel(view.loot[0])).toBe("Insta-Plow");
  });
});
