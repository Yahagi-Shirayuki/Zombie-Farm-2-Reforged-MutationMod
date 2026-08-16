import { describe, it, expect } from "vitest";
import { bossThrowIntervalSecs, raidTier, winGold } from "./RaidCatalog";
import type { RaidDef, RaidStage } from "./types";

// winGold: wiki-figure raids scale their known payout by survival; raids without a
// figure fall back to the binary's own formula — standard level×230 + bonus level×100
// (getStandardGoldLootForStageLevel: = level×100×2.3; getBonusGoldLootForStageLevel: = level×100).

const raid = (over: Partial<RaidDef>): RaidDef =>
  ({ goldReward: 0, bonusGold: 0, recommendedLevel: 0, ...over }) as RaidDef;

describe("winGold — wiki-figure raids", () => {
  const r = raid({ goldReward: 4000, bonusGold: 2000, recommendedLevel: 8 });
  it("pays base + bonus on a flawless win", () => expect(winGold(r, 1)).toBe(6000));
  it("scales both base and bonus by survival fraction", () =>
    expect(winGold(r, 0.5)).toBe(3000));
  it("pays nothing when nobody survives", () => expect(winGold(r, 0)).toBe(0));
});

describe("winGold — fallback formula (no wiki figure)", () => {
  it("uses level×230 standard + level×100 bonus", () => {
    const r = raid({ recommendedLevel: 10 }); // 2300 + 1000
    expect(winGold(r, 1)).toBe(3300);
  });
  it("scales the fallback by survival too", () => {
    const r = raid({ recommendedLevel: 10 });
    expect(winGold(r, 0.5)).toBe(Math.round(2300 * 0.5) + Math.round(1000 * 0.5));
  });
});

describe("bossThrowIntervalSecs", () => {
  const mcdonnell = raid({ id: 1, throwSpeed: 2 });
  const other = raid({ id: 2, throwSpeed: 2 });
  const stage = {} as RaidStage;

  it("ramps Old McDonnell from half speed to full strength", () => {
    expect(bossThrowIntervalSecs(mcdonnell, stage, 0)).toBe(4);
    expect(bossThrowIntervalSecs(mcdonnell, stage, 1)).toBe(3);
    expect(bossThrowIntervalSecs(mcdonnell, stage, 2)).toBe(2);
    expect(bossThrowIntervalSecs(mcdonnell, stage, 20)).toBe(2);
  });

  it("scales a stage-authored cadence while preserving other raids", () => {
    const fasterStage = { throwSpeed: 1 } as RaidStage;
    expect(bossThrowIntervalSecs(mcdonnell, fasterStage, 0)).toBe(2);
    expect(bossThrowIntervalSecs(mcdonnell, fasterStage, 1)).toBe(1.5);
    expect(bossThrowIntervalSecs(other, fasterStage, 0)).toBe(1);
  });
});

describe("raidTier", () => {
  it("maps Robots and Aliens to the later ability tiers", () => {
    expect(raidTier(raid({ id: 5 }))).toBe(5);
    expect(raidTier(raid({ id: 6 }))).toBe(6);
  });
});
