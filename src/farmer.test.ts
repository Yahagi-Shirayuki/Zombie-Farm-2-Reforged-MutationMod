import { describe, expect, it } from "vitest";
import {
  activeBonusHeadId, farmerCooldownMs, farmerGold, farmerHeadHasEffect, farmerHeadXp,
  farmerMultiplier, farmerSpeedPx, farmerZombieGrowMs,
} from "./farmer";
import farmerRows from "../public/assets/farmer.json";

describe("priced Farmer head effects", () => {
  it("applies the exact source percentages", () => {
    expect(farmerGold(100, 12)).toBe(110);
    expect(farmerGold(100, 14)).toBe(110);
    expect(farmerZombieGrowMs(1_000, 13)).toBe(750);
    expect(farmerMultiplier(2, "zombieLife")).toBe(1.1);
    expect(farmerMultiplier(6, "zombieLife")).toBe(1.1);
    expect(farmerMultiplier(3, "zombieStrength")).toBe(1.1);
    expect(farmerMultiplier(7, "zombieStrength")).toBe(1.1);
    expect(farmerCooldownMs(1_000, 8)).toBe(750);
    expect(farmerCooldownMs(1_000, 9)).toBe(750);
  });

  it("leaves unrelated and cosmetic heads neutral", () => {
    expect(farmerGold(100, 15)).toBe(100);
    expect(farmerMultiplier(12, "zombieLife")).toBe(1);
  });

  it("walks the farmer a quarter faster in either ninja mask", () => {
    // The one bonus that moves the FARMER rather than the farm, and ours rather than
    // ZF2's — the source shipped both masks with no bonus line at all.
    expect(farmerSpeedPx(174, 23)).toBe(217.5); // Ninja Male
    expect(farmerSpeedPx(174, 22)).toBe(217.5); // Ninja Female
    expect(farmerSpeedPx(174, 15)).toBe(174); // Jester Mask: cosmetic, unchanged
    expect(farmerSpeedPx(174, 12)).toBe(174); // a bonus head with a DIFFERENT bonus
    // ...and it moves nothing else: a ninja is not a better farm, just a faster farmer.
    expect(farmerGold(100, 23)).toBe(100);
    expect(farmerCooldownMs(1_000, 23)).toBe(1_000);
    expect(farmerMultiplier(23, "zombieLife")).toBe(1);
  });

  it("knows which heads carry a bonus at all", () => {
    expect(farmerHeadHasEffect(12)).toBe(true); // Paper Bag: +10% harvest gold
    expect(farmerHeadHasEffect(15)).toBe(false); // Jester Mask: pure cosmetic
    expect(farmerHeadHasEffect(1)).toBe(false); // free starter head
  });

  // The catalog's per-row `effect` blurb and the HEAD_EFFECTS table are written in
  // two different files; a head described as doing something but wired to nothing
  // would show a bonus in the Market it never delivers.
  it("agrees with the catalog about which heads have an effect", () => {
    for (const head of farmerRows.heads) {
      expect([head.name, farmerHeadHasEffect(head.id)])
        .toEqual([head.name, "effect" in head]);
    }
  });
});

describe("bonus head slot", () => {
  it("follows the worn head until one is pinned", () => {
    expect(activeBonusHeadId(12, null)).toBe(12);
    expect(activeBonusHeadId(12, undefined)).toBe(12);
    expect(activeBonusHeadId(15, 12)).toBe(12); // cosmetic worn, bonus head pinned
  });
});

describe("Farmer head purchase XP", () => {
  it("prices XP off the cost, functional heads at the lower source rate", () => {
    // Every priced head is brain-priced, so both branches of buyXp's brain formula
    // are exercised: cost*80 with a bonus, cost*100 for a cosmetic.
    expect(farmerHeadXp({ id: 12, cost: 15, brains: true })).toBe(1_200);
    expect(farmerHeadXp({ id: 15, cost: 15, brains: true })).toBe(1_500);
    expect(farmerHeadXp({ id: 25, cost: 20, brains: true })).toBe(2_000);
  });

  it("pays nothing for the free starter heads", () => {
    expect(farmerHeadXp({ id: 1, cost: 0, brains: false })).toBe(0);
    expect(farmerHeadXp({ id: 1 })).toBe(0);
  });
});
