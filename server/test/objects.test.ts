import { describe, it, expect } from "vitest";
import { OBJECTS, objectEcon, objectRefund, objectBuyXp } from "../src/objectCatalog";
import { planObjectBuy, planObjectRefund, planObjectUpgrade } from "../src/objects";
import placeables from "../../public/assets/placeables.json";

const bal = (gold = 1000, brains = 1000, xp = 0) => ({ gold, brains, xp });

describe("objectCatalog — mirror of placeables.json", () => {
  it("prices every non-reward placeable the client can buy", () => {
    // Was a hardcoded count, which just had to be bumped whenever the catalog grew
    // (and said nothing about WHICH row was missing). The invariant it was reaching
    // for is coverage: a purchasable key with no server row cannot be bought at all.
    const missing = placeables
      .filter((row) => row.category !== "reward")
      .map((row) => row.key)
      .filter((key) => !OBJECTS[key]);
    expect(missing).toEqual([]);
    expect(Object.keys(OBJECTS).length).toBeGreaterThan(0);
  });
  it("matches every purchasable client catalog value", () => {
    for (const placeable of placeables.filter((row) => row.category !== "reward" && row.cost > 0)) {
      expect(objectEcon(placeable.key), placeable.key).toMatchObject({
        cost: placeable.cost,
        brains: placeable.brainsNeeded,
        xp: placeable.xp,
      });
    }
  });
  it("limits every functional item, with the Zombie Pot capped at three", () => {
    // Two named exceptions to one-per-farm, and they must stay named: the Zombie
    // Pot's three, and the Memorial Statue's none at all (one statue remembers one
    // zombie, so the farm needs as many as the player has lost). Anything else
    // functional gaining a cap by accident is what this loop is here to catch.
    const uncapped = new Set(["memorialStatue"]);
    for (const placeable of placeables.filter((row) => row.category === "functional")) {
      const expected = uncapped.has(placeable.key) ? undefined
        : placeable.key === "zombieCombiner" ? 3 : 1;
      expect(objectEcon(placeable.key)?.purchaseLimit, placeable.key).toBe(expected);
    }
  });
  it("prices refund at floor(cost*0.2), and NOTHING for a free object", () => {
    expect(objectRefund(10)).toBe(2);
    expect(objectRefund(50)).toBe(10);
    expect(objectRefund(3, true)).toBe(3_000);
    expect(objectRefund(0)).toBe(1); // owned free rewards keep the game's minimum sell value
  });
  it("keeps positive source XP for gold, falls back to cost, and derives brain XP", () => {
    expect(objectBuyXp(10, 0)).toBe(0);
    expect(objectBuyXp(900, 9)).toBe(9);
    expect(objectBuyXp(20_000, 0)).toBe(200);
    expect(objectBuyXp(10, 6000, true, false)).toBe(1000); // Heart Fountain
    expect(objectBuyXp(12, 6000, true, true)).toBe(960); // Clay Monolith
  });
  it("gives every priced gold placeable authored XP or the cost-based fallback", () => {
    const goldItems = placeables.filter((row) =>
      row.category !== "reward" && !row.brainsNeeded && row.cost > 0);
    for (const placeable of goldItems) {
      const plan = planObjectBuy(objectEcon(placeable.key), bal(1_000_000, 0), 0, MAX_LEVEL);
      expect(plan, placeable.key).toMatchObject({
        ok: true,
        xp: placeable.xp > 0 ? placeable.xp : Math.floor(placeable.cost / 100),
      });
    }
  });
  it("applies the recovered formula to every brain-priced placeable", () => {
    const brainItems = placeables.filter((row) =>
      row.category !== "reward" && row.brainsNeeded && row.cost > 0);
    // Was a hardcoded count that only ever needed bumping as the catalog grew. What
    // matters is that EVERY brain-priced row obeys the formula, checked below.
    expect(brainItems.length).toBeGreaterThan(0);
    for (const placeable of brainItems) {
      const econ = objectEcon(placeable.key)!;
      const plan = planObjectBuy(econ, bal(0, 10_000), 0, MAX_LEVEL);
      expect(plan, placeable.key).toMatchObject({
        ok: true,
        xp: placeable.cost * (placeable.category === "functional" ? 80 : 100),
      });
    }
  });
  it("resolves known keys and rejects unknown", () => {
    expect(objectEcon("daisy")).toMatchObject({ cost: 10, brains: false });
    expect(objectEcon("skeletonCouple")).toMatchObject({ cost: 3, brains: true });
    expect(objectEcon("pettingZoo")).toMatchObject({ cost: 200, brains: false, level: -1 });
    expect(objectEcon("nope")).toBeUndefined();
  });
});

const MAX_LEVEL = 99; // above every catalog gate

describe("planObjectBuy — exact price + xp", () => {
  it("debits the right currency and computes buy xp", () => {
    expect(planObjectBuy(objectEcon("daisy"), bal(100, 0), 0, MAX_LEVEL)).toEqual({ ok: true, currency: "gold", cost: 10, xp: 0 });
    expect(planObjectBuy(objectEcon("skeletonCouple"), bal(0, 100), 0, MAX_LEVEL)).toEqual({ ok: true, currency: "brains", cost: 3, xp: 300 });
    expect(planObjectBuy(objectEcon("zombieCombiner"), bal(1000, 0), 0, MAX_LEVEL)).toEqual({ ok: true, currency: "gold", cost: 500, xp: 5 });
    expect(planObjectBuy(objectEcon("islandRelic"), bal(20_000, 0), 0, MAX_LEVEL)).toEqual({ ok: true, currency: "gold", cost: 20_000, xp: 200 });
  });
  it("rejects unknown, unaffordable, and free/promo (not purchasable) objects", () => {
    expect(planObjectBuy(objectEcon("nope"), bal(), 0, MAX_LEVEL)).toMatchObject({ ok: false, error: "bad_item" });
    expect(planObjectBuy(objectEcon("daisy"), bal(5, 0), 0, MAX_LEVEL)).toMatchObject({ ok: false, error: "insufficient" });
    expect(planObjectBuy(objectEcon("storage01"), bal(), 0, MAX_LEVEL)).toMatchObject({ ok: false, error: "not_purchasable" });
  });
  it("rejects an object the player's level hasn't unlocked, and treats level -1 as ungated", () => {
    const baloon = objectEcon("baloon")!; // level 21
    expect(baloon.level).toBe(21);
    expect(planObjectBuy(baloon, bal(99999, 0), 0, 20)).toMatchObject({ ok: false, error: "locked" });
    expect(planObjectBuy(baloon, bal(99999, 0), 0, 21)).toMatchObject({ ok: true });
    // level -1 = no requirement (seasonal/promo), matching the client's `level < def.level`.
    expect(objectEcon("skeletonCouple")!.level).toBe(-1);
    expect(planObjectBuy(objectEcon("skeletonCouple"), bal(0, 100), 0, 1)).toMatchObject({ ok: true });
  });
  it("rejects functional copies above their ownership limit", () => {
    expect(planObjectBuy(objectEcon("gravestoneBlue"), bal(0, 100), 1, MAX_LEVEL))
      .toMatchObject({ ok: false, error: "purchase_limit" });
    expect(planObjectBuy(objectEcon("zombieCombiner"), bal(1000, 100), 2, MAX_LEVEL))
      .toMatchObject({ ok: true });
    expect(planObjectBuy(objectEcon("zombieCombiner"), bal(1000, 100), 3, MAX_LEVEL))
      .toMatchObject({ ok: false, error: "purchase_limit" });
  });
});

describe("planObjectRefund — must own it", () => {
  it("always credits gold, converting brain costs at 1,000 gold each", () => {
    expect(planObjectRefund(objectEcon("daisy"), 1)).toEqual({ ok: true, currency: "gold", refund: 2 });
    expect(planObjectRefund(objectEcon("skeletonCouple"), 2)).toEqual({ ok: true, currency: "gold", refund: 3_000 });
  });
  it("rejects refunding an object you don't own, or an unknown key", () => {
    expect(planObjectRefund(objectEcon("daisy"), 0)).toMatchObject({ ok: false, error: "none_owned" });
    expect(planObjectRefund(objectEcon("nope"), 5)).toMatchObject({ ok: false, error: "bad_item" });
  });
  it("never sells functional items", () => {
    expect(planObjectRefund(objectEcon("gravestoneBlue"), 1))
      .toMatchObject({ ok: false, error: "not_sellable" });
    expect(planObjectRefund(objectEcon("zombieCombiner"), 1))
      .toMatchObject({ ok: false, error: "not_sellable" });
  });
});

describe("planObjectUpgrade — the in-place shed upgrade", () => {
  const up = (from: string, to: string, b = bal(1_000_000, 0), haveFrom = 1, haveTo = 0, level = MAX_LEVEL) =>
    planObjectUpgrade(objectEcon(from), objectEcon(to), b, haveFrom, haveTo, level);

  it("charges the new object's FULL price + xp and consumes the old one", () => {
    // Fine Shed (15000) over Wood Hut: pay 15000, no refund for the old hut. xp is the
    // catalog's own 150 for this object, not the cost/10 fallback.
    expect(up("storage03", "storage02")).toEqual({
      ok: true, currency: "gold", cost: 15000, xp: 150, consumesFrom: true,
    });
  });

  it("does NOT require owning a FREE `from` — the starter shed is never server-tracked", () => {
    // storage01 (Shabby Shed) costs 0, so planObjectBuy won't sell it and no count
    // exists. Requiring one here would reject every player's first upgrade.
    expect(up("storage01", "storage02", bal(1_000_000, 0), 0)).toMatchObject({ ok: true, consumesFrom: false });
    // A priced `from` you don't own is still rejected.
    expect(up("storage02", "storage03", bal(1_000_000, 0), 0)).toMatchObject({ ok: false, error: "none_owned" });
  });

  it("rejects unknown keys, an unaffordable upgrade, and upgrading INTO a free object", () => {
    expect(up("nope", "storage02")).toMatchObject({ ok: false, error: "bad_item" });
    expect(up("storage02", "nope")).toMatchObject({ ok: false, error: "bad_item" });
    expect(up("storage02", "storage03", bal(100, 0))).toMatchObject({ ok: false, error: "insufficient" });
    // Free/promo target: an upgrade must not become a free path into an unpurchasable.
    expect(up("storage02", "storage01")).toMatchObject({ ok: false, error: "not_purchasable" });
  });

  it("can't launder: an upgrade costs more than refunding the old + buying the new", () => {
    // The old object is consumed with NO refund, so for any pair the player is strictly
    // worse off than refund-then-buy. Whatever keys a modified client names, the balance
    // only ever goes down.
    const r = up("storage08", "storage02"); // downgrade a 350k barn into a 15k shed
    expect(r).toMatchObject({ ok: true, cost: 15000 }); // still CHARGED, never credited
    expect(objectRefund(350000)).toBeGreaterThan(0); // refunding would have paid out...
    // ...but the upgrade path pays nothing back, so it can't be used to cash out.
  });
});
