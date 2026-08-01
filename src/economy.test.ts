import { describe, it, expect } from "vitest";
import { zombieSellValue, sellBack, buyXp, ECONOMY } from "./economy";

// Ground truth: -[ZFToolManager sellZombie:] = floor(baseMarketCost / 2), flat.
describe("zombieSellValue — floor(baseCost / 2)", () => {
  it("is half of an even base cost", () => expect(zombieSellValue(500)).toBe(250));
  it("floors an odd base cost", () => expect(zombieSellValue(51)).toBe(25));
  it("floors the payout at 1 for a free/priceless type", () => {
    expect(zombieSellValue(0)).toBe(1);
    expect(zombieSellValue(1)).toBe(1);
  });
  it("does NOT scale with anything but base cost", () => {
    expect(zombieSellValue(50)).toBe(25);
  });
  it("converts brain-priced zombies to 1,000 gold per brain", () => {
    expect(zombieSellValue(5, true)).toBe(5_000);
  });
});

describe("item economy helpers", () => {
  it("sellBack refunds the configured fraction, min 1", () => {
    expect(sellBack(100)).toBe(Math.floor(100 * ECONOMY.SELL_BACK_RATIO));
    expect(sellBack(1)).toBe(1);
  });
  it("converts brain-priced items to 1,000 gold per brain", () => {
    expect(sellBack(3, true)).toBe(3_000);
  });
  it("buyXp retains authoritative source XP for gold purchases", () =>
    expect(buyXp(1000, 42, false, "decor")).toBe(42));
  it("buyXp derives gold XP from cost when the source has no XP", () => {
    expect(buyXp(1000)).toBe(10);
    expect(buyXp(20_000, 0)).toBe(200);
    expect(buyXp(1, 0)).toBe(0);
  });
  it("derives brain decor/tree XP from the current price", () => {
    expect(buyXp(10, 6000, true, "decor")).toBe(1000); // Heart Fountain
    expect(buyXp(3, 0, true, "tree")).toBe(300);
  });
  it("uses the binary's lower multiplier for brain functional items", () => {
    expect(buyXp(12, 6000, true, "functional")).toBe(960); // Clay Monolith
    expect(buyXp(3, 500, true, "functional")).toBe(240); // repeat Zombie Pot
  });
});
