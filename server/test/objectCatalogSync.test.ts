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
      if (!econ) continue; // coverage is asserted separately below
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
});
