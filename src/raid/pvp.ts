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
import { POWER_PER_STR } from "./combatStats";

/** FEATURE SWITCH — friend invasions are fully built and verified but PARKED while the
 *  interface is redesigned (see docs/FRIEND_INVASIONS.md). This constant hides every
 *  client surface (the Invade button, the Friends-panel invasions section, the launch
 *  hook); the Worker independently refuses new attacks unless its PVP_ENABLED var is
 *  "1" (wrangler.toml). Flip both together to bring the feature back. */
export const PVP_UI_ENABLED = false;

/** Synthetic raid id for friend invasions. Negative like the Epic Boss's -101, so no
 *  catalog rule (stage ladders, alien/video-game specials, McDonnell pacing) matches. */
export const PVP_RAID_ID = -2;

/** An attacking lineup is exactly eight zombies — no more, no fewer. */
export const PVP_ARMY_SIZE = 8;

/** How many defenders the snapshot fields: the strongest N of the defender's deployed
 *  (non-crypt) roster. Matches the base farm army cap. */
export const PVP_DEFENSE_CAP = 16;

/** Defense wave cadence: a mild swarm (up to 3 on the field, one more every 5 s), so a
 *  16-zombie defense doesn't fight one-at-a-time into the 4-minute sim cap. Pinned into
 *  the config like the alien stage's cadence, so both simulations agree by construction. */
export const PVP_WAVE_CADENCE: WaveCadence = { maxActive: 3, dripMs: 5000 };

/** Attacks one account may open against the SAME friend per UTC day. The whole reward
 *  loop is zero-risk, so the pair cap is what keeps two friends from farming each other. */
export const PVP_DAILY_ATTACKS_PER_PAIR = 3;

/** Per-hit damage exactly as BattleSim.toSim derives it (finalPower × attackMult). */
function unitHitDamage(u: CombatUnit): number {
  const mult = u.attacks[0]?.mult ?? 1;
  return Math.max(1, Math.round(u.str * POWER_PER_STR * mult));
}

/** One unit's contribution to an army's difficulty: staying power × sustained output.
 *  hp × dps is deliberately simple — it reads the same post-aura, post-mutation,
 *  post-veterancy stats the sim fights with, so mutations and veterancy count and a
 *  token defense scores low whatever level its owner is. */
export function unitScore(u: CombatUnit): number {
  const dps = unitHitDamage(u) * (1000 / Math.max(1, u.attackCooldownMs));
  return u.maxHp * dps;
}

/** Difficulty score of a whole army (rounded for stable pinning/printing). */
export function armyScore(units: CombatUnit[]): number {
  return Math.round(units.reduce((sum, u) => sum + unitScore(u), 0));
}

/** Convert a defender's `buildPlayerUnits` output into the enemy-side snapshot.
 *
 *  - team flips to "enemy"; abilities are cleared (nobody is home to tap them) and
 *    `teamAuraStats` is dropped so the sim never re-derives the aura from "deployed
 *    carriers" (defenders are all home — they keep the FULL-team aura already folded
 *    into their public stats). Protect's damageReduction survives the same way.
 *  - `attackCooldownMs` is kept as built (the player-side 2 s/dex clock), so a zombie
 *    is exactly as fast defending as it is attacking — slotting it onto the enemy
 *    side must not halve its swing interval.
 *  - The strongest PVP_DEFENSE_CAP survive, ordered WEAKEST FIRST so the wave ramps
 *    up the way an authored stage does; ids are re-minted `d0..dN` like a wave's so
 *    nothing downstream confuses them with the attacker's roster ids.
 */
export function toDefenseUnits(units: CombatUnit[]): CombatUnit[] {
  const ranked = units
    .map((u) => ({ u, score: unitScore(u) }))
    .sort((a, b) => b.score - a.score || a.u.id.localeCompare(b.u.id))
    .slice(0, PVP_DEFENSE_CAP)
    .reverse();
  return ranked.map(({ u }, i) => {
    const copy: CombatUnit = { ...u, id: `d${i}`, team: "enemy", abilities: [] };
    delete copy.teamAuraStats;
    delete copy.walkingSpeedMult;
    return copy;
  });
}

// ---------------------------------------------------------------------------
// Rewards. Tiers are priced from the OPPOSING army's difficulty score: the attacker's
// payout reads the defense they beat, the defender's payout reads the attack they
// repelled. The thresholds are the tuning surface — everything else (score maths,
// reward bundles) is shape. Grounding: a fresh 8-zombie starter army scores a few
// thousand; a leveled, mutated, veteran 16-defense scores into the millions.
export const PVP_TIER_THRESHOLDS: ReadonlyArray<number> = [
  20_000, // below: tier 1
  120_000, // below: tier 2
  500_000, // below: tier 3
  1_500_000, // below: tier 4; at/above: tier 5
];

export function pvpTierForScore(score: number): number {
  let tier = 1;
  for (const limit of PVP_TIER_THRESHOLDS) {
    if (score >= limit) tier += 1;
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
  /** Reward tier the ATTACKER is paid on a win (from defenseScore). */
  attackerTier: number;
  /** Reward tier the DEFENDER may claim on a successful defense (from attackScore). */
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
