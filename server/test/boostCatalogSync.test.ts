// server/src/boostCatalog.ts is a HAND-MAINTAINED mirror of boosts.json, and it is what
// the server actually charges and gates. Same hazard as objectCatalogSync.test.ts, one
// layer down: if the two drift, the Market shows one rule and `power.buy` applies another.
//
// The drift this closes: the Brain Ticket was retuned to a level-20 Market item in the
// asset and the server mirror kept `level: 0`. Because `v3/engine.ts` gates `power.buy` on
// the SERVER's number, the level-20 rule was only ever hiding a button — a `power.buy`
// command sent straight at /commands from a level-1 account was applied. Absence of a gate
// is silent in a way a wrong price is not: nobody notices the purchase that should have
// been refused, so nothing surfaces it but a test.
import { describe, expect, it } from "vitest";
import boosts from "../../public/assets/boosts.json";
import { BOOSTS, BOOST_BY_NAME, BOOST_KEYS } from "../src/boostCatalog";

interface BoostRow {
  key: string;
  name: string;
  cost: number;
  brainsNeeded: boolean;
  level: number;
  perPurchase: number;
  giftZombieKey: string;
}
const rows = boosts as BoostRow[];

describe("boostCatalog mirrors boosts.json", () => {
  it("covers every boost the asset ships, and no others", () => {
    expect([...BOOST_KEYS].sort()).toEqual(rows.map((row) => row.key).sort());
  });

  it("prices every boost identically to the asset", () => {
    const mismatched = rows
      .filter((row) => BOOSTS[row.key])
      .filter((row) => BOOSTS[row.key].cost !== row.cost || BOOSTS[row.key].brains !== row.brainsNeeded)
      .map((row) => {
        const econ = BOOSTS[row.key];
        return `${row.key}: asset ${row.cost}${row.brainsNeeded ? " brains" : " gold"} ` +
          `vs server ${econ.cost}${econ.brains ? " brains" : " gold"}`;
      });
    expect(mismatched).toEqual([]);
  });

  it("gates every boost at the asset's level", () => {
    // Players start at level 1, so 0 and 1 both mean "no gate" — compare the gate that
    // can actually bind, exactly as objectCatalogSync does for placeables.
    const gate = (level: number) => (level <= 1 ? 0 : level);
    const mismatched = rows
      .filter((row) => BOOSTS[row.key])
      .filter((row) => gate(BOOSTS[row.key].level) !== gate(row.level))
      .map((row) => `${row.key}: asset lvl ${row.level} vs server ${BOOSTS[row.key].level}`);
    expect(mismatched).toEqual([]);
  });

  it("grants the asset's number of uses per purchase", () => {
    const mismatched = rows
      .filter((row) => BOOSTS[row.key])
      .filter((row) => BOOSTS[row.key].perPurchase !== row.perPurchase)
      .map((row) => `${row.key}: asset ${row.perPurchase} vs server ${BOOSTS[row.key].perPurchase}`);
    expect(mismatched).toEqual([]);
  });

  it("keeps the Brain Ticket behind its level gate on the server", () => {
    // Named explicitly rather than left to the sweep above: this is the one boost whose
    // gate is load-bearing (it buys an elite invasion, with quadrupled brain and rare-
    // zombie odds), and the one that actually drifted.
    expect(BOOSTS.brain_ticket.level).toBe(20);
  });

  it("resolves every loot-table display name to a real boost", () => {
    // BOOST_BY_NAME is keyed on the asset's `name`, because raid loot entries name boosts
    // the way the UI does. A renamed boost silently stops dropping.
    const byName = new Map(rows.map((row) => [row.name, row.key]));
    const broken = Object.entries(BOOST_BY_NAME)
      .filter(([name, key]) => byName.get(name) !== key)
      .map(([name, key]) => `${name} -> ${key} (asset has ${byName.get(name) ?? "no such name"})`);
    expect(broken).toEqual([]);
  });
});
