// Ability COMBAT EFFECTS — the bridge from the display-only ability matrix
// (traits.ts) into the deterministic raid resolver (raid/CombatEngine.ts) and,
// through the baked CombatUnit stats, the live battle sim (raid/BattleSim.ts).
//
// Always-on stat changes and type-targeted auras are resolved while CombatUnits
// are built. BattleSim implements the stateful abilities directly. Its proc
// sequence is deterministic for replay verification while preserving the exact
// integer-roll success counts recovered from the binary.
//
// A zombie's ACTIVE abilities are gated exactly like the detail card (see hud.ts
// buildZombieDetail): for each tier 1..(its colour-class rank), the tier's ability
// applies only once THAT ability has been unlocked (its tier's invasion boss beaten
// enough times to reach it). So combat power tracks what the player sees on the
// card — no hidden bonuses.

import { MAX_ABILITY_TIER, unitAbilityAt, abilityTierOf } from "./traits";
import { classTierRank } from "./taxonomy";
import type { OwnedZombie } from "./types";

// How an ability behaves in the live raid, which also decides whether it shows in
// the battle's top-left ability strip (RaidScene):
//   "self"      — a passive buff to its OWN stats (+% All / +% Life / Turbo Walk /
//                 the auto Laser attack / chance-based Stun/Block/Double). Baked
//                 into combat stats; NOT shown in the strip (no player decision).
//   "team"      — shown in the strip as an automatic/informational ability.
//                 Most affect other zombies (Heal / Heal All / Protect / Resurrect);
//                 Chivalry, Grace, Protect, and Fortitude are type-targeted auras.
//   "activated" — a player-triggered move (Bash / Smash / Explode / Mini Buddy):
//                 tap it in the strip and one eligible zombie performs it. Shown
//                 in the strip as a tappable button with a ready-count badge.
export type AbilityKind = "self" | "team" | "activated";

export const ABILITY_KIND: Record<string, AbilityKind> = {
  // self (hidden from the strip)
  buffAllStats: "self", attackSpeedBuff: "self", powerBuff: "self",
  hitPointsBuff: "self", turboSpeed: "self",
  laserBeam: "self", zomBeam: "self", stun: "self", doubleStrike: "self", block: "self",
  // team (shown, automatic)
  heal: "team", healAOE: "team", protect: "team", tankHitPointsBuff: "team", ressurect: "team",
  chivalry: "team", grace: "team",
  // activated (shown, tappable — one zombie per tap)
  attachMini: "activated", bash: "activated", bashV2: "activated",
  explode: "activated", explodeV2: "activated",
};

/** Authored live-battle parameters for an activated ability. */
export interface ActivatedAbility {
  /** Authored attack-duration multiplier. `Actor getFightAttackSpeed` multiplies
   *  the unit's final attack interval by this value. */
  speedMultiplier: number;
  /** Fraction of the authored attack animation at which damage lands. */
  damageTiming: number;
  /** Payoff = performer's final attack damage × this. */
  damageFactor: number;
  /** Hit every on-field enemy (Explode), not just the current target. */
  aoe?: boolean;
  /** Also stun the struck enemy(ies) for this long (delays their next attack). */
  stunMs?: number;
  /** Cooldown before the SAME zombie can be activated again. One-use abilities
   *  carry zero because they are disabled after their first activation. */
  cooldownMs: number;
  useOnce?: boolean;
  /** Whether an area attack is allowed to damage the boss. */
  hitBoss?: boolean;
  /** The move destroys its own performer (Explode). A suicide move is a FUSE rather
   *  than a swing, which changes three things in BattleSim: it can be lit from the
   *  combat zone with no enemy in front, its wind-up keeps burning down while the
   *  zombie has no target, and it detonates on schedule even into an empty field. */
  suicide?: boolean;
}

export const ACTIVATED_ABILITY: Record<string, ActivatedAbility> = {
  bash: {
    speedMultiplier: 2.5, damageTiming: 0.975,
    damageFactor: 2.75, aoe: true, cooldownMs: 10_000,
  },
  bashV2: {
    speedMultiplier: 1.5, damageTiming: 0.975,
    damageFactor: 1.8, aoe: true, stunMs: 1000, cooldownMs: 10_000,
  },
  explode: {
    speedMultiplier: 6, damageTiming: 1,
    damageFactor: 10, aoe: true, stunMs: 3000, cooldownMs: 0, useOnce: true, suicide: true,
  },
  explodeV2: {
    speedMultiplier: 6, damageTiming: 1,
    damageFactor: 10, aoe: true, stunMs: 3000, cooldownMs: 0, useOnce: true, suicide: true,
    hitBoss: true,
  },
  // Mini Buddy is state-driven in BattleSim: mount before deployment, 4× walk,
  // ram-stun, then deploy both units. The generic hit fields are unused.
  attachMini: {
    speedMultiplier: 1, damageTiming: 0, damageFactor: 0,
    cooldownMs: 0, useOnce: true,
  },
};

/** How one ability modifies its owner (and, for sustain/support, the whole army).
 *  Every field is a multiplier defaulting to 1 (no effect). */
export interface AbilityCombatEffect {
  /** Multiplies str/dex/con/focus together (the "+N% All Stats" buffs). */
  allStatsMult?: number;
  /** Multiplies this unit's per-hit damage. */
  selfDamageMult?: number;
  /** Multiplies this unit's effective HP. */
  selfHpMult?: number;
  /** Multiplies this unit's DEX (→ shorter attack cooldown / faster advance). */
  selfSpeedMult?: number;
}

// Per-ability magnitudes, keyed by the ability_*.png basename used in traits.ts.
//
// Only always-on SELF stat changes live in this table. Auras, chance procs,
// movement-only changes, healing, resurrection, lasers, and buttons are modeled
// explicitly in CombatEngine/BattleSim from the recovered binary behavior.
export const ABILITY_COMBAT: Record<string, AbilityCombatEffect> = {
  // ---- Tier 1 ----
  buffAllStats: { allStatsMult: 1.05 }, // CONFIRMED +5% all
  attackSpeedBuff: { selfSpeedMult: 1.1 }, // CONFIRMED +10% speed
  powerBuff: { selfDamageMult: 1.1 }, // CONFIRMED +10% power
  hitPointsBuff: { selfHpMult: 1.1 }, // CONFIRMED +10% life
  heal: {}, // live BattleSim performs actual targeted healing

  // ---- Tier 2: authentic effects are type-targeted auras / activated state ----
  chivalry: {},
  grace: {},
  attachMini: {},
  protect: {},
  tankHitPointsBuff: {},

  // ---- Tier 3 ----
  laserBeam: {},
  stun: {},
  explode: {},
  bash: {},
  turboSpeed: {},
  ressurect: {},

  // ---- Tier 4 (the ".Ver.2" upgrades hit harder) ----
  zomBeam: {},
  doubleStrike: {},
  explodeV2: {},
  bashV2: {},
  block: {},
  healAOE: {},
};

/** The gated, currently-active ability keys for one owned zombie — the SAME set
 *  the detail card shows: for each tier up to its class rank, the tier's ability
 *  applies only if that specific ability has been unlocked (its tier's invasion
 *  boss beaten enough times to reach it — see GameState.abilityUnlocked). */
export function activeAbilities(
  z: Pick<OwnedZombie, "key" | "group" | "className">,
  abilityUnlocked: (key: string) => boolean
): string[] {
  const rank = Math.min(MAX_ABILITY_TIER, classTierRank(z.className));
  const out: string[] = [];
  for (let t = 1; t <= rank; t++) {
    const key = unitAbilityAt(z.key, z.group, t);
    if (key && abilityUnlocked(key)) out.push(key);
  }
  return out;
}

/** The combined per-unit, always-on multipliers from a set of ability keys. Team
 *  effects (auras, procs, healing, activated moves) are NOT here — CombatEngine and
 *  BattleSim apply those explicitly from the recovered binary behavior. */
export function combatEffect(keys: string[]): Required<AbilityCombatEffect> {
  const acc = {
    allStatsMult: 1,
    selfDamageMult: 1,
    selfHpMult: 1,
    selfSpeedMult: 1,
  };
  for (const k of keys) {
    const e = ABILITY_COMBAT[k];
    if (!e) continue;
    acc.allStatsMult *= e.allStatsMult ?? 1;
    acc.selfDamageMult *= e.selfDamageMult ?? 1;
    acc.selfHpMult *= e.selfHpMult ?? 1;
    acc.selfSpeedMult *= e.selfSpeedMult ?? 1;
  }
  return acc;
}

/** The single ACTIVATED move a zombie performs — the highest-tier activated
 *  ability in its set (a Silver Large's Smash outranks its Bash/Mini), or null if
 *  it has none. One activated move per zombie keeps the battle strip uncluttered. */
export function activatedKeyFor(keys: string[]): string | null {
  let best: string | null = null;
  let bestTier = 0;
  for (const k of keys) {
    if (ABILITY_KIND[k] !== "activated") continue;
    const t = abilityTierOf(k);
    if (t >= bestTier) {
      bestTier = t;
      best = k;
    }
  }
  return best;
}

/** The team-passive abilities in a set (Heal/Protect/Resurrect/Chivalry/…), for
 *  the battle strip's informational icons. */
export function teamAbilitiesIn(keys: string[]): string[] {
  return keys.filter((k) => ABILITY_KIND[k] === "team");
}
