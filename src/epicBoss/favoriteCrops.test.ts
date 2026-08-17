import { describe, expect, it } from "vitest";
import plants from "../../public/assets/plants.json";
import { EPIC_BOSSES, epicBossUnlockLevel } from "./catalog";
import {
  EPIC_BOSS_FAVORITE_CROPS,
  EPIC_BOSS_START_RATE_PER_PLOT_DAY,
  bossForFavoriteCrop,
  epicBossStartChance,
  epicBossStartRatePerPlotDay,
  favoriteCropOf,
  isFavoriteCrop,
  luresEpicBoss,
} from "./favoriteCrops";
import { FAVORITE_CROP_TOKEN_BONUS, epicBossTokenChance } from "./tokens";

const HOUR = 3_600_000;
const cropOf = (key: string) => (plants as { key: string; level: number; growMs: number; sell: number }[])
  .find((plant) => plant.key === key);

describe("favourite crop pairings", () => {
  it("pairs every shipped boss with exactly one crop", () => {
    for (const boss of EPIC_BOSSES) {
      expect(favoriteCropOf(boss.id), `${boss.id} has no favourite crop`).toBeTruthy();
    }
    expect(Object.keys(EPIC_BOSS_FAVORITE_CROPS).sort())
      .toEqual([...EPIC_BOSSES].map((boss) => boss.id).sort());
  });

  it("names only real crops", () => {
    for (const [bossId, cropKey] of Object.entries(EPIC_BOSS_FAVORITE_CROPS)) {
      expect(cropOf(cropKey), `${bossId} names unknown crop ${cropKey}`).toBeTruthy();
    }
  });

  // The token bonus keys off the RUNNING event, so a crop shared by two bosses would
  // silently mean "whichever of the two you happened to start".
  it("never gives one crop to two bosses", () => {
    const crops = Object.values(EPIC_BOSS_FAVORITE_CROPS);
    expect(new Set(crops).size).toBe(crops.length);
  });

  // No boss may be gated behind produce the player cannot buy yet. The reverse gap is
  // fine and expected: the start roll is simply suppressed until the boss unlocks.
  it("unlocks every favourite crop at or below its boss's level", () => {
    for (const [bossId, cropKey] of Object.entries(EPIC_BOSS_FAVORITE_CROPS)) {
      const crop = cropOf(cropKey)!;
      expect(crop.level, `${cropKey} unlocks after ${bossId}`).toBeLessThanOrEqual(epicBossUnlockLevel(bossId));
    }
  });

  // A flat per-plot-day rate forces a short crop's per-harvest chance toward zero. Below
  // four hours that stops being a rare drop and starts being an invisible one.
  it("keeps every favourite crop at four hours or longer", () => {
    for (const cropKey of Object.values(EPIC_BOSS_FAVORITE_CROPS)) {
      expect(cropOf(cropKey)!.growMs, `${cropKey} grows too fast to be a lure`).toBeGreaterThanOrEqual(4 * HOUR);
    }
  });

  it("resolves a crop back to its boss and nothing else back to anything", () => {
    expect(bossForFavoriteCrop("broccoli")).toBe("rocky-rhino");
    expect(bossForFavoriteCrop("carrot")).toBeNull();
    expect(bossForFavoriteCrop(null)).toBeNull();
    expect(isFavoriteCrop("rocky-rhino", "broccoli")).toBe(true);
    expect(isFavoriteCrop("rocky-rhino", "potato")).toBe(false);
    // A zombie crop reports no key at all; that is nobody's favourite, not everybody's.
    expect(isFavoriteCrop("rocky-rhino", undefined)).toBe(false);
    expect(isFavoriteCrop(null, "broccoli")).toBe(false);
  });
});

describe("lure rate", () => {
  it("quotes the headline rate for a 24-hour crop", () => {
    expect(epicBossStartRatePerPlotDay(24 * HOUR)).toBeCloseTo(EPIC_BOSS_START_RATE_PER_PLOT_DAY, 10);
    expect(epicBossStartChance(24 * HOUR)).toBeCloseTo(EPIC_BOSS_START_RATE_PER_PLOT_DAY, 10);
  });

  // The calibration the rate was set against: 75 plots at 75% uptime is 56.25 plot-days
  // a day, and that farm should draw an event about every three days.
  it("draws one event every ~3 days on a 75-plot patch at 75% uptime", () => {
    const perDay = epicBossStartRatePerPlotDay(24 * HOUR) * 75 * 0.75;
    expect(1 / perDay).toBeGreaterThan(2.5);
    expect(1 / perDay).toBeLessThan(3.5);
  });

  // Shorter crops sit slightly below the long ones per day — a garnish, not a gate.
  it("tilts gently toward longer grow times", () => {
    const long = epicBossStartRatePerPlotDay(24 * HOUR);
    const short = epicBossStartRatePerPlotDay(4 * HOUR);
    expect(short).toBeLessThan(long);
    expect(short / long).toBeGreaterThan(0.7);
    // Per PLOT-DAY, not per harvest: the 4-hour crop must not be the efficient lure.
    expect(short / long).toBeLessThan(1);
  });

  it("scales per-harvest chance down with grow time so plot-days stay comparable", () => {
    // Six 4-hour harvests must not beat one 24-hour harvest by much.
    const shortPerDay = epicBossStartChance(4 * HOUR) * 6;
    const longPerDay = epicBossStartChance(24 * HOUR);
    expect(shortPerDay).toBeLessThan(longPerDay);
    expect(shortPerDay / longPerDay).toBeGreaterThan(0.7);
  });

  it("stays a rare drop on every shipped favourite", () => {
    for (const cropKey of Object.values(EPIC_BOSS_FAVORITE_CROPS)) {
      const chance = epicBossStartChance(cropOf(cropKey)!.growMs);
      expect(chance).toBeGreaterThan(0);
      expect(chance, `${cropKey} lures too often`).toBeLessThan(0.01);
    }
  });

  it("refuses nonsense grow times rather than dividing by them", () => {
    expect(epicBossStartChance(0)).toBe(0);
    expect(epicBossStartChance(-1)).toBe(0);
    expect(epicBossStartChance(Number.NaN)).toBe(0);
    expect(epicBossStartRatePerPlotDay(0)).toBe(0);
  });

  it("rolls against the chance", () => {
    const chance = epicBossStartChance(24 * HOUR);
    expect(luresEpicBoss(24 * HOUR, () => chance * 0.5)).toBe(true);
    expect(luresEpicBoss(24 * HOUR, () => chance)).toBe(false);
    expect(luresEpicBoss(24 * HOUR, () => 0.99)).toBe(false);
  });
});

describe("favourite crop token bonus", () => {
  it("pays a quarter more tokens than the same crop would otherwise", () => {
    for (const cropKey of Object.values(EPIC_BOSS_FAVORITE_CROPS)) {
      const crop = cropOf(cropKey)!;
      const plain = epicBossTokenChance(crop.growMs, crop.sell);
      const favored = epicBossTokenChance(crop.growMs, crop.sell, true);
      expect(favored / plain).toBeCloseTo(1 + FAVORITE_CROP_TOKEN_BONUS, 10);
    }
  });

  // The bonus lands outside the ceiling clamp on purpose: three of the eight favourites
  // are 24-hour crops, and the whole 24-hour band is pinned to that ceiling. Folded in
  // before the clamp, the bonus would vanish on exactly the crops planted for it.
  it("survives on the crops that sit on the ceiling", () => {
    const pinned = epicBossTokenChance(24 * HOUR, 99);
    expect(pinned).toBeCloseTo(epicBossTokenChance(24 * HOUR, 999), 10); // clamped
    expect(epicBossTokenChance(24 * HOUR, 99, true)).toBeGreaterThan(pinned);
  });

  it("leaves an unfavoured harvest exactly where it was", () => {
    expect(epicBossTokenChance(4 * HOUR, 97, false)).toBe(epicBossTokenChance(4 * HOUR, 97));
  });
});
