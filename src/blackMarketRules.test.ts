import { describe, expect, it } from "vitest";
import {
  BLACK_MARKET_SPECIAL_LEVEL,
  blackMarketComposeDefaults,
  blackMarketMutationRequirementLabel,
  blackMarketPurchaseLock,
  matchesBlackMarketMutation,
  REQUESTABLE_MUTATION_MASK,
} from "./blackMarketRules";
import { ALL_BITS, HEADLESS_HEAD_MASK } from "./zombie/mutations";

describe("Black Market compose defaults", () => {
  it("opens a roster-originated sale with that zombie selected", () => {
    expect(blackMarketComposeDefaults("SELL_ZOMBIE", "unit-2", ["unit-1", "unit-2"]))
      .toEqual({ kind: "SELL_ZOMBIE", assetId: "unit-2" });
  });

  it("does not carry an unavailable unit into the form", () => {
    expect(blackMarketComposeDefaults("SELL_ZOMBIE", "missing", ["unit-1"]))
      .toEqual({ kind: "SELL_ZOMBIE" });
  });
});

describe("Black Market purchase requirements", () => {
  it("allows ordinary zombies without applying their planting level", () => {
    expect(blackMarketPurchaseLock({ category: "normal" }, 1)).toBeNull();
  });

  it("unlocks colored zombies at the matching gravestone's level", () => {
    expect(blackMarketPurchaseLock(
      { category: "normal", unlockGrave: "Red" },
      14
    )).toMatchObject({ kind: "level", level: 15 });
    expect(blackMarketPurchaseLock(
      { category: "normal", unlockGrave: "Red" },
      15
    )).toBeNull();
    expect(blackMarketPurchaseLock(
      { category: "normal", unlockGrave: "Silver" },
      25
    )).toBeNull();
  });

  it("unlocks special-zombie purchases at level 20", () => {
    expect(blackMarketPurchaseLock(
      { category: "special" },
      BLACK_MARKET_SPECIAL_LEVEL - 1
    )).toMatchObject({ kind: "level", level: 20 });
    expect(blackMarketPurchaseLock(
      { category: "special" },
      BLACK_MARKET_SPECIAL_LEVEL
    )).toBeNull();
  });

  it("uses the stricter requirement for a special colored zombie", () => {
    expect(blackMarketPurchaseLock(
      { category: "special", unlockGrave: "Red" },
      19
    )).toMatchObject({ kind: "level", level: 20 });
  });

  it("ORs requested mutations in one slot and ANDs requirements across slots", () => {
    expect(matchesBlackMarketMutation(128, true, 128 | 512)).toBe(true);
    expect(matchesBlackMarketMutation(512, true, 128 | 512)).toBe(true);
    expect(matchesBlackMarketMutation(4, true, 4 | 8)).toBe(false);
    expect(matchesBlackMarketMutation(4 | 8 | 1024, true, 4 | 8)).toBe(true);
    expect(blackMarketMutationRequirementLabel(128 | 512 | 8))
      .toBe("Broccohair or Cauli-hair + Turnip-Arm");
    expect(matchesBlackMarketMutation(4, true)).toBe(true);
    expect(matchesBlackMarketMutation(0, false)).toBe(true);
  });

  it("bounds requestable mutations by what the orders table can store", () => {
    // The column's CHECK (migration 0030) caps the mask at the 13 bits that existed
    // then, so Pumpking (8192) is excluded until that can be widened.
    expect(REQUESTABLE_MUTATION_MASK).toBe(8191);
    for (const bit of ALL_BITS) {
      expect((bit & REQUESTABLE_MUTATION_MASK) !== 0).toBe(bit !== HEADLESS_HEAD_MASK);
    }
  });
});
