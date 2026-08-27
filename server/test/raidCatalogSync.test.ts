// server/src/raidCatalog.ts and raidLootCatalog.ts are HAND-MAINTAINED mirrors of
// public/assets/raids/raids.json, and they are what the server actually pays out.
//
// Same guard as objectCatalogSync / boostCatalogSync / questCatalog, for the last two
// hand-typed catalogs that had none. The failure mode is specific and quiet: the client
// reads raids.json for the reward a card advertises, the server reads these tables for
// the reward it grants, and nothing compared them. A drifted row underpays (or overpays)
// every player who clears that invasion and reads, from the outside, as a client bug.
//
// The loot table matters for a second reason: `RAID_LOOT` is not just a payout, it is the
// SET the server rolls from. An entry that exists here but not in the asset is an item the
// game can award and the player can never see coming; one that exists in the asset but not
// here is a drop that silently cannot happen.
import { describe, expect, it } from "vitest";
import raids from "../../public/assets/raids/raids.json";
import { RAIDS } from "../src/raidCatalog";
import { RAID_LOOT } from "../src/raidLootCatalog";

interface RaidRow {
  id: number;
  name: string;
  goldReward: number;
  bonusGold: number;
  xp: number;
  recommendedLevel: number;
  unlockLevel: number;
  playable: boolean;
  loot: string[][];
}
const rows = raids as RaidRow[];

describe("raidCatalog mirrors raids.json", () => {
  it("covers every raid the asset ships, and invents none", () => {
    const assetIds = rows.map((row) => row.id).sort((a, b) => a - b);
    const serverIds = Object.keys(RAIDS).map(Number).sort((a, b) => a - b);
    expect(serverIds).toEqual(assetIds);
  });

  it("pays each raid exactly what the asset advertises", () => {
    const mismatched: string[] = [];
    for (const row of rows) {
      const econ = RAIDS[row.id];
      if (!econ) continue; // absence is asserted above
      const expected = {
        gold: row.goldReward,
        bonus: row.bonusGold,
        xp: row.xp,
        unlockLevel: row.unlockLevel,
        playable: row.playable,
      };
      const actual = {
        gold: econ.gold,
        bonus: econ.bonus,
        xp: econ.xp,
        unlockLevel: econ.unlockLevel,
        playable: econ.playable,
      };
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        if (expected[key] !== actual[key]) {
          mismatched.push(`${row.id} ${row.name} ${key}: asset ${expected[key]} vs server ${actual[key]}`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("gates each raid at the asset's unlock level", () => {
    // Called out separately from the payout sweep because this one is a security gate, not
    // an economy figure: `raidUnlocked` is what stops a level-1 account invading raid 9 for
    // 5,000 gold and 5,500 first-clear XP, and XP converts to level-up brains.
    const wrong = rows
      .filter((row) => RAIDS[row.id] && RAIDS[row.id].unlockLevel !== row.unlockLevel)
      .map((row) => `${row.id} ${row.name}: asset ${row.unlockLevel} vs server ${RAIDS[row.id].unlockLevel}`);
    expect(wrong).toEqual([]);
  });

  it("keeps recLevel usable as the no-data fallback", () => {
    // recLevel is documented as unused for the catalogued raids (they all carry gold), so
    // it is deliberately NOT asserted equal to `recommendedLevel` — raid 1 legitimately
    // differs. It still has to be a sane positive level, since brain-drop odds ramp off it.
    for (const [id, econ] of Object.entries(RAIDS)) {
      expect(econ.recLevel, `raid ${id}`).toBeGreaterThan(0);
      expect(Number.isInteger(econ.recLevel), `raid ${id}`).toBe(true);
    }
  });
});

describe("raidLootCatalog mirrors raids.json loot", () => {
  it("carries a loot table for every playable raid", () => {
    const missing = rows
      .filter((row) => row.playable && !RAID_LOOT[row.id])
      .map((row) => `${row.id} ${row.name}`);
    expect(missing).toEqual([]);
  });

  it("rolls from exactly the asset's tiers and entries", () => {
    // Order matters inside a tier only for readability, but tier ORDER is the rarity
    // ladder that `rollLootTier` indexes into — so this compares structurally, not as sets.
    const mismatched: string[] = [];
    for (const row of rows) {
      const server = RAID_LOOT[row.id];
      if (!server) continue;
      const asset = row.loot ?? [];
      if (server.length !== asset.length) {
        mismatched.push(`${row.id} ${row.name}: asset has ${asset.length} tiers, server has ${server.length}`);
        continue;
      }
      asset.forEach((tier, index) => {
        const serverTier = [...server[index]].sort();
        const assetTier = [...tier].sort();
        if (JSON.stringify(serverTier) !== JSON.stringify(assetTier)) {
          mismatched.push(
            `${row.id} ${row.name} tier ${index}: asset [${assetTier}] vs server [${serverTier}]`
          );
        }
      });
    }
    expect(mismatched).toEqual([]);
  });

  it("names no loot entry that no catalog can resolve", () => {
    // A typo here is invisible: the roll picks the entry, `grantQuestItem`-style resolution
    // finds nothing, and the player is simply awarded nothing with no error anywhere.
    const known = new Set<string>();
    for (const row of rows) for (const tier of row.loot ?? []) for (const name of tier) known.add(name);
    const unknown: string[] = [];
    for (const [id, tiers] of Object.entries(RAID_LOOT)) {
      for (const tier of tiers) {
        for (const name of tier) if (!known.has(name)) unknown.push(`raid ${id}: "${name}"`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
