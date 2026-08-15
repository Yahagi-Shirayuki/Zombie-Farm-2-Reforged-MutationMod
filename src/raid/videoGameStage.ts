// Zombies vs Video Games (raid 9) — Zedzox's two signature specials, in ONE place so the
// client sim and the server verifier cannot drift. Same contract as alienStage.ts.
//
// Both specials here DIVERGE from the recovered behaviour on purpose. The divergences are
// spelled out at each constant; the short version:
//
//   * `turnZombie` used to delete your front zombie outright. It now CONVERTS it — the
//     zombie is carried out of the fight and a pixel zombie stands up mid-field in its
//     place, which you tap back down to get it back.
//   * `pixelFire` used to be a one-frame interrupt. It now BURNS, and you tap it out.
//
// See docs/mechanics/ENEMY_DAMAGE_RECOVERED.md for the recovered readings these replace.
import type { AttackDef, CombatUnit, EnemyStat } from "./types";
import { buildUnitsForKeys } from "./CombatEngine";
import type { EliteProfile } from "./eliteInvasion";

/** Enemies.json ID of Zombies vs Video Games. */
export const VIDEO_GAME_RAID_ID = 9;

/** The unit `turnZombie` stands up in the middle of the lane.
 *
 *  GROUND TRUTH: authored in UnitStats.json (con 10000, dex 6, str 8, `VideoGameZombieBite`)
 *  and shipping its own idle/attack frames, but listed in no raid stage — nothing spawns it
 *  as wave population, so `prep_raids.py` used to drop it on the floor. It is now carried
 *  through EXTRA_UNITS. The con is the tell: 10000 is a million hit points, roughly sixty
 *  times a wave minion's and far past what melee chews through inside a round. This is not
 *  an enemy you out-fight — it is a hazard you TAP down. */
export const PIXEL_ZOMBIE_KEY = "VideoGameStageZombieActor";

/** Taps to break a pixel zombie open and get your zombie back.
 *
 *  Sized off its own max HP so an ELITE profile's fatter body still takes exactly this
 *  many — the same rule the boss wall uses (`WALL_TAP_DAMAGE`, ground truth
 *  `ZFFightWall ccTouchEnded` → `damage: maxHp/20`). Twenty taps is a real commitment
 *  during a fight you are also losing a fighter from, which is the price of the rescue. */
export const PIXEL_ZOMBIE_TAPS = 20;

/** How long one `pixelFire` cast burns for, untapped.
 *
 *  DELIBERATE DIVERGENCE. The recovered behaviour is a burn that lasts exactly ONE FRAME:
 *  `setOnFire` parks the zombie's destination on its own current position, so the state
 *  block ticks once, fails its `position == destinationPoint` test and leaves. That is
 *  near-certainly a source bug (the surrounding code fetches the enemy; moving to your own
 *  position is a no-op) and it made Zedzox's headline special worth ~2 damage. We ship the
 *  burn the effect is obviously reaching for instead, and hand the player a way to answer
 *  it: tap the fire out.
 *
 *  At BURN_MAX_HP_FRACTION_PER_SEC (5 %/s, itself ground truth) six seconds costs 30 % of
 *  max HP — heavy enough that ignoring it kills a worn zombie, survivable enough that a
 *  fresh one lives through a fire it never notices. */
export const PIXEL_FIRE_BURN_MS = 6000;

/** A burning zombie panics: it stops fighting and paces back and forth over this reach
 *  (sim px, half-width around wherever the fire caught it) at this speed. It is going
 *  nowhere — the point is that a burning unit is OUT of the fight until the fire is out,
 *  and that it reads as burning from across the field. */
export const PIXEL_FIRE_PACE_REACH = 26;
export const PIXEL_FIRE_PACE_SPEED = 78;

/** The pixel zombie template for a stage whose boss carries `turnZombie` — only raid 9's
 *  does. Built through the same helper as wave minions and alien abductees, so the same
 *  elite/level context applies to all three and a converted zombie scales with the fight
 *  it appears in. Returns null for every other raid. */
export function turnedUnitFor(
  raidId: number,
  stats: Record<string, EnemyStat>,
  attacks: Record<string, AttackDef>,
  opts: { raidId?: number; playerLevel?: number; elite?: EliteProfile | null } = {}
): CombatUnit | null {
  if (raidId !== VIDEO_GAME_RAID_ID) return null;
  if (!stats[PIXEL_ZOMBIE_KEY]) return null;
  return buildUnitsForKeys([PIXEL_ZOMBIE_KEY], null, stats, attacks, opts)[0] ?? null;
}
