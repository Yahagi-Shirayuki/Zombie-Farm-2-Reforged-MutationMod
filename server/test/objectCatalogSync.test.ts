// server/src/objectCatalog.ts is a HAND-MAINTAINED mirror of placeables.json's
// purchase economics, and it is what the server actually charges. If the two drift,
// the store shows one price and the player is billed another.
//
// The whole reason this guard exists: the brainflation retune (brain prices cut to a
// tenth) was applied to the assets by hand, and nothing checked that every mirror
// followed. tools/prep_placeables.py silently reverted it on each run until fixed.
import { describe, expect, it } from "vitest";
import placeables from "../../public/assets/placeables.json";
import { OBJECTS } from "../src/objectCatalog";

interface PlaceableRow {
  key: string;
  name: string;
  cost: number;
  brainsNeeded?: boolean;
  level: number;
  xp?: number;
}
const rows = placeables as PlaceableRow[];

/** The Zombie Pot is priced dynamically on the client (500 first, 30 brains after)
 *  and deliberately does not route its purchase through the server. */
const CLIENT_PRICED = new Set(["zombieCombiner"]);

describe("objectCatalog mirrors placeables.json", () => {
  it("prices every purchasable object identically to the asset", () => {
    const mismatched: string[] = [];
    for (const row of rows) {
      if (CLIENT_PRICED.has(row.key)) continue;
      const econ = OBJECTS[row.key];
      if (!econ) continue; // coverage is asserted by the two tests at the bottom
      const brains = !!row.brainsNeeded;
      if (econ.cost !== row.cost || econ.brains !== brains) {
        mismatched.push(
          `${row.key}: asset ${row.cost}${brains ? " brains" : " gold"} ` +
          `vs server ${econ.cost}${econ.brains ? " brains" : " gold"}`
        );
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("gates every purchasable object at the asset's level", () => {
    // Players start at level 1, so -1 / 0 / 1 all mean "no gate" — the two tables
    // spell that differently (the asset uses 0 where the server mirror uses 1) and
    // 29 rows differ on nothing but that. Compare the gate that can actually bind.
    const gate = (level: number) => (level <= 1 ? 0 : level);
    const mismatched = rows
      .filter((row) => !CLIENT_PRICED.has(row.key) && OBJECTS[row.key])
      .filter((row) => gate(OBJECTS[row.key].level) !== gate(row.level))
      .map((row) => `${row.key}: asset lvl ${row.level} vs server ${OBJECTS[row.key].level}`);
    expect(mismatched).toEqual([]);
  });

  it("keeps every brain price inside the retuned band", () => {
    // The brainflation retune put typical brain prices in the 1-5 range; the
    // deliberate premium showpieces top out at 50. A value in the hundreds means a
    // generator (or a hand edit) reintroduced a raw ZF2 price.
    const brainPriced = rows.filter((row) => row.brainsNeeded && row.cost > 0);
    expect(brainPriced.length).toBeGreaterThan(0);
    const overpriced = brainPriced
      .filter((row) => row.cost > 50)
      .map((row) => `${row.name}: ${row.cost} brains`);
    expect(overpriced).toEqual([]);
  });

  it("carries no server entry for an object the asset does not have", () => {
    const assetKeys = new Set(rows.map((row) => row.key));
    const orphans = Object.keys(OBJECTS).filter((key) => !assetKeys.has(key));
    expect(orphans).toEqual([]);
  });

  it("carries a server entry for EVERY object the asset has", () => {
    // The gap this closes: 40 of the 50 Epic Boss prizes had no row here, and
    // object.refund resolves through objectEcon — so a prize the player had earned
    // and placed could not be sold at all (`bad_item`). Absence is silent, which is
    // why the mismatch tests above skip missing keys; this is the one that catches it.
    const gaps = rows.filter((row) => !OBJECTS[row.key]).map((row) => `${row.key} (${row.name})`);
    expect(gaps).toEqual([]);
  });

  it("prices earned rewards at zero so selling one cannot mint gold", () => {
    // A "reward" is never sold in the Market — it is claimed from Received for free.
    // The source DID sell the Epic Boss prizes for brains (to skip the fight), and
    // carrying that price through meant selling a free prize paid its brain value at
    // 1,000 gold each: 1,000-4,000 gold per prize, out of nothing. Priced at zero,
    // the refund is the game's one-gold minimum, exactly like every other reward.
    const priced = rows
      .filter((row) => (row as { category?: string }).category === "reward")
      .filter((row) => row.cost !== 0 || row.brainsNeeded || OBJECTS[row.key]?.cost !== 0)
      .map((row) => `${row.key}: ${row.cost}${row.brainsNeeded ? " brains" : " gold"}`);
    expect(priced).toEqual([]);
  });
});
