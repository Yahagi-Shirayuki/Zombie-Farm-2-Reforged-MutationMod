import { describe, expect, it } from "vitest";
import {
  BRAIN_PITY_AMOUNT,
  BRAIN_PITY_INVASIONS,
  brainDropTable,
  nextBrainDryStreak,
  rollBrainDrop,
  rollBrainDropWithPity,
} from "./brainDrops";

describe("invasion brain drops", () => {
  it("doubles rate without changing the 5/3/1 awards", () => {
    expect(brainDropTable(20)).toEqual([
      { amount: 5, chance: 0.02 },
      { amount: 3, chance: 0.04 },
      { amount: 1, chance: 0.1 },
    ]);
  });

  it("rolls rarest-first and awards at most one tier", () => {
    expect(rollBrainDrop(20, () => 0.019)).toBe(5);
    const rolls = [0.5, 0.039];
    expect(rollBrainDrop(20, () => rolls.shift() ?? 1)).toBe(3);
    expect(rollBrainDrop(20, () => 1)).toBe(0);
  });
});

describe("brain pity floor", () => {
  const dry = () => 1; // every tier misses

  it("pays nothing while the dry streak is short of the threshold", () => {
    for (let streak = 0; streak < BRAIN_PITY_INVASIONS; streak++) {
      expect(rollBrainDropWithPity(20, streak, dry)).toBe(0);
    }
  });

  it("guarantees the smallest stack once the streak reaches the threshold", () => {
    expect(rollBrainDropWithPity(20, BRAIN_PITY_INVASIONS, dry)).toBe(BRAIN_PITY_AMOUNT);
    expect(BRAIN_PITY_AMOUNT).toBe(1);
  });

  it("never overrides a natural roll — luck beats the floor", () => {
    expect(rollBrainDropWithPity(20, BRAIN_PITY_INVASIONS, () => 0.019)).toBe(5);
    expect(rollBrainDropWithPity(20, 0, () => 0.019)).toBe(5);
  });

  it("counts a dry invasion up and resets on any brain", () => {
    let streak = 0;
    for (let i = 0; i < BRAIN_PITY_INVASIONS; i++) streak = nextBrainDryStreak(streak, 0);
    expect(streak).toBe(BRAIN_PITY_INVASIONS);
    // The guaranteed brain lands, and the next invasion starts from scratch.
    expect(nextBrainDryStreak(streak, rollBrainDropWithPity(20, streak, dry))).toBe(0);
    expect(rollBrainDropWithPity(20, 0, dry)).toBe(0);
  });

  it("clamps the stored streak and shrugs off a garbage value", () => {
    expect(nextBrainDryStreak(BRAIN_PITY_INVASIONS, 0)).toBe(BRAIN_PITY_INVASIONS);
    expect(nextBrainDryStreak(999, 0)).toBe(BRAIN_PITY_INVASIONS);
    expect(nextBrainDryStreak(-5, 0)).toBe(1);
    expect(nextBrainDryStreak(3, 3)).toBe(0);
  });

  it("takes at most nine invasions to see a brain, however unlucky", () => {
    let streak = 0;
    let paid = 0;
    for (let invasion = 1; invasion <= BRAIN_PITY_INVASIONS + 1; invasion++) {
      const brains = rollBrainDropWithPity(20, streak, dry);
      if (brains > 0) paid = invasion;
      streak = nextBrainDryStreak(streak, brains);
    }
    expect(paid).toBe(BRAIN_PITY_INVASIONS + 1);
  });
});
