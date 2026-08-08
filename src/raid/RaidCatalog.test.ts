import { describe, it, expect } from "vitest";
import { bossThrowIntervalSecs, boostDrops, winGold } from "./RaidCatalog";
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

describe("boostDrops — the invasion card's boost list", () => {
  const catalog = [
    { key: "insta_grow", name: "Insta-Grow" },
    { key: "insta_plow", name: "Insta-Plow" },
    { key: "invasion_voucher", name: "Invasion Voucher" },
  ];

  it("keeps only the loot names that are boosts, in tier order", () => {
    const r = raid({ loot: [["Bonus Gold"], ["Haystack"], ["Insta-Plow", "Insta-Grow"], ["Windmill"]] });
    expect(boostDrops(r, catalog)).toEqual([
      { key: "insta_plow", name: "Insta-Plow", qty: 1 },
      { key: "insta_grow", name: "Insta-Grow", qty: 10 },
    ]);
  });

  it("names a boost once even when two tiers list it (Valentine's Day)", () => {
    const r = raid({ loot: [["Invasion Voucher", "Invasion Voucher"], ["Invasion Voucher"]] });
    expect(boostDrops(r, catalog)).toEqual([
      { key: "invasion_voucher", name: "Invasion Voucher", qty: 1 },
    ]);
  });

  it("is empty for a table of pure objects", () => {
    expect(boostDrops(raid({ loot: [["Bonus Gold"], ["Pyramid"]] }), catalog)).toEqual([]);
  });
});
