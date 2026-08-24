// Friend invasions (PvP) — the shared half.
//
// A friend invasion fights the ATTACKER's chosen eight against a SNAPSHOT of the
// DEFENDER's deployed zombies, on Old McDonnell's stage. Nobody loses anything:
// the defender is only ever a snapshot pinned at /raid/pvp/start, and the finish
// path never touches either roster. Rewards are boosts, priced from the DIFFICULTY
// of the opposing army rather than anyone's level.
//
// Everything here is imported by BOTH the client and the Worker (like repeatXp.ts),
// so the pinned fight config and the reward maths have exactly one definition.
// The fight itself runs the ordinary BattleSim under the ordinary replay ruleset:
// the server returns the complete pinned config from /raid/pvp/start and the client
// ADOPTS it wholesale, so there is no per-side derivation to keep in sync and no
// ruleset bump — a defender zombie is just an enemy-team CombatUnit.
import type { CombatUnit, RaidDef, WaveCadence } from "./types";
import { ATTACK_INTERVAL_SEC, HP_PER_CON, POWER_PER_STR } from "./combatStats";

/** CLIENT KILL SWITCH — normally leave this true: the Invasions surfaces already
 *  follow the WORKER's capability flag (`PVP_ENABLED` in wrangler.toml, surfaced to
 *  the client via the bootstrap's `pvpEnabled`), so the feature launches and parks
 *  with that one Worker var and no client redeploy. This constant exists for the
 *  emergency where the client side itself must be hidden regardless of the server —
 *  set false and redeploy the client (see docs/FRIEND_INVASIONS.md). */
export const PVP_UI_ENABLED = true;

/** Synthetic raid id for friend invasions. Negative like the Epic Boss's -101, so no
 *  catalog rule (stage ladders, alien/video-game specials, McDonnell pacing) matches. */
export const PVP_RAID_ID = -2;

/** An attacking lineup is exactly eight zombies — no more, no fewer. */
export const PVP_ARMY_SIZE = 8;

/** How many defenders a defense fields TODAY: the strongest N of the deployed
 *  (non-crypt) roster, or up to N of an AUTHORED line-up. This is the BASE size —
 *  the customization shop will sell defense-slot upgrades that raise an account's
 *  own cap toward PVP_DEFENSE_CAP_MAX; until those exist, everyone is at base. */
export const PVP_DEFENSE_CAP = 6;

/** The ceiling defense-slot upgrades may reach. Nothing grants slots yet — this is
 *  the design bound the upgrade path builds toward, exported so the loadout editor
 *  and the server validation agree on the day it lands. */
export const PVP_DEFENSE_CAP_MAX = 10;

/** Both sides of a friend invasion must be past the opening arc of the game: level 7
 *  keeps brand-new farms out of the matchmaking pool in either role. */
export const PVP_MIN_LEVEL = 7;

/** Daily income caps, one per role. Fights beyond these still HAPPEN (any number per
 *  day — they are recorded, replayable, and count in the stats), but only the first N
 *  verified wins per UTC day pay the attacker, and only the first N held defenses per
 *  UTC day park a reward for the defender. Capping the income rather than the fights
 *  is what keeps a zero-risk mode from becoming a grind treadmill — and it caps what
 *  collusion can farm, which is why the per-pair attack cap below could relax into a
 *  plain spam guard. */
export const PVP_DAILY_REWARDED_WINS = 3;
export const PVP_DAILY_REWARDED_DEFENSES = 3;

/** How many finished fights keep their pinned config + transcript (per role, per
 *  account) for the replay viewer. Older rows keep their RESULT and reward forever —
 *  someone returning after a month sees and claims everything — but the heavy replay
 *  payload is swept, which is most of a session row's weight. */
export const PVP_REPLAYS_KEPT = 10;

/** Defense wave cadence: a mild swarm (up to 3 on the field, one more every 5 s), so a
 *  16-zombie defense doesn't fight one-at-a-time into the 4-minute sim cap. Pinned into
 *  the config like the alien stage's cadence, so both simulations agree by construction. */
export const PVP_WAVE_CADENCE: WaveCadence = { maxActive: 3, dripMs: 5000 };

/** Attacks one account may open against the SAME friend per UTC day. Income is capped
 *  by PVP_DAILY_REWARDED_WINS / _DEFENSES above, so this is only a spam guard now —
 *  it keeps one pair from generating unbounded session rows, not from farming. */
export const PVP_DAILY_ATTACKS_PER_PAIR = 10;

/** Per-hit damage exactly as BattleSim.toSim derives it (finalPower × attackMult). */
function unitHitDamage(u: CombatUnit): number {
  const mult = u.attacks[0]?.mult ?? 1;
  return Math.max(1, Math.round(u.str * POWER_PER_STR * mult));
}

/** One unit's contribution to an army's FIGHT difficulty: staying power × sustained
 *  output (hp × dps over the built, level-scaled stats). Since the raw-stat tier
 *  system landed this is informational — it ranks the auto defense pick and fills
 *  the attack/defense score columns — and no longer prices rewards. */
export function unitScore(u: CombatUnit): number {
  const dps = unitHitDamage(u) * (1000 / Math.max(1, u.attackCooldownMs));
  return u.maxHp * dps;
}

/** Fight-difficulty score of a whole army (rounded for stable pinning/printing). */
export function armyScore(units: CombatUnit[]): number {
  return Math.round(units.reduce((sum, u) => sum + unitScore(u), 0));
}

/** The per-unit flip both defense builders share:
 *
 *  - team flips to "enemy"; abilities are cleared (nobody is home to tap them) and
 *    `teamAuraStats` is dropped so the sim never re-derives the aura from "deployed
 *    carriers" (defenders are all home — they keep the FULL-team aura already folded
 *    into their public stats). Protect's damageReduction survives the same way.
 *  - `attackCooldownMs` is kept as built (the player-side 2 s/dex clock), so a zombie
 *    is exactly as fast defending as it is attacking — slotting it onto the enemy
 *    side must not halve its swing interval.
 *  - ids are re-minted `d0..dN` like a wave's so nothing downstream confuses them
 *    with the attacker's roster ids.
 */
function toEnemyCopy(u: CombatUnit, i: number): CombatUnit {
  const copy: CombatUnit = { ...u, id: `d${i}`, team: "enemy", abilities: [] };
  delete copy.teamAuraStats;
  delete copy.walkingSpeedMult;
  return copy;
}

/** The AUTO pick (no authored defense): the strongest PVP_DEFENSE_CAP by fight
 *  score, ordered WEAKEST FIRST so the wave ramps up the way an authored stage
 *  does. Returns the units UNCONVERTED (original ids) so the caller can also read
 *  which roster members were fielded — the tier calc needs their pre-level stats. */
export function selectAutoDefense(units: CombatUnit[]): CombatUnit[] {
  return units
    .map((u) => ({ u, score: unitScore(u) }))
    .sort((a, b) => b.score - a.score || a.u.id.localeCompare(b.u.id))
    .slice(0, PVP_DEFENSE_CAP)
    .reverse()
    .map(({ u }) => u);
}

/** Convert an already-selected, already-ordered defense line into the enemy side. */
export function enemyCopies(selected: CombatUnit[]): CombatUnit[] {
  return selected.map((u, i) => toEnemyCopy(u, i));
}

/** The AUTO snapshot in one step (selection + conversion). */
export function toDefenseUnits(units: CombatUnit[]): CombatUnit[] {
  return enemyCopies(selectAutoDefense(units));
}

/** An AUTHORED defense: the defender's saved order IS the emergence order — slot 1
 *  walks out first. Capped at PVP_DEFENSE_CAP; the caller has already filtered the
 *  loadout to still-owned zombies. */
export function orderedDefenseUnits(units: CombatUnit[]): CombatUnit[] {
  return enemyCopies(units.slice(0, PVP_DEFENSE_CAP));
}

// ---------------------------------------------------------------------------
// Tiers. A group's tier is hp × dps — staying power times sustained output — but
// computed from RAW stats: species str/dex/con plus mutation bonuses, exactly what
// `makeOwned` bakes into an OwnedZombie, BEFORE the player-level ramp, veterancy,
// auras and farmer heads. That is the improvement over the v1 tier (which read the
// built fight stats): a level-45 account's lawn of green Regulars is still a lawn
// of green Regulars. FOCUS is deliberately excluded (owner's ruling: a distraction
// stat, not fighting strength). Rewards are priced from the OPPOSING group's tier.
//
// The group score is the PER-SLOT AVERAGE, divided by at least the group's base
// size (defense PVP_DEFENSE_CAP, attack PVP_ARMY_SIZE): count alone can never buy
// a tier (ten greens are still tier 1), and a half-empty defense dilutes toward
// the bottom rather than letting one great zombie read as a great group.
//
// Calibration against the catalog (raw hp×dps per zombie): green 4k ·
// realistically-mutated greens 50–90k · the THEORETICAL max 5-slot mutation set on
// a green 242k (tier 3 starts above it — mutations alone never buy tier 3) ·
// tier-4/5 commons 135k–262k · a fully-mutated Tier-4 market mutant ~1.1M · the
// epic shelf 850k–2.7M, which CANNOT carry mutations — tier 5 is keyed to its top
// half, never to mutation points. Pinned by tests: plain greens = tier 1,
// max-mutated greens = tier 2 (never 3), a top epic group = tier 5 unmutated.
export const PVP_TIER_POINT_THRESHOLDS: ReadonlyArray<number> = [
  25_000, // below: tier 1 (starter farms, plain early normals)
  250_000, // below: tier 2 (mutation-driven greens top out at 242k; mid/late normals)
  800_000, // below: tier 3 (top commons, lower epics)
  1_600_000, // below: tier 4; at/above: tier 5 (the top epic shelf)
];

/** One zombie's tier points: hp × dps over its RAW stats (+ mutations), on the
 *  player-side attack clock (2 s / dex). Focus never enters. */
export function unitTierPoints(u: { str: number; dex: number; con: number }): number {
  const hp = u.con * HP_PER_CON;
  const dps = u.str * POWER_PER_STR * (u.dex / ATTACK_INTERVAL_SEC.player);
  return hp * dps;
}

/** A group's tier score: per-slot average over at least `baseSize` slots. */
export function groupTierPoints(
  units: ReadonlyArray<{ str: number; dex: number; con: number }>,
  baseSize: number
): number {
  const total = units.reduce((sum, u) => sum + unitTierPoints(u), 0);
  return total / Math.max(units.length, baseSize, 1);
}

export function pvpTierForPoints(points: number): number {
  let tier = 1;
  for (const limit of PVP_TIER_POINT_THRESHOLDS) {
    if (points >= limit) tier += 1;
  }
  return tier;
}

export interface PvpReward {
  key: string;
  qty: number;
}

/** Boost bundles per tier. Keys are the boost catalog's; quantities echo the raid
 *  loot bundles (Insta-Grow travels in stacks). Tier 5 is where the Brain Ticket
 *  lives — repelling or beating a top-shelf army is the only PvP path to one. */
export const PVP_TIER_REWARDS: ReadonlyArray<ReadonlyArray<PvpReward>> = [
  [{ key: "insta_grow", qty: 3 }],
  [{ key: "insta_grow", qty: 5 }, { key: "insta_harvest", qty: 2 }],
  [{ key: "insta_grow", qty: 10 }, { key: "golden_dice", qty: 1 }],
  [
    { key: "insta_grow", qty: 10 },
    { key: "invasion_voucher", qty: 1 },
    { key: "concentration", qty: 1 },
  ],
  [
    { key: "brain_ticket", qty: 1 },
    { key: "insta_grow", qty: 10 },
    { key: "golden_dice", qty: 2 },
  ],
];

export function pvpRewardsForTier(tier: number): PvpReward[] {
  const idx = Math.min(PVP_TIER_REWARDS.length, Math.max(1, Math.round(tier))) - 1;
  return PVP_TIER_REWARDS[idx].map((reward) => ({ ...reward }));
}

// ---------------------------------------------------------------------------
// The pinned fight config, as the client consumes it. Structurally a subset of the
// server's PinnedRaidConfig (raidVerifier.ts) plus the `pvp` block — the server
// stores one object that satisfies both, and verifyRaid/createPinnedSim read it
// exactly like a normal raid's.
export interface PvpConfigInfo {
  defenderId: string;
  defenderName: string;
  attackScore: number;
  defenseScore: number;
  /** Reward tier the ATTACKER is paid on a win — the DEFENSE group's raw-stat tier. */
  attackerTier: number;
  /** Reward tier the DEFENDER may claim on a held defense — the ATTACK group's tier. */
  defenderTier: number;
}

/** Synthetic RaidDef for the battle scene: a friend invasion is fought on Old
 *  McDonnell's stage (its backdrop + barn + music), borrowed from the catalog entry
 *  the caller passes in — same trick as the Epic Boss's id -101 def. */
export function buildPvpRaidDef(
  info: { raidName: string; defenderName: string },
  mcdonnell: RaidDef | undefined
): RaidDef {
  return {
    id: PVP_RAID_ID,
    name: info.raidName,
    bossName: info.defenderName,
    bossPortrait: "",
    enemyIcon: "",
    unlockLevel: 0,
    recommendedLevel: 0,
    introText: `${info.defenderName}'s zombies shamble out to defend their turf.`,
    successText: "The farm is yours — for bragging rights, anyway.",
    failureText: "The defense holds. Nobody was hurt (much).",
    xp: 0,
    goldReward: 0,
    bonusGold: 0,
    throwSpeed: 0,
    music: mcdonnell?.music ?? "farmStageBGM.mp3",
    seasonal: true,
    playable: true,
    levelAssets: mcdonnell?.levelAssets ?? [],
    stages: [{ enemyKeys: [] }],
    loot: [],
    obstacleLimit: 0,
    obstacleSpawnSecs: 0,
    obstacleActors: [],
    initialSpawnClass: "",
    hasGrab: false,
  };
}

export interface PvpFightConfig {
  raidId: number;
  raidName: string;
  rosterIds: string[];
  playerUnits: CombatUnit[];
  enemyUnits: CombatUnit[];
  waveCadence: WaveCadence;
  /** Always true for friend invasions: the focus-bubble minigame is skipped on both
   *  simulations, and both sides' units are built at full focus. */
  concentration: boolean;
  pvp: PvpConfigInfo;
}
