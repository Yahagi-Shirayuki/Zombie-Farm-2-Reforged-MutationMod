import { describe, expect, it } from "vitest";
import {
  dropsEpicBossToken, epicBossTokenChance, epicBossTokenRatePerPlotDay,
  EFFECTIVE_MAX_TOKEN_CHANCE, FLAT_BONUS, SUPPLY_SCALE,
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
  it("gives every crop a live roll, so no harvest is ever a dead pull", () => {
    // The bare grow-time curve puts a 15-minute crop near 0.4% per harvest, which
    // reads as "never" to a player pulling carrots. The flat bonus is a floor on
    // FEEL and every crop must clear it — at the current supply scale, which moves the
    // curve's height without touching its shape (see SUPPLY_SCALE).
    for (const crop of Object.values(CROP)) {
      expect(chance(crop)).toBeGreaterThanOrEqual(FLAT_BONUS * SUPPLY_SCALE);
    }
  });

  it("still raises per-harvest chance with grow time", () => {
    // The hump survives in per-harvest terms even though it no longer decides which
    // crop is the most efficient farm (see below).
    expect(chance(CROP.corn)).toBeGreaterThan(chance(CROP.bloodberry));
    expect(chance(CROP.sunGlower)).toBeGreaterThan(chance(CROP.corn));
    expect(chance(CROP.corpseFlower)).toBeGreaterThan(chance(CROP.sunGlower));
    expect(chance(CROP.heartichoke)).toBeGreaterThan(chance(CROP.corpseFlower));
  });

  it("lets short crops lead on tokens per plot-day — a known cost of the flat bonus", () => {
    // DELIBERATE, not a bug. Three flat points is worth +2.88 tokens/plot-day on a
    // 15-minute crop (96 rolls) and +0.18 on a 4-hour one (6 rolls), so the flat
    // bonus outweighs the hump and short crops are the efficient token farm. This
    // is asserted so that shrinking FLAT_BONUS — which restores the 2-4h peak —
    // shows up as a deliberate change rather than a silent one.
    expect(rate(CROP.meatFlower)).toBeGreaterThan(rate(CROP.sunGlower));
    expect(rate(CROP.meatFlower)).toBeGreaterThan(rate(CROP.skellyberry));
    expect(rate(CROP.skellyberry)).toBeGreaterThan(rate(CROP.bloodberry));
    // The long tail still falls away, so 24-hour crops stay the weakest farm.
    expect(rate(CROP.heartichoke)).toBeLessThan(rate(CROP.corpseFlower));
  });

  it("caps at the recovered ceiling so no crop is ever a guaranteed token", () => {
    // The pin still exists, at the scaled height: the 24-hour band sits ON the ceiling,
    // which is what stops harvest value separating those crops from each other.
    expect(chance(CROP.onion)).toBeCloseTo(EFFECTIVE_MAX_TOKEN_CHANCE, 10);
    expect(chance(CROP.heartichoke)).toBeCloseTo(EFFECTIVE_MAX_TOKEN_CHANCE, 10);
    for (const crop of Object.values(CROP)) {
      expect(chance(crop)).toBeLessThanOrEqual(EFFECTIVE_MAX_TOKEN_CHANCE);
    }
    // The bonus pushes the ceiling down into the 12-hour band; it must not reach
    // the 6-hour band, or harvest value would stop separating the mid crops too.
    expect(chance(CROP.corpseFlower)).toBeLessThan(EFFECTIVE_MAX_TOKEN_CHANCE);
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
