// Elite invasions — what a Brain Ticket buys.
//
// A Brain Ticket is the Invasion Voucher's expensive cousin: it skips the same
// between-invasions wait, but it also QUADRUPLES the fight's brain and rare-zombie odds
// and, in exchange, promotes the invasion to ELITE — the authored wave fought at scaled
// stats. Nothing else about the raid changes: same enemies, same wave size, same gold,
// same loot table, same hazards. Only the numbers move.
//
// DETERMINISM CONTRACT. The scaling here feeds `buildEnemyUnits` and the boss's
// throw/special/wall configuration, all of which are part of the deterministic fight the
// server replays. The client (RaidManager.beginRaid) and the server (raidVerifier's two
// `buildPinned*` paths) must therefore derive the profile from the SAME inputs — the raid
// id and the session's elite flag — and nothing else. Editing a profile changes every
// elite transcript, so it is a ruleset change: bump RAID_RULESET_VERSION in the same
// commit (see replay.ts).
//
// ---------------------------------------------------------------------------
// CALIBRATION
//
// Difficulty is measured as p* — the weakest army that still wins, expressed as a stat
// multiplier on a 16-strong roster of the best catalog zombies, run headlessly through
// the real BattleSim. Lower p* = easier. eliteInvasion.balance.test.ts computes it and
// asserts the relationships below; these are the values it measured when the table was
// fitted:
//
//   raid                 normal   elite      the rung it was fitted to
//   Old McDonnell's        0.10    0.54      not a p* target — see below
//   Summer Break           0.11    0.54      between Pirates and Robots
//   Tree World             0.10    0.55      between Pirates and Robots
//   Valentine's Day        0.10    0.56      between Pirates and Robots
//   Circus                 0.10    0.65      Robots, normally
//   Lawyers                0.29    0.69      Robots, normally
//   Pirates                0.39    1.59      Video Games, normally
//   Ninjas                 0.76    1.71      Video Games, normally
//   Robots                 0.75    1.93   \
//   Aliens                 0.81    1.89    >  one shared top tier
//   Video Games            2.11    2.48   /
//
// The top tier is why the three hardest invasions take wildly different multipliers: the
// Video Games are already almost there (x1.2 on their stats), so the Robots and the
// Aliens climb to meet them (x2.5 and x3.7). It is a BAND rather than a point: the Video
// Games sit at the top of it because their own baseline is the highest on the ladder —
// they field three knockback units, so BattleSim's reach-of-last-resort fix lifted their
// NORMAL difficulty from 2.11 where it had been 1.59 — and there is no headroom above.
//
// OLD McDONNELL'S IS NOT FITTED TO A p* TARGET, and that is the one place this metric
// let the tuning down. It was fitted to the Pirates (p* 0.40) and measured there — but p*
// only asks "can you win", and against a wave that feeble the answer stayed yes whatever
// the profile did, so the fitted numbers produced a fight that played like the tutorial
// with a bigger boss. Playtested and rejected as far too soft. It is now specified in HIT
// POINTS instead — the ordinary Pirates' bulk, 40,000 across the wave with a 12,000 boss
// — and p* 0.54 is simply where that lands. See its table entry.
//
// THE CEILING IS REAL, and it is why the top tier sits where it does rather than higher.
// A measuring-stick army stops winning the Video Games not far above their elite figure,
// and 20 zombies barely beat 16 (only the front of the formation engages), so army SIZE
// is not the answer either. Elite has to fit under that.
//
// SHAPE, not just size. Each raid spends its budget on the mechanic it is known for, so
// an elite run feels like more of THAT invasion rather than uniform stat inflation.
// ---------------------------------------------------------------------------

import type { BossSpecial, BossThrowConfig, EnemyStat } from "./types";

/** The consumable that starts an elite invasion (Market → Boosts). */
export const BRAIN_TICKET_KEY = "brain_ticket";

/** How much an elite invasion multiplies its brain tiers (brainDrops.brainDropTable)
 *  and its rare-zombie chance (zombieDrops.raidZombieDropRate). The whole point of the
 *  ticket — the difficulty is the price. */
export const ELITE_BRAIN_LUCK = 4;

/** Per-raid stat/behaviour multipliers for an elite fight. Every field multiplies; 1
 *  means "unchanged". */
export interface EliteProfile {
  /** Enemy `str` — per-hit damage (damage = str x 10 x attack multiplier). */
  str: number;
  /** Enemy `con` — hit points (hp = con x 100). Restraint here is deliberate: HP is
   *  what makes a fight LONG, and a fight that outlives the four-minute replay cap
   *  (RAID_MAX_TICKS) cannot settle at all. */
  con: number;
  /** The BOSS's `con`, when it should not scale with the rest of the wave. Absent means
   *  "same as `con`". A separate lever because minions and bosses carry very different
   *  shares of a wave's hit points, so one multiplier cannot place both: Old McDonnell's
   *  boss is 38% of his wave, the Aliens' is 17%, and asking for "a 40,000 wave with a
   *  12,000 boss" is simply not expressible with a single number. */
  bossCon?: number;
  /** Enemy `dex` — attack cadence (interval = 1 / dex seconds). Held to modest values
   *  everywhere: past roughly 1.6x, enemies stop reading as enemies and start reading
   *  as a strobe. */
  dex: number;
  /** Boss projectile damage. */
  throwDamage: number;
  /** Boss projectile RATE — 2 means twice as many throws (half the interval). */
  throwRate: number;
  /** Hit points of the blocker the boss's `wall` special drops (Ninja carrotWall /
   *  Robot junkWall). Capped low on purpose: the wall is tapped down by hand, so a big
   *  multiplier is a big multiplier on MANUAL INPUT, and a wall the army cannot chew
   *  through in time can stalemate a fight into the replay cap. */
  wallHp: number;
  /** Damage of the boss's non-throw specials (alien laser, pixel fire, telekinesis…). */
  specialDamage: number;
}

const PLAIN: EliteProfile = {
  str: 1, con: 1, dex: 1, throwDamage: 1, throwRate: 1, wallHp: 1, specialDamage: 1,
};

/** Fallback for a raid with no authored profile (a new invasion, before it is tuned).
 *  A flat, unremarkable step up — never nothing, so a Brain Ticket is never a pure
 *  refund of 10,000 gold. */
export const DEFAULT_ELITE_PROFILE: EliteProfile = {
  str: 2, con: 1.8, dex: 1.3, throwDamage: 2, throwRate: 1.4, wallHp: 1.4, specialDamage: 2,
};

export const ELITE_PROFILES: Readonly<Record<number, EliteProfile>> = {
  // 1 — Old McDonnell's Farm. No signature mechanic to lean on, so it does what the
  // farmhands would do if they were any good: everything, harder.
  //
  // The con multipliers are the largest in the table BY A MILE, and they are not typos.
  // His wave is the feeblest in the game — 5,200 hit points total, against 34,500 for the
  // Pirates and 132,000 for the Video Games — so a merely-proportionate lift still left
  // every farmhand dying to a single volley and the boss on 5,800 hit points. Playtest
  // verdict on that version: not tanky enough, by a lot.
  //
  // The target is a 40,000 wave with a 12,000 boss — near enough the ORDINARY Pirates
  // (34,500 / 12,000), which is the rung this raid was aimed at all along. Minions and
  // boss need different multipliers to land it (see `bossCon`): x8.75 takes the ten
  // farmhands and lumberjacks from 3,200 to 28,000, and x6 takes the boss from 2,000 to
  // 12,000.
  //
  // Everything ELSE stayed where it was, and that restraint is load-bearing. Lengthening
  // a fight already multiplies the damage taken; raising str on top of it (x4 was tried)
  // turned an unmutated 16-strong roster's casualties into a total wipe. The ask was
  // tankier, so tankiness is the only thing that moved.
  1: { str: 2.9, con: 8.75, bossCon: 6, dex: 1.6, throwDamage: 2.9, throwRate: 1.5, wallHp: 1, specialDamage: 2.9 },

  // 2 — Zombies vs Lawyers. The Corporate boss is the ladder's speed threat: fast
  // punches and the Double Punch stun. So this is the one profile that spends most of
  // its budget on DEX, and the stun special hits hardest of all.
  2: { str: 1.6, con: 1.8, dex: 1.85, throwDamage: 1.8, throwRate: 1.35, wallHp: 1, specialDamage: 2.1 },

  // 3 — Zombies vs Pirates. Pirates hit like a cannon and their Scallywag mirrors your
  // attack speed, so speed is explicitly NOT their lever: dex stays at 1.0 and the whole
  // budget goes into raw power. An elite pirate one-shots almost anything it reaches;
  // the counterplay is the same as it always was — do not bring a fast army.
  //
  // v23 RE-FIT (x1.3 on every multiplier's distance from 1.0, shape untouched). Faithful
  // knockback moved the ladder's TOP rung — the ordinary Video Games invasion — from a
  // measured 1.99 to 2.38, and these three are the profiles the guardrails measure against
  // it: Pirates-elite has to sit near an ordinary Video Games, and Robots/Aliens-elite have
  // to share a band with Video Games-elite. Nothing about their character changed; they
  // moved because the thing they are pinned to did.
  3: { str: 6.59, con: 3.41, dex: 1, throwDamage: 5.29, throwRate: 1, wallHp: 1, specialDamage: 4.9 },

  // 4 — Zombies vs Ninjas. Their mechanic is the carrot WALL, so the wall gets tougher
  // (more taps, and more of the army's damage spent on it) — but only to 1.5x, see
  // `wallHp`. The rest is a broad stat lift.
  4: { str: 2.7, con: 1.7, dex: 1.35, throwDamage: 2.5, throwRate: 1.55, wallHp: 1.5, specialDamage: 2.2 },

  // 5 — Zombies vs Robots. One of each bot, a random one leading, each with its own
  // special (junk wall, telekinesis). Bots are already the tankiest wave in the game, so
  // con is held back and the budget goes into their specials and their punch.
  //
  // v23 RE-FIT (x1.3 on every multiplier's distance from 1.0, shape untouched). Faithful
  // knockback moved the ladder's TOP rung — the ordinary Video Games invasion — from a
  // measured 1.99 to 2.38, and these three are the profiles the guardrails measure against
  // it: Pirates-elite has to sit near an ordinary Video Games, and Robots/Aliens-elite have
  // to share a band with Video Games-elite. Nothing about their character changed; they
  // moved because the thing they are pinned to did.
  5: { str: 2.95, con: 2.11, dex: 1.52, throwDamage: 2.69, throwRate: 1.52, wallHp: 1.65, specialDamage: 3.47 },

  // 6 — Zombies vs Aliens. Twenty minions, a summoning boss and the laser. Their normal
  // fight is already the longest on the ladder (over two minutes), so con barely moves —
  // an elite alien wave is not a longer grind, it is a far more dangerous one.
  //
  // v23 RE-FIT (x1.3 on every multiplier's distance from 1.0, shape untouched). Faithful
  // knockback moved the ladder's TOP rung — the ordinary Video Games invasion — from a
  // measured 1.99 to 2.38, and these three are the profiles the guardrails measure against
  // it: Pirates-elite has to sit near an ordinary Video Games, and Robots/Aliens-elite have
  // to share a band with Video Games-elite. Nothing about their character changed; they
  // moved because the thing they are pinned to did.
  //
  // v27 RE-FIT, and it goes DOWN — the mechanics now supply the danger the multipliers
  // used to have to fake. Two recovered changes pull in opposite directions and the
  // second wins by a distance (see raid/alienStage.ts):
  //   * the SWARM (six aliens at once instead of one) made the raid EASIER against a big
  //     army, because sixteen zombies chewing six targets clear twenty minions in a
  //     fraction of the wall-clock a one-at-a-time queue took;
  //   * the ABDUCTEES made it much harder. They are beamed into the middle of the stage
  //     and stand there, so unlike every other enemy in the game they are not something
  //     the army walks up to — they are a roadblock across the lane that the whole army
  //     has to stop and clear, one after another, for as long as the boss keeps casting.
  // Measured on the balance stick, the ORDINARY invasion went 0.84 -> 0.93 (it is a real
  // fight now, not a queue) and the elite one blew past the stick entirely at 5.16. This
  // brings it back between the Robots and the Video Games, at multipliers well below
  // where they started. Currently measures 0.97 / 2.46, after the playtest passes that
  // settled the minion's str at 5 and moved the wave's hold line right; see
  // UNIT_OVERRIDES in tools/prep_raids.py and ENEMY_HOLD_X in BattleSim.
  //
  // The remaining four are INERT on this raid and are left alone rather than scaled for
  // the look of the table: the alien boss has no `throw` and no `wall`, and its
  // `alienLaser` action carries no authored `damage`, so `specialDamage` multiplies a
  // zero and BattleSim falls through to the flat 200 the binary hard-codes.
  6: { str: 3, con: 1.4, dex: 1.45, throwDamage: 3.28, throwRate: 1.65, wallHp: 1, specialDamage: 4.9 },

  // 7 — Summer Break. No signature boss mechanic (the crab is a client-side hazard and
  // is deliberately left alone — see below), so it scales broadly, with heavier beach
  // balls.
  7: { str: 3.2, con: 3.2, dex: 1.6, throwDamage: 4, throwRate: 1.8, wallHp: 1, specialDamage: 3.2 },

  // 8 — Zombies vs Circus. The ringmaster's juggling act is the mechanic: elite throws
  // come three times as often and hit eight times as hard, which is by far the largest
  // projectile multiplier in the table. The TRAPEZE ARTIST is untouched — it is grabbed
  // zombies and frantic tapping, and multiplying a hazard multiplies manual input rather
  // than difficulty.
  8: { str: 2.8, con: 3, dex: 1.6, throwDamage: 8, throwRate: 3, wallHp: 1, specialDamage: 3 },

  // 9 — Zombies vs Video Games. Already the hardest invasion in the game by a wide
  // margin, so it needs the smallest push to reach the shared top tier — and it spends
  // what it has on turnZombie and pixelFire, the specials that make the fight what it is.
  //
  // v27 RE-FIT (x1.25 on every multiplier's distance from 1.0, shape untouched). Zedzox
  // used to keep casting turnZombie and pixelFire after he came down off his perch;
  // recovering the state gate (`bossUpdate:` only rolls an action in state 19) took both
  // away for the whole ground phase, which is most of the fight. That made the ORDINARY
  // invasion easier — measured 2.42 -> 2.10 on the balance stick — and the elite step
  // shrank with it. Restoring the step is what moved, not the raid's character; it is
  // still by far the smallest profile in the table, as the paragraph above intends.
  9: { str: 1.25, con: 1.19, dex: 1.125, throwDamage: 1.31, throwRate: 1.125, wallHp: 1, specialDamage: 1.44 },

  // 10 / 11 — Tree World and Valentine's Day. Seasonal, no signature mechanic, and the
  // two weakest waves after McDonnell's, so they take the same broad treatment as
  // Summer Break with a little more of it.
  10: { str: 3.8, con: 3.8, dex: 1.6, throwDamage: 4.9, throwRate: 1.9, wallHp: 1, specialDamage: 3.8 },
  11: { str: 3.8, con: 3.8, dex: 1.6, throwDamage: 4.9, throwRate: 1.9, wallHp: 1, specialDamage: 3.8 },
};

/** The multipliers this fight runs under: null for an ordinary invasion (so every
 *  caller can pass the result straight through and the non-elite path stays exactly the
 *  code it was), the raid's profile for an elite one. */
export function eliteProfile(raidId: number, elite: boolean): EliteProfile | null {
  if (!elite) return null;
  return ELITE_PROFILES[raidId] ?? DEFAULT_ELITE_PROFILE;
}

/** Scale one enemy's stat template. Only str/con/dex move — attack lists, boss actions
 *  and the loot flags are the raid's own data and stay untouched. `isBoss` selects
 *  `bossCon` over `con` where a profile sets one. */
export function eliteEnemyStat(
  stat: EnemyStat,
  profile: EliteProfile | null,
  isBoss = false
): EnemyStat {
  if (!profile) return stat;
  return {
    ...stat,
    str: (stat.str ?? 1) * profile.str,
    con: (stat.con ?? 1) * ((isBoss ? profile.bossCon : undefined) ?? profile.con),
    dex: (stat.dex ?? 1) * profile.dex,
  };
}

/** Scale the boss's projectile config: harder hits, and `throwRate` times as many of
 *  them (a rate multiplier DIVIDES the interval). */
export function eliteBossThrow(
  config: BossThrowConfig | null,
  profile: EliteProfile | null
): BossThrowConfig | null {
  if (!config || !profile) return config;
  return {
    intervalMs: config.intervalMs / Math.max(0.01, profile.throwRate),
    options: config.options.map((option) => ({ ...option, damage: option.damage * profile.throwDamage })),
  };
}

/** Scale the boss's non-throw specials. Cast and cooldown are left alone: they are the
 *  player's window to react, and shrinking them turns "harder" into "unreadable". */
export function eliteBossSpecials(
  specials: BossSpecial[],
  profile: EliteProfile | null
): BossSpecial[] {
  if (!profile) return specials;
  return specials.map((special) => ({ ...special, damage: special.damage * profile.specialDamage }));
}

/** Scale the hit points of a boss-summoned wall. */
export function eliteWallHp(hp: number, profile: EliteProfile | null): number {
  return profile ? hp * profile.wallHp : hp;
}

/** Everything an elite fight multiplies, as plain numbers, for the profile table's own
 *  regression test and for tooling. */
export function eliteMultipliers(raidId: number): EliteProfile {
  return eliteProfile(raidId, true) ?? PLAIN;
}
