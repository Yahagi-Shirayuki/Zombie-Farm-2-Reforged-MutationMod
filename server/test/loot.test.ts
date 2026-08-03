import { describe, it, expect } from "vitest";
import { rollLoot, resolveLoot, lootEligible, ownedLootCounter, bonusGoldFor, BONUS_GOLD } from "../src/loot";
import { RAID_LOOT, dropEcon, raidLoot } from "../src/raidLootCatalog";
import { rollLootTier } from "../../src/raid/LootTable";
import { raidBoostBundle } from "../../src/raid/lootBundles";

const none = () => 0;

describe("raidLootCatalog — mirror of raids.json loot", () => {
  it("has a 6-tier table for all 11 raids", () => {
    expect(Object.keys(RAID_LOOT)).toHaveLength(11);
    for (const [id, tiers] of Object.entries(RAID_LOOT)) {
      expect(tiers.length, id).toBe(6);
      expect(tiers[0], id).toContain(BONUS_GOLD); // tier 0 is always the gold pity drop
    }
  });
  it("mirrors drops.json metadata for the entries it can drop", () => {
    expect(dropEcon("Windmill")).toMatchObject({ unique: true, tile: "windmill" });
    expect(dropEcon("Scarecrow")).toMatchObject({ unique: false }); // a repeatable decoration
    expect(dropEcon("Rusty Fragment")).toMatchObject({ limit: 3 }); // the only limited entry
    expect(dropEcon("Bonus Gold")).toMatchObject({ gold: true });
    expect(dropEcon("nope")).toBeUndefined();
  });
  it("every loot entry across every raid resolves to real drop metadata", () => {
    // A typo in the generated table would silently make an entry always-eligible.
    for (const [id, tiers] of Object.entries(RAID_LOOT)) {
      for (const tier of tiers) for (const name of tier) expect(dropEcon(name), `${id}:${name}`).toBeDefined();
    }
  });
});

describe("lootEligible — unique / limit filters", () => {
  it("filters a unique once owned, at all", () => {
    expect(lootEligible("Windmill", none)).toBe(true);
    expect(lootEligible("Windmill", () => 1)).toBe(false);
    // A non-unique decoration keeps dropping.
    expect(lootEligible("Scarecrow", () => 5)).toBe(true);
  });
  it("filters a limited entry only once its cap is reached", () => {
    expect(lootEligible("Rusty Fragment", () => 2)).toBe(true); // limit 3
    expect(lootEligible("Rusty Fragment", () => 3)).toBe(false);
  });
  it("keeps unlimited entries eligible however many you own", () => {
    expect(lootEligible(BONUS_GOLD, () => 999)).toBe(true);
  });
});

describe("ownedLootCounter — where a dropped item counts as owned", () => {
  const noObjects: { catalogKey: string }[] = [];

  it("counts Received, the shed, and the placed object together", () => {
    expect(ownedLootCounter({ received: { Windmill: 1 } }, noObjects)("Windmill")).toBe(1);
    expect(ownedLootCounter({ stored: { Windmill: 2 } }, noObjects)("Windmill")).toBe(2);
    // "windmill" is what a Windmill BECOMES once placed (drops.json `tile`).
    expect(ownedLootCounter({}, [{ catalogKey: "windmill" }])("Windmill")).toBe(1);
    expect(
      ownedLootCounter({ received: { Windmill: 1 }, stored: { Windmill: 1 } }, [{ catalogKey: "windmill" }])("Windmill")
    ).toBe(3);
  });

  it("still owns a unique after it has been CLAIMED out of Received", () => {
    // The regression this exists for: claiming is how a drop gets used, and it empties the
    // Received bucket. Counting Received alone therefore made every unique droppable again
    // the moment the player took it — `unique` was effectively off for the whole game.
    const claimedToShed = ownedLootCounter({ received: { Windmill: 0 }, stored: { Windmill: 1 } }, noObjects);
    const claimedToFarm = ownedLootCounter({ received: { Windmill: 0 }, stored: {} }, [{ catalogKey: "windmill" }]);
    for (const owned of [claimedToShed, claimedToFarm]) {
      expect(lootEligible("Windmill", owned)).toBe(false);
      // ... so the rarest tier walks down to the repeatable Scarecrow instead of re-minting it.
      expect(rollLoot(1, 5, owned, 0.99, 0)).toBe("Scarecrow");
    }
  });

  it("ignores an unrelated object and leaves non-uniques alone", () => {
    const owned = ownedLootCounter({ stored: { Scarecrow: 4 } }, [{ catalogKey: "haystack" }]);
    expect(owned("Windmill")).toBe(0);
    expect(lootEligible("Windmill", owned)).toBe(true);
    expect(lootEligible("Scarecrow", owned)).toBe(true); // not unique — 4 owned is fine
  });

  it("counts an object whatever its status, and unknown names as unowned", () => {
    // An object sitting in storage off-farm is owned just as much as a placed one.
    expect(ownedLootCounter({}, [{ catalogKey: "windmill" }])("Windmill")).toBe(1);
    expect(ownedLootCounter({}, noObjects)("Not A Drop")).toBe(0);
  });

  it("accepts an explicit tile for loot that isn't in drops.json", () => {
    // Epic-boss prizes carry their own tile rather than a drops.json entry.
    const owned = ownedLootCounter({}, [{ catalogKey: "snowOwl" }]);
    expect(owned("Foul Owl's Colossal Snowman", "snowOwl")).toBe(1);
    expect(owned("Foul Owl's Colossal Snowman")).toBe(0); // no drops.json link to follow
  });
});

describe("rollLoot — server roll over the raid's tiers", () => {
  it("uses the SAME tier thresholds as the client (one shared definition)", () => {
    // rollLoot must agree with LootTable.rollLootTier, which is imported from the client
    // source rather than copied — this pins that they can't drift apart.
    // raid 1: tier 0 = Bonus Gold, tier 1 = Haystack.
    expect(rollLootTier(0.05, 0)).toBe(0);
    expect(rollLoot(1, 0, none, 0.05, 0)).toBe(BONUS_GOLD);
    expect(rollLootTier(0.2, 0)).toBe(1);
    expect(rollLoot(1, 0, none, 0.2, 0)).toBe("Haystack");
  });

  it("picks uniformly within the chosen tier", () => {
    // raid 1 tier 2 = ["Insta-Plow", "Insta-Harvest"]; roll 0.5 lands in tier 2 at B=0.
    expect(rollLoot(1, 0, none, 0.5, 0)).toBe("Insta-Plow");
    expect(rollLoot(1, 0, none, 0.5, 0.99)).toBe("Insta-Harvest");
  });

  it("walks DOWN to a commoner tier when the rolled tier is exhausted", () => {
    // raid 1 tier 5 = ["Windmill"], which is unique. Own it, roll the rarest tier at high
    // luck, and the roll must fall back to tier 4 (Scarecrow) rather than drop nothing.
    const ownWindmill = (n: string) => (n === "Windmill" ? 1 : 0);
    expect(rollLoot(1, 5, none, 0.99, 0)).toBe("Windmill"); // tier 5 when un-owned
    expect(rollLoot(1, 5, ownWindmill, 0.99, 0)).toBe("Scarecrow"); // tier 4 fallback
  });

  it("returns null when a raid is unknown", () => {
    expect(rollLoot(999, 0, none, 0.5, 0)).toBeNull();
  });

  it("uses the dice count for luck — more dice, rarer tiers", () => {
    // B=0 can reach tier 0; B>=1 makes the common tiers unreachable (ground truth).
    expect(rollLoot(1, 0, none, 0.05, 0)).toBe(BONUS_GOLD); // tier 0
    expect(rollLoot(1, 1, none, 0.05, 0)).toBe("Haystack"); // tier 1 — no more pity gold
    expect(rollLoot(1, 5, none, 0.99, 0)).toBe("Windmill"); // tier 5, the signature drop
  });
});

describe("resolveLoot — what a drop becomes", () => {
  it("pays bonus gold for the Bonus Gold entry, scaled by the raid's level", () => {
    expect(bonusGoldFor(5)).toBe(500);
    expect(resolveLoot(BONUS_GOLD, 5)).toEqual({ kind: "gold", name: BONUS_GOLD, gold: 500 });
  });

  it("resolves a boost drop BY NAME, not by the drops.json gold flag", () => {
    // The trap: Golden Dice carries `gold: true` in drops.json but is a BOOST. The client
    // keys off the literal name "Bonus Gold", so keying off the flag would wrongly turn
    // Golden Dice into gold.
    expect(dropEcon("Golden Dice")).toMatchObject({ gold: true });
    expect(resolveLoot("Golden Dice", 5)).toEqual({ kind: "boost", name: "Golden Dice", key: "golden_dice", qty: 1 });
    expect(resolveLoot("Invasion Voucher", 5)).toMatchObject({ kind: "boost", key: "invasion_voucher", qty: 1 });
  });

  it("hands Insta-Grow over as a bundle of ten", () => {
    // The bundle table is shared with the offline client (src/raid/lootBundles.ts), so the
    // two settlement paths can't pay different amounts for the same drop.
    expect(raidBoostBundle("insta_grow")).toBe(10);
    expect(resolveLoot("Insta-Grow", 5)).toEqual({ kind: "boost", name: "Insta-Grow", key: "insta_grow", qty: 10 });
    // Its neighbours in the same loot tier are unaffected.
    expect(resolveLoot("Insta-Plow", 5)).toMatchObject({ key: "insta_plow", qty: 1 });
    expect(resolveLoot("Insta-Harvest", 5)).toMatchObject({ key: "insta_harvest", qty: 1 });
  });

  it("treats everything else as an item for the Received bucket", () => {
    expect(resolveLoot("Scarecrow", 5)).toEqual({ kind: "item", name: "Scarecrow" });
  });

  it("grants nothing when nothing dropped", () => {
    expect(resolveLoot(null, 5)).toEqual({ kind: "none" });
  });

  it("never pays brains through item loot — verified invasion brains use a separate table", () => {
    // No raid loot table contains a brain entry (the brain drop is a separate roll), so
    // this is belt-and-braces: if one were ever added, it must not mint premium currency
    // off a forged win.
    expect(dropEcon("10 Brains")).toMatchObject({ brains: true });
    expect(resolveLoot("10 Brains", 5)).toEqual({ kind: "none" });
    const brainy = Object.entries(RAID_LOOT).flatMap(([id, tiers]) =>
      tiers.flat().filter((n) => dropEcon(n)?.brains).map((n) => `${id}:${n}`)
    );
    expect(brainy).toEqual([]); // no loot table pays brains today
  });
});

describe("raidLoot lookup", () => {
  it("resolves known raids and rejects unknown", () => {
    expect(raidLoot(1)).toBeDefined();
    expect(raidLoot(999)).toBeUndefined();
  });
});
