import { describe, expect, it } from "vitest";
import { BOOSTS, boostEcon, BRAIN_TICKET_KEY, MAX_STACK, VOUCHER_KEY } from "../src/boostCatalog";
import { planBuy, planUse } from "../src/inventory";

const bal = (gold = 1000, brains = 1000, xp = 0) => ({ gold, brains, xp });
const MAX_LEVEL = 99;

describe("boostCatalog", () => {
  it("has the 7 non-zombie-purchase boosts with positive economics", () => {
    expect(Object.keys(BOOSTS)).toHaveLength(7);
    for (const [key, boost] of Object.entries(BOOSTS)) {
      expect(boost.cost, key).toBeGreaterThan(0);
      expect(boost.perPurchase, key).toBeGreaterThan(0);
    }
  });

  it("prices the two tickets in gold and the consumables in brains", () => {
    expect(boostEcon(VOUCHER_KEY)).toMatchObject({ cost: 2000, brains: false, perPurchase: 1 });
    expect(boostEcon(BRAIN_TICKET_KEY)).toMatchObject({ cost: 10000, brains: false, perPurchase: 1 });
    expect(boostEcon("insta_grow")).toMatchObject({ cost: 1, brains: true, perPurchase: 20 });
    expect(boostEcon("nope")).toBeUndefined();
  });

  it("does not authorize zombie-purchase powers", () => {
    for (const key of ["crazy_zombie_voucher", "valentine_gift", "valentine_gift_2012", "flower_zombie_pot"]) {
      expect(boostEcon(key), key).toBeUndefined();
    }
  });
});

describe("planBuy — exact price + grant", () => {
  const buy = (key: string) => ({ id: "b1", type: "buy" as const, key });

  it("debits the exact catalog cost in the right currency and grants perPurchase", () => {
    expect(planBuy(buy("insta_grow"), boostEcon("insta_grow"), bal(0, 50), 0, MAX_LEVEL))
      .toEqual({ ok: true, currency: "brains", cost: 1, grant: 20 });
    expect(planBuy(buy(VOUCHER_KEY), boostEcon(VOUCHER_KEY), bal(5000, 0), 3, MAX_LEVEL))
      .toEqual({ ok: true, currency: "gold", cost: 2000, grant: 1 });
  });

  it("rejects unknown and removed powers, insufficient funds, and stack overflow", () => {
    for (const key of ["nope", "crazy_zombie_voucher", "valentine_gift", "valentine_gift_2012", "flower_zombie_pot"]) {
      expect(planBuy(buy(key), boostEcon(key), bal(), 0, MAX_LEVEL), key)
        .toMatchObject({ ok: false, error: "bad_item" });
    }
    expect(planBuy(buy(VOUCHER_KEY), boostEcon(VOUCHER_KEY), bal(100, 0), 0, MAX_LEVEL))
      .toMatchObject({ ok: false, error: "insufficient" });
    expect(planBuy(buy("golden_dice"), boostEcon("golden_dice"), bal(0, 100), MAX_STACK, MAX_LEVEL))
      .toMatchObject({ ok: false, error: "stack_full" });
  });
});

describe("planUse — must own it", () => {
  const use = (over = {}) => ({ id: "u1", type: "use" as const, key: "golden_dice", ...over });

  it("consumes when owned; defaults qty to 1", () => {
    expect(planUse(use(), 3)).toEqual({ ok: true, delta: -1 });
    expect(planUse(use({ qty: 2 }), 2)).toEqual({ ok: true, delta: -2 });
  });

  it("rejects using more than owned", () => {
    expect(planUse(use(), 0)).toMatchObject({ ok: false, error: "none_owned" });
    expect(planUse(use({ qty: 5 }), 4)).toMatchObject({ ok: false, error: "none_owned" });
  });
});
