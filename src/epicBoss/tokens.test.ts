import { describe, expect, it } from "vitest";
import {
  dropsEpicBossToken, epicBossTokenChance, epicBossTokenRatePerPlotDay, MAX_TOKEN_CHANCE,
} from "./tokens";

const H = 3_600_000;
/** Real crops, so the curve stays pinned to the shipped economy rather than to
 *  arbitrary numbers that could drift away from anything actually plantable. */
const CROP = {
  meatFlower: [0.25 * H, 38],   // shortest crop in the game
  skellyberry: [0.5 * H, 54],
  bloodberry: [1 * H, 72],
  corn: [2 * H, 79],
  tomato: [4 * H, 31],          // cheapest crop in the peak band
  sunGlower: [4 * H, 181],      // richest crop in the peak band
  corpseFlower: [6 * H, 240],
  eyebiscus: [12 * H, 158],
  onion: [24 * H, 60],
  heartichoke: [24 * H, 213],
} as const;
const rate = ([g, v]: readonly [number, number]) => epicBossTokenRatePerPlotDay(g, v);
const chance = ([g, v]: readonly [number, number]) => epicBossTokenChance(g, v);

describe("Epic Boss crop tokens", () => {
  it("peaks in the 2-4 hour band, measured per plot-day", () => {
    // The quantity that matters is tokens per plot-day, because a plot is recycled:
    // a 15-minute crop harvests 96 times a day and a 24-hour crop once. The old
    // sqrt(time * value) rule was documented as favouring long crops but peaked at
    // the SHORTEST one, which made spamming the cheapest quick crop optimal.
    const peak = rate(CROP.sunGlower);
    expect(peak).toBeGreaterThan(rate(CROP.corn));
    expect(peak).toBeGreaterThan(rate(CROP.corpseFlower));
    expect(peak).toBeGreaterThan(rate(CROP.bloodberry));
    expect(peak).toBeGreaterThan(rate(CROP.eyebiscus));
    expect(peak).toBeGreaterThan(rate(CROP.heartichoke));
  });

  it("leaves spam crops below the peak without making them pointless", () => {
    const peak = rate(CROP.sunGlower);
    // Anti-spam pressure, not a ban: a 15-minute crop earns clearly less per
    // plot-day than the peak band while staying a real fraction of it.
    expect(rate(CROP.meatFlower) / peak).toBeGreaterThan(0.3);
    expect(rate(CROP.meatFlower) / peak).toBeLessThan(0.6);
    // Half-hour through two-hour crops climb steadily toward the peak.
    expect(rate(CROP.skellyberry)).toBeGreaterThan(rate(CROP.meatFlower));
    expect(rate(CROP.bloodberry)).toBeGreaterThan(rate(CROP.skellyberry));
    expect(rate(CROP.corn)).toBeGreaterThan(rate(CROP.bloodberry));
  });

  it("caps 24-hour crops so no crop is ever a guaranteed token", () => {
    expect(chance(CROP.onion)).toBe(MAX_TOKEN_CHANCE);
    expect(chance(CROP.heartichoke)).toBe(MAX_TOKEN_CHANCE);
    for (const crop of Object.values(CROP)) {
      expect(chance(crop)).toBeLessThanOrEqual(MAX_TOKEN_CHANCE);
    }
    // The cap must not reach down into the shorter bands, or harvest value would
    // stop separating those crops at all.
    expect(chance(CROP.eyebiscus)).toBeLessThan(MAX_TOKEN_CHANCE);
    expect(chance(CROP.corpseFlower)).toBeLessThan(MAX_TOKEN_CHANCE);
  });

  it("still ranks crops of equal grow time by harvest value", () => {
    expect(rate(CROP.sunGlower)).toBeGreaterThan(rate(CROP.tomato));
    // Weakly, though — the grow-time band is meant to dominate the choice.
    expect(rate(CROP.sunGlower) / rate(CROP.tomato)).toBeLessThan(2);
  });

  it("uses an injectable roll and rejects crops with no time or value", () => {
    expect(dropsEpicBossToken(0, 100, () => 0)).toBe(false);
    expect(epicBossTokenChance(60 * 60_000, 0)).toBe(0);
    expect(epicBossTokenChance(Number.NaN, 100)).toBe(0);
    const c = epicBossTokenChance(60 * 60_000, 100);
    expect(dropsEpicBossToken(60 * 60_000, 100, () => c - 0.001)).toBe(true);
    expect(dropsEpicBossToken(60 * 60_000, 100, () => c)).toBe(false);
  });
});
