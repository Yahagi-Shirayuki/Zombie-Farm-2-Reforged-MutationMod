/** Every Epic Boss has a FAVOURITE CROP: the one thing growing on this farm it cannot
 *  leave alone. Harvesting it does two things, both of them for that boss and no other:
 *
 *    1. While that boss's event is running, the crop yields Boss Tokens more often
 *       (FAVORITE_CROP_TOKEN_BONUS, applied in tokens.ts).
 *    2. While NO event is running, the harvest can — very rarely — lure the boss onto
 *       the farm and start its event outright, free.
 *
 *  The player steers which boss they might draw purely by what they plant, which is the
 *  whole point of the pairing: it gives a late-game crop choice a reason beyond gold.
 *
 *  PAIRING RULES. Every entry below satisfies all three, and favoriteCrops.test.ts holds
 *  them, so a new event must be paired deliberately rather than by whatever is free:
 *
 *  - The crop unlocks at or below its boss's own unlock level, so no boss is gated
 *    behind produce the player cannot buy yet. Some gaps are wide (Garlic at 10 vs
 *    General Larvaelus at 32) and that is fine — the start roll is simply suppressed
 *    until the boss unlocks, invisibly, because the drop is a surprise either way.
 *  - Grow time is at least 4 hours. The start rate is flat per PLOT-DAY (see below), so
 *    a 15-minute crop would have to carry a ~1-in-50,000 per-harvest chance to be worth
 *    the same per day. That is correct arithmetic and terrible feel — and untestable by
 *    hand — so the short crops are simply not eligible to be anyone's favourite.
 *  - No crop is two bosses' favourite. The token bonus keys off the ACTIVE event, so a
 *    shared crop would silently mean "whichever of the two you happened to start".
 *
 *  Seven of the eight are already mutation crops (zombie/cropMutations.ts), which is
 *  deliberate: those are the crops a developed farm keeps in the ground next to its
 *  zombie plots anyway, so this rides on planting the player already does instead of
 *  demanding a dedicated patch. Corpse Flower is the exception — the one expensive late
 *  crop with no second job — which is exactly why it draws the last boss on the ladder.
 */
export const EPIC_BOSS_FAVORITE_CROPS: Readonly<Record<string, string>> = {
  // A burrowing root-raider and the crop you dig out of the ground. Dr. Groundhog's own
  // loot chain ends in a Distillery, and a potato still is what that is built for.
  "dr-groundhog": "potato",
  // Rival fly-eaters, arguing over the same lunch. Bully Frog's loot literally includes
  // "Bully Frog's Carnivorous Plants" — the pairing is the boss's own decor.
  "bully-frog": "venus_flytrap",
  // Brock Coley, the zombie this event pays out, is a broccoli pun wearing a helmet.
  "rocky-rhino": "broccoli",
  // Garlic is the gardener's classic grub repellent. The grub general takes it personally.
  "general-larvaelus": "garlic",
  // A long green pod on a coiling vine, which is a mamba in everything but temperament.
  "mystical-mamba": "lima_beans",
  // A cactus fruit whose flower opens for a single night — the owl's working hours.
  "foul-owl": "dragon_fruit",
  // Rotting pumpkin is a smell with opinions, and Skunkarella respects that.
  "skunkarella": "pumpking",
  // The corpse flower's entire biology is summoning a swarm of insects to itself.
  "loco-locust": "corpse_flower",
};

const BOSS_BY_CROP = new Map(
  Object.entries(EPIC_BOSS_FAVORITE_CROPS).map(([bossId, cropKey]) => [cropKey, bossId])
);

/** The crop this boss cannot resist, or null for a future event with no pairing yet. */
export function favoriteCropOf(bossId: string | null | undefined): string | null {
  return bossId ? EPIC_BOSS_FAVORITE_CROPS[bossId] ?? null : null;
}

/** The boss a harvested crop belongs to, or null if it is nobody's favourite. */
export function bossForFavoriteCrop(cropKey: string | null | undefined): string | null {
  return cropKey ? BOSS_BY_CROP.get(cropKey) ?? null : null;
}

/** Is `cropKey` this boss's favourite? Both sides must be present — a harvest with no
 *  crop key (a zombie crop) is nobody's favourite rather than everybody's. */
export function isFavoriteCrop(
  bossId: string | null | undefined, cropKey: string | null | undefined
): boolean {
  return !!bossId && !!cropKey && EPIC_BOSS_FAVORITE_CROPS[bossId] === cropKey;
}

/** Base rate at which a favourite crop lures its boss onto the farm, in events per
 *  PLOT-DAY of that crop — the same unit the token curve is tuned in (tokens.ts), and
 *  for the same reason: a plot is recyclable, so per-harvest chance alone would make
 *  the shortest grow timer the efficient farm. Quoted for a 24-hour crop; shorter ones
 *  sit slightly below it (see EPIC_BOSS_START_TIME_TILT).
 *
 *  CALIBRATION. A dedicated farmer running 75 plots of one favourite crop at 75% uptime
 *  harvests 56.25 plot-days a day, which at this rate is one lured event every ~3 days —
 *  the figure this was asked to hit. A casual 8-plot patch at half uptime waits about six
 *  weeks, which is the other end of the intended shape: a windfall nobody is owed.
 *
 *  75 plots is a DEDICATED PATCH, not the ceiling. The farm upgrades 30->40->50->60->70
 *  (shopCatalog.ts SIZE_TIERS), and at 70 the server caps plots at
 *  `MAX_FARM_PLOTS` = floor(70/4)^2 = 289 — that one is derived and exact. The ~200 a
 *  real farm is left with after buildings, the zombie patch and walking room is an
 *  ESTIMATE and has never been measured against an actual maxed layout; treat it as the
 *  right order of magnitude, not a figure to calibrate against. This rate is linear in
 *  plot count and nothing else damps it:
 *
 *      plots  uptime   days to a lure   share of time an event is running
 *          8     50%           41.7            25%
 *         40     75%            5.6            72%
 *         75     75%            3.0            83%
 *        200     75%            1.1            93%
 *
 *  The only thing bounding the top end is the gate — a lure rolls only when NO event is
 *  running, and an event runs 14 days — so the ceiling on FREQUENCY is one per 14 days
 *  however large the farm. What that does not bound is UPTIME: a 200-plot farm is very
 *  rarely eligible to roll and very rarely without an event either.
 *
 *  THE NUMBER THAT DECIDES WHETHER ANY OF THIS MATTERS is the plot count at which the
 *  expected wait drops below the 14 days an event lasts, because below that the lure is
 *  noise and above it events overlap continuously. It is about a DOZEN plots of one
 *  favourite: 11.9 for a 24-hour crop, 15.6 for Broccoli's 4-hour one. The feature
 *  switches on across a narrow band and saturates by thirty.
 *
 *  THE HIGH-UPTIME END IS ACCEPTED, deliberately — but NOT for the reason first written
 *  here, which does not survive its own arithmetic. That argument was that a running
 *  event is a ten-rung grind gated by token supply, so a farm big enough to keep one
 *  permanently live spends most of it unable to afford attempts. A ladder costs an
 *  ordinary army ~45 attempts (CHANGELOG, the 60-second window), and a favourite crop
 *  pays 0.11-0.33 tokens per plot-day (tokens.ts), so 45 attempts' worth arrives inside
 *  one 14-day event at ~10 plots of Pumpking, ~12 of Garlic, ~29 of Potato. That is the
 *  SAME band the lure turns on in. Token supply therefore stops binding at roughly the
 *  farm size where events start overlapping, and cannot be what makes the overlap
 *  harmless. What is actually being accepted is the overlap itself, on the judgement
 *  that a permanently available grind is a fair reward for a farm given over to one
 *  crop. If a playtest disagrees, a cooldown after an event ENDS is the lever that caps
 *  uptime at any farm size; scaling this constant down is the wrong one, because it
 *  punishes the casual patch first and the 200-plot farm barely at all. */
export const EPIC_BOSS_START_RATE_PER_PLOT_DAY = 0.006;

/** How much a shorter grow time is penalised, as an exponent on (hours / 24).
 *
 *  Zero would make every favourite crop exactly equal per plot-day. A small positive
 *  number tilts the long crops slightly ahead — Broccoli's 4 hours earns 76% of a
 *  24-hour crop's daily rate, Cauliflower-length 12 hours earns 90% — which keeps the
 *  patient crop marginally the better lure without ever making the quick one pointless.
 *  Anything much above ~0.3 starts to reproduce the per-harvest bias this unit exists
 *  to remove, so treat this as a garnish, not a lever. */
export const EPIC_BOSS_START_TIME_TILT = 0.15;

/** This crop's lure rate in events per plot-day, if it is replanted the instant it is
 *  harvested. Balance work should reason in these units, not per-harvest chance. */
export function epicBossStartRatePerPlotDay(growMs: number): number {
  if (!Number.isFinite(growMs) || growMs <= 0) return 0;
  const hours = growMs / 3_600_000;
  return EPIC_BOSS_START_RATE_PER_PLOT_DAY * Math.pow(hours / 24, EPIC_BOSS_START_TIME_TILT);
}

/** Chance that ONE harvest of this crop lures its boss. The rate above spread back over
 *  a single grow cycle, so two crops of different length are close to equal per day and
 *  the player is never pushed onto a timer they do not want to farm. */
export function epicBossStartChance(growMs: number): number {
  if (!Number.isFinite(growMs) || growMs <= 0) return 0;
  const hours = growMs / 3_600_000;
  return epicBossStartRatePerPlotDay(growMs) * (hours / 24);
}

/** Did this harvest lure its boss? Caller has already checked that the crop IS a
 *  favourite, that no event is running, and that the boss is unlocked. */
export function luresEpicBoss(growMs: number, random: () => number = Math.random): boolean {
  return random() < epicBossStartChance(growMs);
}
