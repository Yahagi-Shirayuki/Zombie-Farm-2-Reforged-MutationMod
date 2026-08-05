/** One paid attempt when the player has no harvested event token. Post-brainflation
 *  revert: 1 brain (was 10), now that a brain is ~10x more valuable. */
export const EPIC_BOSS_FIGHT_BRAIN_COST = 1;
export type EpicBossPayment = "token" | "brains";

/** The recovered `epicEventStarterLootAppearChance` from the shipped game, rolled by
 *  `EpicEventManager harvestEventTriggered`. That pickup started the event in the
 *  original build; Reforged reuses the rate as the per-harvest ceiling for attempt
 *  tokens. It is the reason no crop can ever be a guaranteed token. */
export const MAX_TOKEN_CHANCE = 0.35;

// Token supply is designed against tokens per PLOT-DAY, not per harvest, because a
// plot can be recycled: a 15-minute crop harvests 96 times a day and a 24-hour crop
// once. The earlier `0.35 * sqrt(time * value)` rule was documented as favouring long
// crops, but per plot-hour it did the exact opposite — its rate went as
// sqrt(value/hours), so a 15-minute Meat Flower out-earned a 24-hour Heartichoke
// 4.3 to 1 and the efficient play was to spam the shortest crop you owned.
//
// The rate is now an explicit hump in grow time, peaking in the 2-4 hour band:
//
//     rate/plot-day = PEAK_RATE * (value/200)^VALUE_EXP * hump(hours)
//     hump(h)       = (h / (h + RISE)) * (FALL / (h + FALL)), normalised to 1 at its peak
//
// RISE controls how fast short crops climb toward the peak and FALL how fast long
// ones drop away; the peak sits at sqrt(RISE * FALL). Harvest value still separates
// crops of equal grow time, but with a weak exponent so the time band dominates —
// at 4 hours the spread from Tomatoes to Sun Glower is about 1.4x.
//
// Per-crop chance is then the rate spread back over one grow cycle, clamped to the
// recovered ceiling. The clamp is what stops 24-hour crops becoming near-certain
// tokens; it binds only on the 24-hour band, so every shorter crop is still ranked
// by both of its axes.
const PEAK_HOURS = 2;
const RISE = 0.3;
const FALL = (PEAK_HOURS * PEAK_HOURS) / RISE;
const PEAK_RATE = 1.05;
const VALUE_EXP = 0.2;

// Flat bonus added to every crop's per-harvest chance, applied after the hump and
// before the ceiling. This is a deliberate FLOOR ON FEEL, not a rate adjustment: the
// bare hump gives a 15-minute crop about 0.4% per harvest, so a player pulling
// carrots effectively never saw a token even though the plot earned a reasonable
// amount per day.
//
// Be aware of what it costs, because the leverage is very uneven. Three points of
// flat chance is worth +2.88 tokens per plot-day on a 15-minute crop (96 rolls) and
// only +0.18 on a 4-hour one (6 rolls). It therefore ADDS BACK the short-crop
// dominance the hump was shaped to remove: the per-plot-day ranking is now
// 15m 3.3, 30m 2.1, 1h 1.5, 2h 1.2, 4h 1.15, 24h 0.35, and total supply roughly
// doubles. The hump still controls the per-HARVEST curve and the shape of the
// mid/long bands; it no longer decides which crop is the most efficient farm.
// Anything that shrinks this bonus restores the 2-4 hour peak.
const FLAT_BONUS = 0.03;

const humpRaw = (hours: number) => (hours / (hours + RISE)) * (FALL / (hours + FALL));
const HUMP_PEAK = humpRaw(PEAK_HOURS);

/**
 * Chance that a ripe vegetable crop yields an active-event fight token.
 *
 * Rises with grow time and (weakly) with harvest value, plus a flat 3-point bonus so
 * no crop is ever a dead roll, all clamped to the recovered 35% ceiling. Everything
 * from 8 hours up sits at or near that ceiling; the 24-hour band is pinned to it, so
 * harvest value stops separating those crops.
 */
export function epicBossTokenChance(growMs: number, harvestValue: number): number {
  if (!Number.isFinite(growMs) || !Number.isFinite(harvestValue) || growMs <= 0 || harvestValue <= 0) return 0;
  const hours = growMs / 3_600_000;
  const ratePerDay = PEAK_RATE * Math.pow(harvestValue / 200, VALUE_EXP) * (humpRaw(hours) / HUMP_PEAK);
  return Math.min(MAX_TOKEN_CHANCE, (ratePerDay * hours) / 24 + FLAT_BONUS);
}

/** Expected tokens per plot-day if the crop is replanted the instant it is harvested.
 *  This is the quantity the curve above is actually tuned against, so balance work
 *  and tests should reason in these units rather than per-harvest chance. */
export function epicBossTokenRatePerPlotDay(growMs: number, harvestValue: number): number {
  if (!Number.isFinite(growMs) || growMs <= 0) return 0;
  return epicBossTokenChance(growMs, harvestValue) * (86_400_000 / growMs);
}

export function dropsEpicBossToken(
  growMs: number,
  harvestValue: number,
  random: () => number = Math.random
): boolean {
  return random() < epicBossTokenChance(growMs, harvestValue);
}
