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

const humpRaw = (hours: number) => (hours / (hours + RISE)) * (FALL / (hours + FALL));
const HUMP_PEAK = humpRaw(PEAK_HOURS);

/**
 * Chance that a ripe vegetable crop yields an active-event fight token.
 *
 * Peaks for crops in the 2-4 hour band, which earn roughly 0.9-1.0 tokens per
 * plot-day. Spam crops sit below that (a 15-minute crop is about 45% of the peak
 * rate, a 30-minute one about 65%), and 24-hour crops are held at the ceiling,
 * which works out to 0.35 tokens per plot-day.
 */
export function epicBossTokenChance(growMs: number, harvestValue: number): number {
  if (!Number.isFinite(growMs) || !Number.isFinite(harvestValue) || growMs <= 0 || harvestValue <= 0) return 0;
  const hours = growMs / 3_600_000;
  const ratePerDay = PEAK_RATE * Math.pow(harvestValue / 200, VALUE_EXP) * (humpRaw(hours) / HUMP_PEAK);
  return Math.min(MAX_TOKEN_CHANCE, (ratePerDay * hours) / 24);
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
