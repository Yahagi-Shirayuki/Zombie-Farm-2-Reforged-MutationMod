// The live battle simulation (Phase 3+): a pure, RNG-free, real-time stepping
// model that the RaidScene renders. No Pixi, no DOM — positions, health, focus
// charge, ballistic boss projectiles, and attack clocks over a 1D combat lane.
// This is the AUTHORITY for a raid's outcome — the game ALWAYS plays it out; there is
// no instant/auto-resolve (CombatEngine.resolveRaid is retained only for the ZF.runRaid
// dev hook + headless tests).
//
// Cadence (both sides "one at a time"):
//   Zombies mill in a GROUP on the LEFT. One at a time the front zombie steps out
//   to its lane and charges a FOCUS bar; when full it is released to advance right
//   and fight, and the next steps up. Only one charges at a time.
//   Normal enemies EMERGE one at a time and hold just outside the entrance at the
//   RIGHT edge; zombies stop at a front line to their LEFT and never pass them.
//   The BOSS perches on its structure (top-right) and TOSSES projectiles in an arc
//   at the zombies (preferring Garden zombies). Throws are ballistic and use lazy
//   circle collision — a fast/small zombie can be missed. Once the minions are
//   cleared the boss descends and fights as a ground unit.
//
// Now implemented: focus-bar distractions (butterfly/brain bubbles, with
// Concentration bypass), activated abilities (windup/cooldown/stun/knockback),
// boss specials, ballistic projectiles, boss summon reinforcements, the
// carrotWall/junkWall blockers, the Circus trapeze carried-grab (grabberOf), and the
// Beach crab carry-off (crabOf). The trapeze and crab are CLIENT-ONLY — the server
// verifier replays the un-harassed fight and the client concedes via clientWin.
// NOTE: a ground-crossing obstacle/grab hazard once lived here. It was NOT a base-game
// mechanic — it was fabricated during development — and has been removed entirely.
// Do not reintroduce it without ground truth from the binary.
//
// Combat numbers are the GROUND-TRUTH fight-data model (combatStats.ts, recovered from
// the binary): maxHp = con*100 and cadence = attackCooldownMs (2s zombie / 1s enemy ÷ dex)
// arrive on the CombatUnit; per-swing damage = finalPower(str*10) * mult, then the player
// lineup-depth band (1.0/0.85/0.7/0.55; enemies ×1.0). See combatStats.lineupDamageBand.
import type { BossActionChoice, BossSpecial, BossThrowConfig, CombatUnit, CrabConfig, GrabberConfig, RaidOutcome } from "./types";
import { ACTIVATED_ABILITY, activatedKeyFor, teamAbilitiesIn } from "../zombie/abilities";
import {
  ALIEN_LASER_DAMAGE,
  applyDamage,
  BURN_MAX_HP_FRACTION_PER_SEC,
  deriveAttackIntervalMs,
  deriveHitDamage,
  deriveMaxHp,
  SOURCE_FRAME_SEC,
  lineupDamageBand,
  lineupSpeedBand,
  mirroredAttackIntervalSec,
  POWER_PER_STR,
} from "./combatStats";

/** Logical field the sim runs in; RaidScene scales this to the viewport. */
export const FIELD_W = 1000;
export const FIELD_H = 560;

export const CHARGE_X = 220; // staging slot the front zombie steps into to focus
export const ENEMY_HOLD_X = 915; // enemies hold in the structure's doorway (not the far edge),
// ~2/3 of a sprite forward of the entrance so they stand IN the open door
export const ENEMY_SPAWN_X = 1120; // off the right edge (hidden) before emerging
// Epic Bosses enter from above instead of through the stage doorway. Land them just
// right of the field's midpoint so zombies spend more of the short attempt fighting
// and less of it crossing an otherwise empty lane.
export const EPIC_BOSS_HOLD_X = 600;
// Boss perch field-x. Chosen so RaidScene.mapX() lands it on the silo perch
// (PERCH_FX), which is also where thrown projectiles originate.
export const BOSS_STRUCT_X = 848;
/** Boss perch height in sim space (negative = up); RaidScene reads it to place
 *  the boss on the barn and lerp its descent. */
export const BOSS_STRUCT_Y = -150;
/** Epic Boss entry starts well above the visible stage, then falls to ground. */
export const EPIC_BOSS_FALL_Y = -4_000;
const EPIC_BOSS_FALL_SPEED = 4_800;
const EPIC_BOSS_LAND_MS = 500;
const BAND_TOP = 90;
const BAND_BOT = FIELD_H - 70;
const CENTER_Y = FIELD_H / 2;
const ENGAGE = 60; // x-distance at which two units trade blows

const CHARGE_MS = 3600; // focus-bar fill (zombies take a while to get out)
// Focus-bubble minigame thresholds: the fill pauses at 1/4, 2/4, 3/4 (a butterfly
// distraction) and again at full (a brain, gating the release). Popping a bubble
// resumes instantly; if the player never taps, it auto-resolves after these
// generous timeouts so the battle can't soft-lock.
const CHARGE_STEPS = [0.25, 0.5, 0.75, 1];
const BUTTERFLY_AUTO_MS = 4200; // distraction auto-refocuses if not popped
const BRAIN_AUTO_MS = 3200; // full bar auto-advances if not popped
const STEP_SPEED = 260; // zombie stepping out to its lane (px/s)
const EMERGE_SPEED = 210; // enemy walking in from the right (px/s)
const CIRCUS_BOSS_KEY = "CircusStageActorBoss";
const BOSS_JUMP_MS = 650; // Circus Ringmaster drops directly from the car to the lane
const ENEMY_EMERGE_GAP_MS = 450; // beat before the next enemy emerges
const MAX_ACTIVE_ENEMIES = 1; // enemies fight one at a time (raise for a line)
const MAX_SIM_MS = 4 * 60 * 1000; // hard safety cap (min-damage 1 avoids stalls)

// Front formation: released zombies form up in up to MAX_ROWS rows, filling into
// depth columns behind. Only the front column (at the line) reaches the enemy, so
// at most MAX_ROWS zombies fight at once. Headless zombies take front slots.
const MAX_ROWS = 4;
const ROW_GAP = 46; // vertical spacing between rows
const COL_GAP = 52; // depth spacing between columns

// Anti-one-shot safeguard (INFERRED from `-[Actor damage:]` 0x3a064). A single ENEMY hit
// blow can't take a player zombie from above the floor straight to death or below 10% of max
// HP — its HP snaps to exactly 1 instead, so it survives to act once more. Protection is
// latched as consumed so healing above 1 HP cannot re-arm it; the next lethal hit kills it.
// This models the in-binary state bit 0x10 that eventually permits the killing blow, which
// we can't fully pin. `turnZombie` deliberately bypasses it because that action converts the
// target rather than dealing an ordinary hit.
const ONE_SHOT_FLOOR = 0.1; // hit is capped if it would leave HP fraction below this

// Mini Buddy: the binary sets the carrier to 4× walking speed. On arrival it
// stuns the enemy for 2 seconds and the carrier for 1 second.
const MINI_MOUNT_MS = 500;
const MINI_CARRIER_SPEED_MULT = 4;
const MINI_ENEMY_STUN_MS = 2000;
const MINI_CARRIER_STUN_MS = 1000;

// Garden support recovered from ZombieActorGarden: both heals restore half of
// finalPower. Heal selects another zombie at or below 50% Life; Heal All has its
// own automatic 20-second timer.
const HEAL_POWER_MULT = 0.5;
const HEAL_AOE_MS = 20_000;

// Ballistic throws.
const GRAVITY = 820; // sim px/s^2 pulling projectiles down
const GROUND_Y = BAND_BOT + 24; // a throw that reaches here has missed (fizzles)
const ZOMBIE_HIT_R = 30; // zombie collision radius in sim units
const PROJ_HIT_FACTOR = 0.4; // projectile radius = spriteSize * this
// Predictive lead: throws aim where the target WILL be after the flight time, but the
// lead speed is CAPPED here — a target moving faster than this is led only as much as a
// "lowish speed" zombie would be, so the throw lands behind it and a fast zombie outruns
// the shot. Normal/slow zombies (≤ cap) are led accurately and get hit. Chosen against
// advanceSpeed(dex) (90–260): ~dex 1–4 (≤178) are led enough to connect; dex 5+ (≥200)
// under-lead into a miss on the longer lobs to the back of the lane.
const PREDICT_SPEED_CAP = 150; // sim px/s — never lead a target faster than this
// Above this per-step displacement, a unit was teleported (knockback re-slot, boss
// perch↔ground) rather than walking — its measured velocity is discarded (max real
// step is moveSpeed≤260 × dt≤0.05s ≈ 13 px).
export const TELEPORT_PX = 40;
// Boss-action throw damage is an independently authored chip value applied VERBATIM:
// `ZFFightPhysics throwProjectile:` reads the bossAction's @"damage" straight into the
// projectile's `damageAmount`, and the contact handler passes that to `[zombie damage:]`.
// No conversion, no scaling — McDonnell's 6/12/18 really are 6/12/18 against con×100 HP.

// ---- Round timer + enrage (ZFFightMan updateTimer:/showEnrageTimer) ----
// The fight is a countdown; when it expires the boss ENRAGES. The reference build
// shows a 3:00 round. On enrage the boss throws twice as fast, recovers its special
// actions faster, and hits ~1.5× harder (chip → threat if you stall).
const DEFAULT_ROUND_MS = 3 * 60 * 1000; // 3:00
const ENRAGE_THROW_MULT = 0.5; // throw interval halves
const ENRAGE_SPECIAL_MULT = 0.6; // special cooldowns shorten
const ENRAGE_DMG_MULT = 1.5; // boss melee damage grows

// ---- Boss special actions (non-throw bossActions) ----
// alienLaser fires a fast straight bolt (flat 200, ALIEN_LASER_DAMAGE); pixelFire sets
// ONE zombie on fire; turnZombie removes your front zombie (it's turned against you);
// telekinesis lifts + slams a zombie for knockback and stun but NO damage. summonBoss
// spawns a capped reinforcement and wall spawns a single standing blocker — both go
// through spawnEnemy and join the normal queue. Damage values are all ground truth
// (see combatStats); only the telekinesis hold below is un-recovered.
const LASER_SPEED = 900; // straight-bolt speed (sim px/s)
// Telekinesis hold. `stunSelfFor:` takes its duration from the action, which this
// data doesn't carry, so the sim uses the same 1 s as an ordinary stun attack.
const TELEKINESIS_STUN_MS = 1000;

// ---- Knockback (Actor knockBackBy:force:) ----
// A knockback attack interrupts the struck zombie and, in the source, calls
// `setZombieToLastIndex` — it's sent to the BACK of the line. Here it's shoved back
// down the lane and re-slotted last, so it must charge to the front again.
const KNOCKBACK_PX = 150; // how far back the zombie is shoved (sim units)

// ---- Carried-grab hazard (Circus Trapeze Artist `grabZombie`) ----
// GROUND TRUTH (Enemies.json Trapeze Artist + StageActor doActionsForString:): the actor
// sweeps in from the LEFT across the combat band, grabs the rear-most deployed zombie
// (collidedAction grabZombie → the zombie goes inactive), pauses ~1s, then RISES to carry
// it off (changeSpeed_0.5 : setRotationTo_90). The player taps it (touchedAction
// damageSelf_100, tapDelay 0.25) to whittle its HP; killed → dyingAction dropZombie frees
// the zombie back into the fight; if it reaches its exit still carrying, that zombie DIES.
// movingAnimation `rotateTo_180_17`: Actor.parseAnimationString interprets this
// as a 180-degree target over 17 animation ticks (the stage cadence is 0.1 s).
// Collision then explicitly snaps the grabbed actor to 90 degrees for the carry.
const GRABBER_FULL_ARC_MS = 1700;
// The texture runs from its suspension point at x=0 to the artist at the far end.
// In logical field space that span is about half the lane, so the target's x determines
// the angle at which the artist reaches it. Successive appearances approach that angle
// from alternating sides instead of traversing both directions in one appearance.
const GRABBER_SWING_RADIUS_X = FIELD_W * 0.5;
const GRABBER_CONTACT_DEG = 90;
const GRABBER_RISE_SPEED = 92; // carry-off rise speed (sim px/s), the slow 0.5 speed
const GRABBER_CARRY_PAUSE_MS = 1000; // changeStateWithDelay_run_1: hold 1s before rising
const GRABBER_TAP_CD_MS = 250; // tapDelay 0.25 — min gap between registered taps
// The renderer places this pivot at horizontal center and one-quarter viewport above
// the top edge. The logical x is retained for target-angle and snapshot calculations.
const GRABBER_PIVOT_X = FIELD_W * 0.5;
const GRABBER_PIVOT_Y = BOSS_STRUCT_Y - 140;
// Keep the zombie a little below the ground-line offset at pickup. This makes its upper
// body meet the artist while leaving the zombie itself lower during the upward carry.
const GRABBER_ZOMBIE_OFFSET_Y = CENTER_Y - GRABBER_PIVOT_Y + 30;
// mapProjY maps BOSS_STRUCT_Y to the visible perch, not the top edge. A full logical
// field-height above zero clears even the tallest stage perch, so the zombie stays alive
// until its whole sprite is off-screen rather than dying after the first small lift.
const GRABBER_ESCAPE_ZOMBIE_Y = -FIELD_H;
const GRABBER_SPAWN_MS = 7000; // respawn cadence after one leaves (initial from config)
// ---- Beach crab hazard (BeachStageActorCrab) ----
// Disassembled: wanders, grabs a zombie on contact, holds 2 s, then carries it off the
// LEFT edge (source destination x = −100) where the zombie leaves the fight. Tapped to
// death → the zombie is released and resumes. See types.ts CrabConfig.
const CRAB_WALK_SPEED = 70; // lane speed (sim px/s). NOT ground truth — the source sets
// this via a scaled setWalkingSpeed: the disassembly did not resolve; tuned to read as a
// scuttle that a player has time to react to.
const CRAB_CARRY_SPEED = 95; // speed while hauling a zombie toward the left edge
const CRAB_EXIT_X = -60; // past this (off the left edge) the carried zombie is out
const CRAB_HIT_R = 30; // contact radius for the grab (sim units)
const CRAB_TAP_CD_MS = 250; // min gap between registered taps (matches the trapeze tapDelay)
const CRAB_WANDER_MS = 1400; // how long it holds one wander heading before re-picking
// Wander band: the source picks random destinations around the mid-lane. The exact
// formula did not disassemble cleanly, so this is a bounded patrol of the contested
// middle instead of a guess at the original RNG.
const CRAB_WANDER_MIN_X = 300;
const CRAB_WANDER_MAX_X = 760;

// ---- Boss summon / wall specials ----
const SUMMON_CAP = 3; // most extra minions a boss can summon in one fight
// Per-tap chip on a boss wall (ground truth ZFFightWall ccTouchEnded → damage: = const/20,
// const ≈ the wall's HP 1500 → 75). Zombies do the bulk; tapping is an assist.
const WALL_TAP_DAMAGE = 75;
// Walls materialize where Garden support normally holds. Zombies that had already
// crossed that point when the cast began keep fighting ahead; everyone behind it must
// stop here and break it before continuing.
const WALL_MELEE_GAP = ENGAGE;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deterministic 0..1 hash (no RNG — keeps the sim replayable). */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function stringSeed(value: string): number {
  let out = 0;
  for (let i = 0; i < value.length; i++) out = (Math.imul(out, 31) + value.charCodeAt(i)) >>> 0;
  return out % 100;
}

function laserInterval(abilities: readonly string[], attackCooldownMs: number): number {
  if (abilities.includes("zomBeam")) return attackCooldownMs / 6;
  if (abilities.includes("laserBeam")) return attackCooldownMs / 3;
  return 0;
}

/** Zombie advance speed scales with DEX (quicker zombies reach the front sooner). */
function advanceSpeed(dex: number): number {
  return clamp(90 + dex * 22, 90, 260);
}

/** A loose 2D spot in the left-side waiting group. */
function clusterHome(i: number): { x: number; y: number } {
  const cols = 3;
  const bx = 45 + (i % cols) * 32;
  const by = BAND_TOP + 40 + Math.floor(i / cols) * 42;
  const jx = (hash(i * 2 + 1) - 0.5) * 26;
  const jy = (hash(i * 2 + 7) - 0.5) * 26;
  // Preserve the original loose formation and move the entire crowd left uniformly.
  return { x: clamp(bx + jx, 26, 158) - 27, y: clamp(by + jy, BAND_TOP, BAND_BOT) };
}

export type UnitState =
  | "waiting" // zombie milling in the back group
  | "charging" // zombie stepping out + focusing
  | "advance" // released, moving to the front line
  | "fight" // trading blows
  | "carried" // Small zombie riding a Large zombie via Mini Buddy
  | "grabbed" // seized by the Trapeze Artist — inactive, being carried off (rescue by tapping)
  | "queued" // enemy off-screen, not yet emerged
  | "descending" // boss coming down off the structure + exiting out the back
  | "emerging" // enemy walking to its holding spot (or boss re-entering)
  | "falling" // Epic Boss dropping vertically from above the stage
  | "landing" // Epic Boss playing its authored landing/enter beat
  | "structure" // boss perched on its structure, throwing
  | "hold" // enemy standing, no target in range
  | "dead";

/** A combatant with spatial + charge state, consumed by the renderer each frame. */
export interface SimUnit {
  id: string;
  sourceKey: string;
  mutation: number;
  team: "player" | "enemy";
  name: string;
  group?: string;
  className?: string;
  /** Presentation-only body tint (see CombatUnit.color). Never read by the sim. */
  color?: [number, number, number];
  isBoss: boolean;
  isGarden: boolean;
  isHeadless: boolean;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damageReduction: number;
  teamAuraStats: CombatUnit["teamAuraStats"] | null;
  attackMultiplier: number;
  walkingSpeedMult: number;
  alive: boolean;
  oneShotProtectionUsed: boolean; // remains consumed through healing and replay checkpoints
  state: UnitState;
  charge: number; // 0..1 focus fill (zombies only)
  focus: number; // 0..100 focus stat: distraction resistance (ground truth Help.json)
  // ---- focus-bubble minigame (zombies, while charging) ----
  distracted: boolean; // butterfly bubble showing — fill paused until popped
  awaitRelease: boolean; // brain bubble showing — full, gated until popped
  distractStep: number; // how many CHARGE_STEPS have fired (0..4)
  distractSeed: number; // per-unit seed for the deterministic distraction roll
  bubbleMs: number; // ms until the current bubble auto-resolves
  struckThisTick: boolean;
  vx: number; // measured velocity over the last step (sim px/s) — drives throw lead
  vy: number;
  prevX: number; // position at the start of the current step (velocity bookkeeping)
  prevY: number;
  damage: number;
  /** Primary authored attack name, used only to select its presentation SFX. */
  attackName: string;
  cooldownMs: number;
  timerMs: number;
  moveSpeed: number;
  power: number; // finalPower, retained for lasers and Garden heals
  homeX: number; // waiting-group spot (zombies)
  homeY: number;
  mill: number; // per-unit wander phase
  formOrder: number; // release order (formation priority tiebreak)
  /** Headless units push to the front. Sending one to the back temporarily clears
   * this flag so the row behind can fill the vacancy while it recovers. */
  frontPriority: boolean;
  lineupIndex: number; // front-to-back rank among committed zombies (0 = front) → damage band
  slotX: number; // assigned formation position
  slotY: number;
  // ---- abilities ----
  abilities: string[]; // this unit's unlocked ability keys (players only)
  activatedKey: string | null; // the ONE activated move it performs (or null)
  windupKey: string | null; // the activated move currently charging (null = none)
  windupMs: number; // ms left in the current wind-up
  windupTotal: number; // full wind-up duration (for the charge bar)
  abilityCdMs: number; // cooldown before this unit can be activated again
  buddyId: string | null; // Small zombie currently carried by this Large zombie
  buddyCarrierId: string | null; // Large zombie carrying this Small zombie
  buddyMountMs: number; // jump-to-carrier animation time remaining
  healTimerMs: number; // Garden support heal cadence
  healAoeTimerMs: number; // independent 20-second Heal All timer
  healFxSeq: number; // increments when this unit receives a heal (renderer trigger)
  healCastSeq: number; // increments when this Garden zombie performs a heal
  laserTimerMs: number; // automatic walking-laser cadence
  laserFxSeq: number; // increments when a walking laser fires (renderer trigger)
  laserTargetId: string | null; // target of the most recent walking laser
  abilityRollSeq: number; // replay-safe proc sequence (Block/Stun/Double Strike)
  usedAbilities: string[]; // one-use activated abilities already consumed
  resurrectUsed: boolean; // one-use automatic Resurrect latch
  stunMs: number; // ms of stun left — can't act while > 0 (enemies AND zombies)
  // ---- enemy attack effects inflicted on a struck zombie ----
  knockBack: boolean; // this enemy's attack shoves the zombie back down the lane
  stunInflictMs: number; // stun this enemy applies to a zombie on hit (ms)
  attackDamageTiming: number; // 0..1 fraction of the swing when it connects (enemy anim)
  isWall: boolean; // boss-summoned blocker (carrotWall / junkWall) — tappable, no attacks
  passedWall: boolean; // latched when already beyond a newly summoned wall
  /** Carried off the field by a Beach crab: still ALIVE (it comes home after the raid —
   *  source state 38 is not the death path) but out of this fight, so it counts as a
   *  survivor while no longer keeping the battle alive. */
  taken: boolean;
  /** Enemy that ignores its dex clock and mirrors its opponent's (Pirate Scallywag). */
  mirrorsOpponentSpeed: boolean;
}

/** A Trapeze Artist grab hazard, consumed by the renderer. Sweeps in, seizes a zombie,
 *  then carries it off unless the player taps it to death. */
/** A Beach crab hazard, consumed by the renderer. Wanders, grabs a zombie, holds, then
 *  hauls it off the left edge unless the player taps it to death. */
export interface SimCrab {
  id: string;
  x: number;
  y: number;
  state: "wander" | "hold" | "carry" | "gone";
  dir: -1 | 1; // current wander heading (−1 = toward the zombies / left)
  wanderMs: number; // time left on the current heading
  hp: number;
  maxHp: number;
  tapDamage: number;
  grabbedId: string | null;
  holdMs: number; // pre-carry pause left (source: 2.0 s)
  tapCdMs: number;
  sprite: string;
  struckThisTick: boolean;
}

export interface SimGrabber {
  id: string;
  x: number;
  y: number;
  state: "swoop" | "carry" | "gone";
  hp: number;
  maxHp: number;
  tapDamage: number;
  grabbedId: string | null; // the zombie being carried (null while still swooping)
  pauseMs: number; // hold time left before it starts rising (post-grab)
  tapCdMs: number; // min gap enforcement between registered taps
  sprite: string;
  rot: number; // visual rotation (renderer)
  swingStartDeg: number; // 0 = enters from right, 180 = enters from left
  contactDeg: number; // target-aware angle where the artist reaches the zombie
  swingTotalMs: number;
  targetId: string | null; // intended contact target while swooping
  struckThisTick: boolean; // a tap landed this step (renderer feedback)
}

/** A boss projectile in flight, consumed by the renderer. Ballistic throws use the
 *  default gravity; straight-line bolts (the alien laser) set `gravity: 0`. */
export interface SimProjectile {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotSpeed: number;
  damage: number;
  sprite: string;
  spriteSize: number;
  done: boolean;
  gravity: number;
}

/** Compact, JSON-safe verifier state used by the server's 15-second replay checkpoints. */
export interface BattleSimSnapshot {
  units: SimUnit[];
  projectiles: SimProjectile[];
  bossId: string | null;
  /** Ms until the pre-rolled `nextAction` resolves (throws and specials share it). */
  actionCd: number;
  nextAction: BossActionChoice | null;
  actionCount: number;
  throwCount: number;
  releaseSeq: number;
  projSeq: number;
  elapsed: number;
  emergeCooldown: number;
  attacksLanded: number;
  playerDamage: number;
  roundLeft: number;
  enraged: boolean;
  specialCast: number;
  pendingSpecial: BossSpecial | null;
  summonsLeft: number;
  spawnSeq: number;
  activatedKeys: string[];
  grabbers: SimGrabber[];
  grabberTimer: number;
  grabSeq: number;
  // Client-only Beach crab hazard: absent from server-built snapshots (see crabOf).
  crabs?: SimCrab[];
  crabTimer?: number;
  crabSeq?: number;
}

/** Deterministic stand-in for the source game's weighted random roll. Replay must be
 * identical on client and server, so hash the independent action counter into a stable
 * unit interval and then apply the recovered cumulative-frequency selection rule. */
function weightedPick<T extends { weight: number }>(items: readonly T[], count: number, salt: number): T | null {
  if (!items.length) return null;
  const weighted = items
    .filter((item) => Number.isFinite(item.weight) && item.weight > 0)
    .sort((a, b) => a.weight - b.weight);
  if (!weighted.length) return items[count % items.length] ?? items[0];
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let x = (count + 1 + salt) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  const roll = (((x ^ (x >>> 15)) >>> 0) / 0x1_0000_0000) * total;
  let cumulative = 0;
  for (const item of weighted) {
    cumulative += item.weight;
    if (roll < cumulative) return item;
  }
  return weighted[weighted.length - 1];
}

function toSim(u: CombatUnit, i: number): SimUnit {
  const mult = u.attacks[0]?.mult ?? 1;
  const isPlayer = u.team === "player";
  const home = isPlayer ? clusterHome(i) : { x: ENEMY_SPAWN_X, y: CENTER_Y };
  const abilities = isPlayer ? u.abilities ?? [] : [];
  return {
    id: u.id,
    sourceKey: u.sourceKey,
    mutation: u.mutation ?? 0,
    team: u.team,
    name: u.name,
    group: u.group,
    className: u.className,
    color: u.color,
    isBoss: u.isBoss,
    isGarden: u.isGarden,
    isHeadless: u.isHeadless,
    x: home.x,
    y: home.y,
    // Epic Boss attempts can begin with damage retained from an earlier escape.
    // Preserve the supplied combat HP instead of silently healing every unit to
    // max while translating it into simulation state.
    hp: Math.max(0, Math.min(u.maxHp, u.hp)),
    maxHp: u.maxHp,
    damageReduction: u.damageReduction ?? 0,
    teamAuraStats: u.teamAuraStats ? { ...u.teamAuraStats } : null,
    attackMultiplier: mult,
    walkingSpeedMult: u.walkingSpeedMult ?? 1,
    alive: true,
    oneShotProtectionUsed: false,
    state: isPlayer ? "waiting" : "queued",
    charge: 0,
    focus: u.focus ?? 0,
    distracted: false,
    awaitRelease: false,
    distractStep: 0,
    distractSeed: i,
    bubbleMs: 0,
    struckThisTick: false,
    vx: 0,
    vy: 0,
    prevX: home.x,
    prevY: home.y,
    // Ground-truth per-swing damage BEFORE the lineup band: finalPower(str×10) × attackMult.
    // Enemies use this as-is (band always 1.0); a player zombie's normal swing multiplies it by
    // lineupDamageBand(lineupIndex) at hit time (activated specials use the unbanded value).
    damage: Math.max(1, Math.round(deriveHitDamage(u.str * POWER_PER_STR, mult))),
    attackName: u.attacks[0]?.name ?? "",
    cooldownMs: u.attackCooldownMs,
    timerMs: u.attackCooldownMs,
    moveSpeed: isPlayer ? advanceSpeed(u.dex) * (u.walkingSpeedMult ?? 1) : EMERGE_SPEED,
    power: u.str * POWER_PER_STR,
    homeX: home.x,
    homeY: home.y,
    mill: hash(i * 3 + 2) * Math.PI * 2,
    formOrder: 0,
    frontPriority: isPlayer && !!u.isHeadless,
    lineupIndex: 0,
    slotX: home.x,
    slotY: home.y,
    abilities,
    activatedKey: isPlayer ? activatedKeyFor(abilities) : null,
    windupKey: null,
    windupMs: 0,
    windupTotal: 0,
    abilityCdMs: 0,
    buddyId: null,
    buddyCarrierId: null,
    buddyMountMs: 0,
    healTimerMs: 0,
    healAoeTimerMs: abilities.includes("healAOE") ? 20_000 : 0,
    healFxSeq: 0,
    healCastSeq: 0,
    laserTimerMs: laserInterval(abilities, u.attackCooldownMs),
    laserFxSeq: 0,
    laserTargetId: null,
    abilityRollSeq: 0,
    usedAbilities: [],
    resurrectUsed: false,
    stunMs: 0,
    knockBack: !isPlayer && !!u.knockBack,
    stunInflictMs: isPlayer ? 0 : u.stunMs ?? 0,
    attackDamageTiming: u.attackDamageTiming ?? 0.5,
    isWall: false,
    passedWall: false,
    taken: false,
    mirrorsOpponentSpeed: !isPlayer && !!u.mirrorsOpponentSpeed,
  };
}

export class BattleSim {
  readonly units: SimUnit[];
  readonly projectiles: SimProjectile[] = [];
  /** Presentation-only count; reset at the start of every fixed simulation step. */
  projectileImpactsThisTick = 0;
  private players: SimUnit[];
  private enemies: SimUnit[];
  private boss: SimUnit | null;
  private bossThrow: BossThrowConfig | null;
  private throwCount = 0;
  private releaseSeq = 0;
  private projSeq = 0;
  private elapsed = 0;
  private emergeCooldown = 0;
  private attacksLanded = 0;
  private playerDamage = 0;
  finished = false;
  // ---- round timer + enrage ----
  private roundLeft: number;
  private _enraged = false;
  escaped = false;
  // ---- boss actions (throws AND specials share ONE budget — see stepBossActions) ----
  private specials: BossSpecial[];
  private actions: BossActionChoice[] = []; // the merged weighted roll table
  private nextAction: BossActionChoice | null = null; // pre-rolled, so the renderer can telegraph
  private actionCd = 0; // ms until `nextAction` resolves
  private actionCount = 0; // deterministic roll counter
  private specialCast = 0; // wind-up left on the pending special
  private pendingSpecial: BossSpecial | null = null;
  // ---- carried-grab hazard (Trapeze Artist) ----
  readonly grabbers: SimGrabber[] = [];
  private grabberCfg: GrabberConfig | null;
  private grabberTimer: number; // ms until the next trapeze sweeps in
  private grabSeq = 0;
  // ---- Beach crab hazard (client-only; see the ctor param) ----
  readonly crabs: SimCrab[] = [];
  private crabCfg: CrabConfig | null;
  private crabTimer: number; // ms until the next crab scuttles in
  private crabSeq = 0;
  // ---- summon / wall specials ----
  private summonTemplate: CombatUnit | null;
  private wallTemplate: CombatUnit | null;
  private summonsLeft: number;
  private spawnSeq = 0;
  private engageDistance: number;
  private frontX: number;
  private supportX: number;
  /** Distinct ACTIVATED moves present in the army (fixed) — the tappable strip. */
  readonly activatedKeys: string[];
  /** Distinct TEAM-passive abilities present (fixed) — the strip's info icons. */
  readonly teamKeys: string[];

  constructor(
    playerUnits: CombatUnit[],
    enemyUnits: CombatUnit[],
    bossThrow: BossThrowConfig | null = null,
    /** Concentration boost spent: skip the focus-bubble minigame (no distractions,
     *  auto-release at full), matching the boost's "fight at full focus" effect. */
    private concentration = false,
    /** Boss special (non-throw) actions to schedule. */
    bossSpecials: BossSpecial[] = [],
    /** Round length before the boss enrages (ms). */
    roundMs: number = DEFAULT_ROUND_MS,
    /** Unit the boss's `summonBoss` action spawns (null = don't summon). */
    summonTemplate: CombatUnit | null = null,
    /** Blocker the boss's `wall` action spawns (null = don't). */
    wallTemplate: CombatUnit | null = null,
    /** Epic Boss: no butterflies, but the full brain bubble still gates release. */
    private noDistractions = false,
    /** Epic Boss: reaching zero ends the attempt instead of triggering enrage. */
    private escapeOnRoundEnd = false,
    /** Epic Boss presentation: fall from above and land on the combat line instead
     *  of walking in from the right or occupying the normal raid perch. */
    private bossFallsFromSky = false,
    /** Larger bosses need a wider melee line so their art does not swallow zombies. */
    engageDistance = ENGAGE,
    /** Carried-grab hazard (Circus Trapeze Artist) for this raid (null = none). */
    grabber: GrabberConfig | null = null,
    /** Beach crab hazard (null = none). CLIENT-ONLY by design: the server verifier
     *  omits it, so the authoritative replay is the un-harassed run and a crab can only
     *  ever make the player's own result WORSE. See RaidManager.crabOf. */
    crab: CrabConfig | null = null
  ) {
    this.engageDistance = Math.max(ENGAGE, Math.min(300, engageDistance));
    this.grabberCfg = grabber;
    this.grabberTimer = grabber?.spawnDelayMs ?? Infinity;
    this.crabCfg = crab;
    this.crabTimer = crab?.spawnMs ?? Infinity;
    const enemyHoldX = this.bossFallsFromSky ? EPIC_BOSS_HOLD_X : ENEMY_HOLD_X;
    this.frontX = enemyHoldX - this.engageDistance;
    this.supportX = CHARGE_X + (this.frontX - CHARGE_X) * 0.5;
    // Boss always resolves last, after the normal enemies.
    const ordered = [...enemyUnits].sort((a, b) => Number(a.isBoss) - Number(b.isBoss));
    this.players = playerUnits.map((u, i) => toSim(u, i));
    this.enemies = ordered.map((u, i) => toSim(u, i));
    this.units = [...this.players, ...this.enemies];

    this.boss = this.enemies.find((e) => e.isBoss) ?? null;
    if (this.boss) {
      if (this.bossFallsFromSky) {
        this.boss.state = "falling";
        this.boss.x = EPIC_BOSS_HOLD_X;
        this.boss.y = EPIC_BOSS_FALL_Y;
      } else {
        this.boss.state = "structure";
        this.boss.x = BOSS_STRUCT_X;
        this.boss.y = BOSS_STRUCT_Y;
      }
    }
    this.bossThrow = bossThrow;
    this.specials = this.boss ? bossSpecials : [];
    this.actions = this.buildActionBudget();
    this.rollNextAction();
    // `bossActionCooldownTimer` is only ever written by bossUpdate:, so it starts at
    // ObjC's zero — the boss's first action resolves as soon as it becomes active.
    this.actionCd = 0;
    this.roundLeft = roundMs;
    this.summonTemplate = this.boss ? summonTemplate : null;
    this.wallTemplate = this.boss ? wallTemplate : null;
    this.summonsLeft = SUMMON_CAP;
    // Keep every activated move represented. In particular, Mini Buddy remains
    // available on a veteran Large zombie even when it also owns Bash/Smash.
    this.activatedKeys = [
      ...new Set(this.players.flatMap((p) => p.abilities.filter((k) => !!ACTIVATED_ABILITY[k]))),
    ];
    this.teamKeys = [...new Set(this.players.flatMap((p) => teamAbilitiesIn(p.abilities)))];
    this.refreshTeamAuras();
  }

  snapshot(): BattleSimSnapshot {
    return {
      units: this.units.map((u) => ({
        ...u,
        abilities: [...u.abilities],
        teamAuraStats: u.teamAuraStats ? { ...u.teamAuraStats } : null,
      })),
      projectiles: this.projectiles.map((p) => ({ ...p })),
      bossId: this.boss?.id ?? null,
      actionCd: this.actionCd,
      nextAction: this.nextAction ? { ...this.nextAction } : null,
      actionCount: this.actionCount,
      throwCount: this.throwCount,
      releaseSeq: this.releaseSeq,
      projSeq: this.projSeq,
      elapsed: this.elapsed,
      emergeCooldown: this.emergeCooldown,
      attacksLanded: this.attacksLanded,
      playerDamage: this.playerDamage,
      roundLeft: this.roundLeft,
      enraged: this._enraged,
      specialCast: this.specialCast,
      pendingSpecial: this.pendingSpecial ? { ...this.pendingSpecial } : null,
      summonsLeft: this.summonsLeft,
      spawnSeq: this.spawnSeq,
      activatedKeys: [...this.activatedKeys],
      grabbers: this.grabbers.map((g) => ({ ...g })),
      grabberTimer: this.grabberTimer,
      grabSeq: this.grabSeq,
      crabs: this.crabs.map((c) => ({ ...c })),
      crabTimer: this.crabTimer,
      crabSeq: this.crabSeq,
    };
  }

  restore(snapshot: BattleSimSnapshot): void {
    this.units.splice(0, this.units.length, ...snapshot.units.map((u) => ({
      ...u,
      abilities: [...u.abilities],
      teamAuraStats: u.teamAuraStats ? { ...u.teamAuraStats } : null,
      attackMultiplier: u.attackMultiplier ?? Math.max(0.1, u.power ? u.damage / u.power : 1),
      walkingSpeedMult: u.walkingSpeedMult ?? 1,
      healCastSeq: u.healCastSeq ?? 0,
      healAoeTimerMs: u.healAoeTimerMs ??
        (u.abilities.includes("healAOE") ? HEAL_AOE_MS : 0),
      laserTimerMs: u.laserTimerMs ?? laserInterval(u.abilities, u.cooldownMs),
      laserFxSeq: u.laserFxSeq ?? 0,
      laserTargetId: u.laserTargetId ?? null,
      abilityRollSeq: u.abilityRollSeq ?? 0,
      usedAbilities: [...(u.usedAbilities ?? [])],
      resurrectUsed: u.resurrectUsed ?? false,
      power: u.power ?? u.damage,
      // An old checkpoint parked at the 1-HP floor has necessarily consumed
      // its protection. New checkpoints persist the explicit latch.
      oneShotProtectionUsed: u.oneShotProtectionUsed ?? (u.team === "player" && u.hp <= 1),
      frontPriority: u.frontPriority ?? false,
      passedWall: u.passedWall ?? false,
      mirrorsOpponentSpeed: u.mirrorsOpponentSpeed ?? false,
    })));
    this.players = this.units.filter((u) => u.team === "player");
    this.enemies = this.units.filter((u) => u.team === "enemy");
    this.boss = snapshot.bossId ? this.units.find((u) => u.id === snapshot.bossId) ?? null : null;
    this.projectiles.splice(0, this.projectiles.length, ...snapshot.projectiles.map((p) => ({ ...p })));
    this.actionCd = snapshot.actionCd ?? 0;
    this.nextAction = snapshot.nextAction ? { ...snapshot.nextAction } : null;
    this.actionCount = snapshot.actionCount ?? 0;
    this.throwCount = snapshot.throwCount;
    this.releaseSeq = snapshot.releaseSeq;
    this.projSeq = snapshot.projSeq;
    this.elapsed = snapshot.elapsed;
    this.emergeCooldown = snapshot.emergeCooldown;
    this.attacksLanded = snapshot.attacksLanded;
    this.playerDamage = snapshot.playerDamage;
    this.roundLeft = snapshot.roundLeft;
    this._enraged = snapshot.enraged;
    this.specialCast = snapshot.specialCast;
    this.pendingSpecial = snapshot.pendingSpecial ? { ...snapshot.pendingSpecial } : null;
    this.summonsLeft = snapshot.summonsLeft;
    this.spawnSeq = snapshot.spawnSeq;
    this.activatedKeys.splice(0, this.activatedKeys.length, ...snapshot.activatedKeys);
    this.grabbers.splice(
      0,
      this.grabbers.length,
      ...(snapshot.grabbers ?? []).map((g) => ({
        ...g,
        swingStartDeg: g.swingStartDeg ?? g.rot,
        contactDeg: g.contactDeg ?? GRABBER_CONTACT_DEG,
        swingTotalMs: g.swingTotalMs ?? Math.max(1, g.pauseMs),
        targetId: g.targetId ?? null,
      }))
    );
    this.grabberTimer = snapshot.grabberTimer ?? this.grabberTimer;
    this.grabSeq = snapshot.grabSeq ?? this.grabSeq;
    // Crab fields are absent from server-built snapshots (the verifier omits the hazard),
    // in which case the local crab state simply carries on unchanged.
    this.crabs.splice(0, this.crabs.length, ...(snapshot.crabs ?? []).map((c) => ({ ...c })));
    this.crabTimer = snapshot.crabTimer ?? this.crabTimer;
    this.crabSeq = snapshot.crabSeq ?? this.crabSeq;
  }

  // ---- activated abilities (player-triggered from the battle strip) ----

  private isLarge(p: SimUnit): boolean {
    return p.group === "Large" || /^ZombieActorLarge/i.test(p.sourceKey);
  }

  private isSmall(p: SimUnit): boolean {
    return p.group === "Small" || /^ZombieActorSmall/i.test(p.sourceKey);
  }

  private isHealer(p: SimUnit): boolean {
    return p.isGarden && (p.abilities.includes("heal") || p.abilities.includes("healAOE"));
  }

  private availableMini(): SimUnit | null {
    return this.players.find(
      (p) => p.alive && this.isSmall(p) && !p.buddyCarrierId &&
        (p.state === "waiting" || p.state === "charging")
    ) ?? null;
  }

  /** A player unit is READY for an activated move when it's alive, in the thick of
   *  the fight, off cooldown, and not already charging one. */
  private readyToActivate(p: SimUnit, key: string): boolean {
    if (p.usedAbilities.includes(key)) return false;
    if (key === "attachMini") {
      return (
        p.alive && this.isLarge(p) && p.abilities.includes(key) && !p.buddyId &&
        (p.state === "waiting" || p.state === "charging") && !!this.availableMini()
      );
    }
    return (
      p.alive &&
      p.team === "player" &&
      p.abilities.includes(key) &&
      p.state === "fight" &&
      !p.windupKey &&
      p.abilityCdMs <= 0
    );
  }

  /** Ready-count per activated move, for the strip's badges. */
  activatedStatus(): { key: string; ready: number }[] {
    return this.activatedKeys.map((key) => ({
      key,
      ready: this.players.filter((p) => this.readyToActivate(p, key)).length,
    }));
  }

  /** Active deployed-holder count per team ability. Waiting, dead, grabbed, and
   *  carried zombies do not project team effects. */
  teamAbilityStatus(): { key: string; count: number }[] {
    const deployed = this.players.filter(
      (p) => p.alive && (p.state === "advance" || p.state === "fight")
    );
    return this.teamKeys.map((key) => ({
      key,
      count: deployed.filter((p) => p.abilities.includes(key)).length,
    }));
  }

  /** Recompute type auras from currently deployed carriers. Their source behavior
   *  adds percentages, so two holders contribute +20%, three +30%, and so on. */
  private refreshTeamAuras(): void {
    const counts = new Map(this.teamAbilityStatus().map(({ key, count }) => [key, count]));
    const chivalry = counts.get("chivalry") ?? 0;
    const grace = counts.get("grace") ?? 0;
    const protect = counts.get("protect") ?? 0;
    const fortitude = counts.get("tankHitPointsBuff") ?? 0;
    for (const p of this.players) {
      const stats = p.teamAuraStats;
      p.damageReduction = p.group === "Headless" ? 0 : Math.min(0.95, protect * 0.20);
      if (!stats) continue;
      const statCarriers = p.group === "Female" ? chivalry : p.group === "Regular" ? grace : 0;
      const lifeCarriers = statCarriers + (p.group === "Headless" ? fortitude : 0);
      const oldMaxHp = p.maxHp;
      const oldCooldown = p.cooldownMs;
      const str = stats.baseStr + stats.strPerCarrier * statCarriers;
      const dex = stats.baseDex + stats.dexPerCarrier * statCarriers;
      const con = stats.baseCon + stats.conPerCarrier * lifeCarriers;
      p.maxHp = Math.max(1, Math.round(deriveMaxHp(con)));
      p.hp = Math.max(0, Math.min(p.maxHp, p.hp + (p.maxHp - oldMaxHp)));
      p.power = str * POWER_PER_STR;
      p.damage = Math.max(1, Math.round(deriveHitDamage(p.power, p.attackMultiplier)));
      p.cooldownMs = deriveAttackIntervalMs(dex, "player");
      if (oldCooldown > 0 && p.timerMs > 0) p.timerMs *= p.cooldownMs / oldCooldown;
      p.moveSpeed = advanceSpeed(dex) * p.walkingSpeedMult;
    }
  }

  /** Trigger an activated move on ONE eligible zombie (the front-most). Returns
   *  false if none is ready. Starts the wind-up; the payoff lands when it fills. */
  activate(key: string): boolean {
    if (this.finished) return false;
    const ab = ACTIVATED_ABILITY[key];
    if (!ab) return false;
    let pick: SimUnit | null = null;
    for (const p of this.players) {
      if (!this.readyToActivate(p, key)) continue;
      if (!pick || p.x > pick.x) pick = p; // front-most (nearest the enemy)
    }
    if (!pick) return false;
    if (key === "attachMini") {
      const mini = this.availableMini();
      if (!mini) return false;
      pick.buddyId = mini.id;
      mini.buddyCarrierId = pick.id;
      mini.buddyMountMs = MINI_MOUNT_MS;
      mini.state = "carried";
      mini.distracted = false;
      mini.awaitRelease = false;
      pick.usedAbilities.push(key);
      return true;
    }
    pick.windupKey = key;
    const windup = Math.max(1, pick.cooldownMs * ab.speedMultiplier * ab.damageTiming);
    pick.windupMs = windup;
    pick.windupTotal = windup;
    pick.abilityCdMs = ab.cooldownMs;
    return true;
  }

  /** Advance a charging zombie; on completion deliver the payoff blow. While it
   *  charges it makes no normal attacks (the wind-up is the trade-off). */
  private stepWindup(p: SimUnit, foe: SimUnit, dtMs: number) {
    p.windupMs -= dtMs;
    if (p.windupMs > 0) return;
    const key = p.windupKey!;
    const ab = ACTIVATED_ABILITY[key]!;
    const dmg = Math.max(1, Math.round(p.damage * ab.damageFactor));
    if (ab.aoe) {
      for (const e of this.enemies) {
        if (!e.alive || e.state === "queued" || e.state === "structure" || e.state === "descending") continue;
        if (e.isBoss && !ab.hitBoss && (key === "explode" || key === "explodeV2")) continue;
        this.dealDamage(e, dmg, true);
        if (ab.stunMs) e.stunMs = Math.max(e.stunMs, ab.stunMs);
        this.playerDamage += dmg;
      }
    } else {
      this.dealDamage(foe, dmg, true);
      if (ab.stunMs) foe.stunMs = Math.max(foe.stunMs, ab.stunMs);
      this.playerDamage += dmg;
    }
    p.struckThisTick = true;
    this.attacksLanded++;
    p.windupKey = null;
    p.windupMs = 0;
    if (ab.useOnce && !p.usedAbilities.includes(key)) p.usedAbilities.push(key);
    p.timerMs = this.cycleMs(p, null); // resume normal attacks after a beat
  }

  /** Dismount a Mini Buddy at the line. The shipped ram stuns the enemy for two
   *  seconds and the carrier for one; both zombies then remain in combat. */
  private deployMiniBuddy(carrier: SimUnit, foe: SimUnit | null) {
    if (!carrier.buddyId) return;
    const mini = this.players.find((p) => p.id === carrier.buddyId);
    carrier.buddyId = null;
    carrier.abilityCdMs = 0;
    carrier.stunMs = Math.max(carrier.stunMs, MINI_CARRIER_STUN_MS);
    if (foe) foe.stunMs = Math.max(foe.stunMs, MINI_ENEMY_STUN_MS);
    if (!mini || !mini.alive) return;
    mini.buddyCarrierId = null;
    mini.buddyMountMs = 0;
    mini.x = carrier.x - 10;
    mini.y = carrier.y;
    mini.prevX = mini.x;
    mini.prevY = mini.y;
    mini.charge = 1;
    mini.formOrder = carrier.formOrder + 0.25;
    mini.state = "advance";
    mini.timerMs = this.cycleMs(mini, null);
  }

  /** Authentic Garden support. Heal selects the most injured OTHER deployed
   *  zombie with missing Life and restores 50% of the healer's Power.
   *  Heal All independently fires every 20 seconds for the same amount. */
  private stepHealing(dtMs: number) {
    const deployed = this.players.filter(
      (p) => p.alive && (p.state === "advance" || p.state === "fight")
    );
    for (const healer of deployed) {
      if (!this.isHealer(healer)) continue;
      // A lane blocker takes priority over Garden support work.
      if (this.wallInWay(healer)) {
        healer.healTimerMs = Math.max(healer.healTimerMs, 250);
        continue;
      }
      const amount = Math.max(1, Math.round(healer.power * HEAL_POWER_MULT));

      if (healer.abilities.includes("heal")) {
        healer.healTimerMs -= dtMs;
        if (healer.healTimerMs <= 0) {
          const candidates = deployed.filter(
            (p) => p.id !== healer.id && p.hp > 0 && p.hp < p.maxHp
          );
          if (candidates.length) {
            const target = candidates.reduce(
              (a, b) => b.hp / b.maxHp < a.hp / a.maxHp ? b : a
            );
            target.hp = Math.min(target.maxHp, target.hp + amount);
            target.healFxSeq++;
            healer.healCastSeq++;
            healer.healTimerMs = healer.cooldownMs;
          } else {
            healer.healTimerMs = 250;
          }
        }
      }

      if (healer.abilities.includes("healAOE")) {
        healer.healAoeTimerMs -= dtMs;
        if (healer.healAoeTimerMs <= 0) {
          const damaged = deployed.filter((p) => p.hp > 0 && p.hp < p.maxHp);
          for (const target of damaged) {
            target.hp = Math.min(target.maxHp, target.hp + amount);
            target.healFxSeq++;
          }
          if (damaged.length) healer.healCastSeq++;
          healer.healAoeTimerMs += HEAL_AOE_MS;
        }
      }
    }
  }

  /** Nearest enemy a zombie can reach (on the ground, not queued/perched). */
  private targetEnemy(u: SimUnit): SimUnit | null {
    const wall = this.wallInWay(u);
    if (wall) return wall;
    let best: SimUnit | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.state === "queued" || e.state === "structure" || e.state === "descending" ||
          e.state === "falling" || e.state === "landing" || e.isWall) continue;
      const d = Math.abs(e.x - u.x);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** A stationary wall ahead of this zombie. The latch keeps zombies which were
   *  already beyond the summon point from turning around to attack it. */
  private wallInWay(u: SimUnit): SimUnit | null {
    if (u.passedWall) return null;
    return this.enemies.find((e) => e.alive && e.isWall && u.x <= e.x + 0.5) ?? null;
  }

  /** The FRONT-MOST player within an enemy's striking range — the single zombie
   *  nearest the enemy down the lane, NOT the whole front row. Enemies commit all
   *  their damage to this one target (a big/slow hit knocks it back or drops it
   *  rather than chipping the entire line), so losses are more focused. Among the
    *  front column (zombies sharing the lead x) the tiebreak picks the visually
    *  front-most unit (largest y), matching the renderer's depth order. */
  private playerInRange(e: SimUnit): SimUnit | null {
    let best: SimUnit | null = null;
    for (const p of this.players) {
      if (!p.alive || p.state === "grabbed") continue; // seized zombies are off the lane
      if (Math.abs(p.x - e.x) > this.engageDistance) continue; // out of melee lane range
      if (
        !best ||
        p.x > best.x + 0.5 || // more forward (nearer the enemy) wins
        (Math.abs(p.x - best.x) <= 0.5 && p.y > best.y)
      ) {
        best = p;
      }
    }
    return best;
  }

  /** Whom the boss aims at: the FARTHEST-BACK deployed zombie (min x), so lobbed
   *  throws arc over the frontline tanks and land on the support/healers massed
   *  behind them. "Deployed" = released from the focus bar (brain popped) and now
   *  advancing/fighting on the lane; zombies still waiting or charging are off-limits.
   *  Returns null when nothing is deployed — so the boss doesn't throw at an empty
   *  lane. The lead (see leadVelocity) is applied at launch. */
  private throwTarget(): SimUnit | null {
    const deployed = this.players.filter(
      (p) => p.alive && (p.state === "advance" || p.state === "fight")
    );
    if (!deployed.length) return null;
    return deployed.reduce((a, b) => (b.x < a.x ? b : a));
  }

  /** The velocity a throw leads a target by: its MEASURED velocity (how it actually
   *  moved last step), CLAMPED to PREDICT_SPEED_CAP. So a slow/normal zombie is led by
   *  its true speed (and gets hit), while a fast one is led only as if it were "lowish
   *  speed" — the shot lands behind it and it outruns the throw. Zero when it's not
   *  moving (parked at its slot, fighting), so a stationary target is aimed at directly. */
  private leadVelocity(u: SimUnit): { vx: number; vy: number } {
    const spd = Math.hypot(u.vx, u.vy);
    if (spd < 1) return { vx: 0, vy: 0 };
    const k = Math.min(1, PREDICT_SPEED_CAP / spd);
    return { vx: u.vx * k, vy: u.vy * k };
  }

  /** Can this side still fight? A zombie carried off by a crab is still ALIVE (it returns
   *  after the raid) but is out of the battle, so it must not keep a lost fight running. */
  private anyAlive(side: SimUnit[]): boolean {
    return side.some((u) => u.alive && !u.taken);
  }

  /** Replay-safe equivalent of `(arc4random() % 100)`. Multiplication by 37
   *  permutes all 100 integer results once per cycle, preserving the binary's
   *  exact 9/4/29 successful rolls without making replays nondeterministic. */
  private abilityRoll(u: SimUnit): number {
    const roll = (stringSeed(u.id) + u.abilityRollSeq * 37) % 100;
    u.abilityRollSeq++;
    return roll;
  }

  /** Fire the automatic walking laser. Both versions deal 10% of finalPower;
   *  Ver.2 schedules at finalAttackSpeed/6 instead of /3. */
  private stepLaser(u: SimUnit, dtMs: number) {
    const interval = laserInterval(u.abilities, u.cooldownMs);
    if (interval <= 0) return;
    u.laserTimerMs -= dtMs;
    if (u.laserTimerMs > 0) return;
    const foe = this.targetEnemy(u);
    if (foe) {
      const dmg = Math.max(1, Math.round(u.power * 0.10));
      this.dealDamage(foe, dmg, true);
      u.laserTargetId = foe.id;
      u.laserFxSeq++;
      u.struckThisTick = true;
      this.attacksLanded++;
      this.playerDamage += dmg;
    }
    u.laserTimerMs += interval;
  }

  /** One attack cycle in ms for `u` while facing `foe` — ground truth
   *  `-[Actor getFightAttackSpeed]`. `cooldownMs` already carries the raw dex clock
   *  (2/dex zombie, 1/dex enemy) times the attack's `speedMultiplier`; on top of that:
   *   - a player zombie deeper than the front five swings slower (lineupSpeedBand);
   *   - a Scallywag throws its own clock away and mirrors its opponent's cycle.
   *  Everything that re-arms an attack timer goes through here. */
  private cycleMs(u: SimUnit, foe: SimUnit | null): number {
    if (u.team === "player") return u.cooldownMs * lineupSpeedBand(u.lineupIndex);
    if (u.mirrorsOpponentSpeed && foe && foe.team === "player") {
      const foeSec = (foe.cooldownMs * lineupSpeedBand(foe.lineupIndex)) / 1000;
      return mirroredAttackIntervalSec(foeSec) * 1000;
    }
    return u.cooldownMs;
  }

  /** Land a hit from `u` on `foe` when its clock is ready; else re-arm. An enemy
   *  hit can also knock the zombie back (to the back of the line) and/or stun it. */
  private tryAttack(u: SimUnit, foe: SimUnit, dtMs: number) {
    u.timerMs -= dtMs;
    if (u.timerMs > 0) return;
    u.timerMs += this.cycleMs(u, foe);
    // Player normal swings take the lineup-depth band (front five full, then 0.85/0.7/0.55);
    // enemies always hit at band 1.0. See combatStats.lineupDamageBand (ground truth).
    const dmg =
      u.team === "player"
        ? Math.max(1, Math.round(u.damage * lineupDamageBand(u.lineupIndex)))
        : u.damage;
    if (u.team === "enemy") {
      this.dealEnemyDamage(foe, dmg);
    } else {
      this.dealDamage(foe, dmg, true);
      this.playerDamage += dmg;

      // Girl `damageIn:` uses integer rolls >.70 and >.95. Double Strike adds
      // the authored 0.25× Power strike; Random Stun holds the target for 1s.
      if (u.abilities.includes("doubleStrike") && this.abilityRoll(u) > 70 && foe.alive) {
        const bonus = Math.max(
          1,
          Math.round(u.power * 0.25 * lineupDamageBand(u.lineupIndex))
        );
        this.dealDamage(foe, bonus, true);
        this.playerDamage += bonus;
        this.attacksLanded++;
      }
      if (u.abilities.includes("stun") && this.abilityRoll(u) > 95 && foe.alive) {
        foe.stunMs = Math.max(foe.stunMs, 1000);
      }
    }
    u.struckThisTick = true;
    this.attacksLanded++;
    if (u.team === "enemy" && foe.alive && foe.team === "player") {
      // Enemy attack effects on the struck zombie.
      if (u.stunInflictMs > 0) foe.stunMs = Math.max(foe.stunMs, u.stunInflictMs);
      if (u.knockBack) this.knockBackZombie(foe);
    }
  }

  /** Knock a zombie back: interrupt its attack/wind-up, shove it down the lane, and
   *  send it to the BACK of the formation (source `setZombieToLastIndex`), so it has
   *  to advance to the front again. */
  private knockBackZombie(p: SimUnit) {
    p.windupKey = null;
    p.windupMs = 0;
    p.x = Math.max(CHARGE_X, p.x - KNOCKBACK_PX);
    p.formOrder = this.releaseSeq++; // last in the formation → back column
    p.frontPriority = false;
    p.state = "advance";
    p.timerMs = this.cycleMs(p, null);
  }

  private dealDamage(foe: SimUnit, dmg: number, fromPlayer: boolean) {
    foe.hp -= dmg;
    if (foe.hp > 0) return;
    foe.hp = 0;
    foe.alive = false;
    foe.state = "dead";
    if (foe.buddyId) this.deployMiniBuddy(foe, null);
    if (foe.buddyCarrierId) {
      const carrier = this.players.find((p) => p.id === foe.buddyCarrierId);
      if (carrier) carrier.buddyId = null;
      foe.buddyCarrierId = null;
    }
    if (foe.team === "player" && this.tryResurrect(foe)) return;
    // A downed enemy opens the gate for the next to emerge after a beat.
    if (fromPlayer && foe.team === "enemy") this.emergeCooldown = ENEMY_EMERGE_GAP_MS;
  }

  /** Resurrect is automatic and one-use. A living Garden holder revives the
   *  defeated non-Small zombie at full Life and sends it back into formation. */
  private tryResurrect(defeated: SimUnit): boolean {
    if (this.isSmall(defeated)) return false;
    const healer = this.players.find(
      (p) => p.alive && (p.state === "advance" || p.state === "fight") &&
        p.abilities.includes("ressurect") && !p.resurrectUsed
    );
    if (!healer) return false;
    healer.resurrectUsed = true;
    defeated.alive = true;
    defeated.hp = defeated.maxHp;
    defeated.state = "advance";
    defeated.x = CHARGE_X;
    defeated.y = CENTER_Y;
    defeated.prevX = defeated.x;
    defeated.prevY = defeated.y;
    defeated.formOrder = this.releaseSeq++;
    defeated.frontPriority = false;
    defeated.timerMs = this.cycleMs(defeated, null);
    defeated.windupKey = null;
    defeated.windupMs = 0;
    defeated.stunMs = 0;
    defeated.oneShotProtectionUsed = false;
    defeated.healFxSeq++;
    return true;
  }

  /** Apply an ordinary enemy hit through the recovered player-zombie one-shot floor. */
  private dealEnemyDamage(foe: SimUnit, dmg: number) {
    if (dmg > 0 && foe.abilities.includes("block") && this.abilityRoll(foe) > 90) return;
    const applied = applyDamage(dmg, 0, foe.team === "player" ? foe.damageReduction ?? 0 : 0);
    if (
      applied > 0 &&
      foe.team === "player" &&
      foe.alive &&
      !foe.oneShotProtectionUsed &&
      foe.hp > 1 &&
      (foe.hp - applied) / foe.maxHp < ONE_SHOT_FLOOR
    ) {
      foe.hp = 1;
      foe.oneShotProtectionUsed = true;
      return;
    }
    this.dealDamage(foe, applied, false);
  }

  /** Advance the charging zombie's focus bar, running the bubble minigame unless
   *  Concentration is active. See CHARGE_STEPS: the fill clamps to the next
   *  threshold so a big frame can't skip a distraction. */
  private stepCharge(p: SimUnit, dtMs: number) {
    if (this.concentration) {
      p.charge = Math.min(1, p.charge + dtMs / CHARGE_MS);
      if (p.charge >= 1) this.releaseCharger(p);
      return;
    }
    if (this.noDistractions) {
      if (p.awaitRelease) {
        p.bubbleMs -= dtMs;
        if (p.bubbleMs <= 0) this.releaseCharger(p);
        return;
      }
      p.charge = Math.min(1, p.charge + dtMs / CHARGE_MS);
      if (p.charge >= 1) { p.awaitRelease = true; p.bubbleMs = BRAIN_AUTO_MS; }
      return;
    }
    if (p.distracted) {
      p.bubbleMs -= dtMs;
      if (p.bubbleMs <= 0) p.distracted = false; // auto-refocus
      return;
    }
    if (p.awaitRelease) {
      p.bubbleMs -= dtMs;
      if (p.bubbleMs <= 0) this.releaseCharger(p); // auto-advance
      return;
    }
    const next = CHARGE_STEPS[p.distractStep] ?? 1;
    p.charge = Math.min(next, p.charge + dtMs / CHARGE_MS);
    if (p.charge >= next) {
      p.distractStep++;
      if (next >= 1) {
        // Full bar: gate the release (brain bubble). This is a release prompt, not
        // a focus roll, so it always shows (Concentration path above skips it).
        p.awaitRelease = true;
        p.bubbleMs = BRAIN_AUTO_MS;
      } else if (this.rollDistract(p)) {
        // Passing a 0.25 segment: distract only if the focus roll fails. Miss the
        // roll and the meter keeps filling toward the next segment uninterrupted.
        p.distracted = true;
        p.bubbleMs = BUTTERFLY_AUTO_MS;
      }
    }
  }

  /** Deterministic per-segment distraction roll. GROUND TRUTH (`-[FightFocusBar
   *  update:]`): at each 0.25 charge segment a zombie is distracted iff
   *  `rand01 > focus/100` — so focus 100 (premium) is NEVER distracted, and a
   *  focus-40 starter is distracted ~60% of the time per segment. Uses the
   *  replayable `hash` (keyed by the unit's seed + which segment) instead of an RNG
   *  so the sim stays deterministic/replayable. */
  private rollDistract(p: SimUnit): boolean {
    const r = hash(p.distractSeed * 16.7 + p.distractStep * 3.1);
    return r > clamp(p.focus, 0, 100) / 100;
  }

  /** Release a fully-charged zombie to advance to the front line. */
  private releaseCharger(p: SimUnit) {
    p.state = "advance";
    p.formOrder = this.releaseSeq++; // claim a formation slot on release
    p.distracted = false;
    p.awaitRelease = false;
  }

  /** Player tapped the focus bubble over the charging zombie: a butterfly
   *  (distraction) pop resumes the fill; a brain (full) pop sends it forward.
   *  Returns true if a bubble was actually popped (drives tap feedback). */
  popBubble(id: string): boolean {
    if (this.finished) return false;
    const p = this.players.find((u) => u.id === id);
    if (!p || !p.alive || p.state !== "charging") return false;
    if (p.awaitRelease) { this.releaseCharger(p); return true; }
    if (p.distracted) { p.distracted = false; return true; }
    return false;
  }

  /** The charging zombie showing a focus bubble right now (or null). Only one
   *  zombie charges at a time, so at most one bubble is ever live. */
  chargingBubble(): { id: string; kind: "butterfly" | "brain" } | null {
    const p = this.players.find(
      (u) => u.alive && u.state === "charging" && (u.distracted || u.awaitRelease)
    );
    return p ? { id: p.id, kind: p.awaitRelease ? "brain" : "butterfly" } : null;
  }

  /** Promote the zombie charge queue + the enemy emerge queue (one at a time). */
  private promote(dtMs: number) {
    this.emergeCooldown -= dtMs;

    const charging = this.players.some((p) => p.alive && p.state === "charging");
    if (!charging) {
      const next = this.players.find((p) => p.alive && p.state === "waiting");
      if (next) next.state = "charging";
    }

    if (this.emergeCooldown > 0) return;

    const activeMelee = this.enemies.filter(
      (e) => e.alive && !e.isBoss && !e.isWall && e.state !== "queued"
    ).length;
    const normalsLeft = this.enemies.some((e) => !e.isBoss && !e.isWall && e.alive);
    const blockersLeft = this.enemies.some((e) => e.isWall && e.alive);

    if (activeMelee < MAX_ACTIVE_ENEMIES) {
      const next = this.enemies.find((e) => e.alive && !e.isBoss && e.state === "queued");
      if (next) next.state = "emerging";
    }

    if (this.boss && this.boss.alive && this.boss.state === "structure" &&
        !normalsLeft && !blockersLeft && activeMelee === 0) {
      this.boss.state = "descending"; // climb down, exit out the back, then re-enter
    }
  }

  /** Assign formation slots back-to-front within each depth column. The first
   *  combat-priority unit occupies the visually front-most (largest-y) row, and the
   *  enemy uses that same ordering when choosing a target. Garden healers hold at
   *  SUPPORT_X while any non-healer remains to maintain the frontline. */
  private assignFormation() {
    const committed = this.players.filter(
      (p) => p.alive && (p.state === "advance" || p.state === "fight")
    );
    const front = committed.filter((p) => !this.isHealer(p));
    const support = committed.filter((p) => this.isHealer(p));
    const frontline = front.length ? front : committed;
    const rear = front.length ? support : [];

    frontline.sort(
      (a, b) => Number(b.frontPriority) - Number(a.frontPriority) || a.formOrder - b.formOrder
    );
    rear.sort((a, b) => a.formOrder - b.formOrder);

    // Lineup index = front-to-back rank across the committed army (front-most = 0), driving
    // the depth-damage band. Mirrors `[fightMan zombies] indexOfObject:` — knockback bumps a
    // zombie's formOrder to the back (setZombieToLastIndex), so it re-sorts to a deeper band.
    [...frontline, ...rear].forEach((p, i) => {
      p.lineupIndex = i;
    });

    const place = (units: SimUnit[], baseX: number) => {
      const rowsUsed = Math.min(MAX_ROWS, units.length);
      units.forEach((p, i) => {
        const col = Math.floor(i / MAX_ROWS);
        const rowInCol = i % MAX_ROWS;
        const frontToBackRow = rowsUsed - 1 - rowInCol;
        p.slotX = baseX - col * COL_GAP;
        p.slotY = CENTER_Y + (frontToBackRow - (rowsUsed - 1) / 2) * ROW_GAP;
      });
    };
    place(frontline, this.frontX);
    place(rear, this.supportX);
  }

  /** Advance the sim by `dtMs`. Returns false once the battle is over. */
  step(dtMs: number): boolean {
    if (this.finished) return false;
    this.elapsed += dtMs;
    this.projectileImpactsThisTick = 0;
    for (const u of this.units) {
      u.struckThisTick = false;
      u.prevX = u.x; // snapshot for this step's velocity measurement (see below)
      u.prevY = u.y;
    }
    for (const g of this.grabbers) g.struckThisTick = false;

    this.promote(dtMs);
    this.refreshTeamAuras();
    this.stepEnrage(dtMs);

    // Throws and specials draw from ONE action budget (ground truth: the boss rolls a
    // single weighted pick over `bossActions` per cycle — see stepBossActions).
    this.stepBossActions(dtMs);
    this.stepGrabbers(dtMs);
    this.stepCrabs(dtMs);
    this.stepProjectiles(dtMs);

    this.assignFormation();
    this.stepHealing(dtMs);
    const frontX = this.frontX;

    // Zombies.
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.state === "grabbed") continue; // seized by the trapeze — position driven by stepGrabbers
      if (p.abilityCdMs > 0) p.abilityCdMs -= dtMs; // activated-move recharge
      switch (p.state) {
        case "waiting": {
          // Idle in the back group: stand STILL most of the time, with only an
          // occasional brief shuffle to a nearby spot — so the crowd looks alive
          // without the old constant pacing. Deterministic (cycle-indexed hash, no
          // RNG): each zombie holds a spot for ~85% of its cycle, then eases a few
          // px to the next spot in the last ~15%. No vertical hover.
          const off = p.mill / (Math.PI * 2); // 0..1 per-unit phase
          const period = 2600 + off * 2200; // 2.6-4.8s per shuffle cycle
          const raw = this.elapsed / period + off;
          const cyc = Math.floor(raw);
          const ph = raw - cyc; // 0..1 within the cycle
          const MOVE_FRAC = 0.12; // only the last 12% of the cycle is a shuffle
          const AMP = 14; // shuffle reach in sim px (was a ±26 constant pace) — big
          // enough that the brief shuffle clears the walk-anim threshold (a real
          // step, not a glide), while the long still stretch keeps them planted
          const spot = (c: number) => (hash(c * 1.73 + p.mill) - 0.5) * 2 * AMP;
          const from = spot(cyc);
          let d = from;
          if (ph > 1 - MOVE_FRAC) {
            const t = (ph - (1 - MOVE_FRAC)) / MOVE_FRAC; // 0..1 across the shuffle
            const e = t * t * (3 - 2 * t); // smoothstep ease
            d = from + (spot(cyc + 1) - from) * e;
          }
          p.x = p.homeX + d;
          p.y = p.homeY;
          break;
        }
        case "charging": {
          // Step out to the staging slot (in front of the group) and focus.
          const dx = CHARGE_X - p.x;
          const dy = CENTER_Y - p.y;
          const d = Math.hypot(dx, dy);
          const stepd = (STEP_SPEED * dtMs) / 1000;
          if (d > 2) {
            p.x += (dx / d) * Math.min(stepd, d);
            p.y += (dy / d) * Math.min(stepd, d);
            p.timerMs = this.cycleMs(p, null);
          } else {
            this.stepCharge(p, dtMs);
          }
          break;
        }
        case "carried": {
          p.buddyMountMs = Math.max(0, p.buddyMountMs - dtMs);
          p.timerMs = this.cycleMs(p, null);
          break;
        }
        default: {
          // Stunned by an enemy hit — can't move or attack until it wears off.
          if (p.stunMs > 0) {
            p.stunMs -= dtMs;
            p.timerMs = this.cycleMs(p, null);
            break;
          }
          // Move to the assigned formation slot (never past the enemy).
          const blockingWall = this.wallInWay(p);
          const destinationX = blockingWall
            ? Math.min(p.slotX, blockingWall.x - WALL_MELEE_GAP)
            : p.slotX;
          const mdx = destinationX - p.x;
          const mdy = p.slotY - p.y;
          const md = Math.hypot(mdx, mdy);
          const wasWalking = md > 2;
          const stepd = (p.moveSpeed * (p.buddyId ? MINI_CARRIER_SPEED_MULT : 1) * dtMs) / 1000;
          if (md > stepd) {
            p.x += (mdx / md) * stepd;
            p.y += (mdy / md) * stepd;
          } else {
            p.x = destinationX;
            p.y = p.slotY;
          }
          if (wasWalking) this.stepLaser(p, dtMs);
          // The formation is only for spacing / projectile hitboxes — EVERY zombie
          // that has reached the combat zone attacks the enemy once it has arrived
          // (not just the front row). The enemy still only strikes those in melee
          // range (the front), so front-row / headless zombies take the hits.
          const foe = this.targetEnemy(p);
          const enemyArrived = !!foe && (foe.state === "hold" || foe.state === "fight");
          const inCombatZone = p.x >= frontX - MAX_ROWS * COL_GAP - 12;
          const atSlot = Math.hypot(destinationX - p.x, p.slotY - p.y) <= 2;
          // Knockback and carry/drop effects send a Headless zombie to the rear long
          // enough for another row to fill the open front slot. Once it reaches that
          // recovery slot, restore its defining behavior: it pushes forward again.
          if (p.isHeadless && !p.frontPriority && atSlot) p.frontPriority = true;
          if (p.buddyId && enemyArrived && atSlot) this.deployMiniBuddy(p, foe);
          const atBlockingWall = !!blockingWall &&
            Math.abs(blockingWall.x - p.x) <= WALL_MELEE_GAP + 2;
          if (foe && enemyArrived && (inCombatZone || atBlockingWall)) {
            p.state = "fight";
            // A charging zombie makes no normal attacks — it's winding up the big
            // hit; deliver the payoff when the wind-up fills. Otherwise attack.
            if (p.windupKey) this.stepWindup(p, foe, dtMs);
            else this.tryAttack(p, foe, dtMs);
          } else {
            p.state = "advance";
            p.timerMs = this.cycleMs(p, null);
          }
        }
      }
    }

    // Enemies (emerge / boss descends, then stand and strike; never move otherwise).
    for (const e of this.enemies) {
      if (!e.alive || e.state === "queued" || e.state === "structure") continue;
      if (e.isWall) {
        e.state = "hold";
        e.timerMs = this.cycleMs(e, null);
        continue;
      }
      if (e.state === "falling") {
        e.y = Math.min(CENTER_Y, e.y + (EPIC_BOSS_FALL_SPEED * dtMs) / 1000);
        e.timerMs = this.cycleMs(e, null);
        if (e.y >= CENTER_Y) {
          e.y = CENTER_Y;
          e.state = "landing";
          e.timerMs = EPIC_BOSS_LAND_MS;
        }
        continue;
      }
      if (e.state === "landing") {
        e.timerMs -= dtMs;
        if (e.timerMs <= 0) {
          e.state = "hold";
          e.timerMs = this.cycleMs(e, null);
        }
        continue;
      }
      if (e.state === "descending") {
        if (e.sourceKey === CIRCUS_BOSS_KEY) {
          // The Ringmaster jumps straight down from the circus car instead of using
          // the generic boss route (walk out behind the structure, then re-enter).
          // Keep progress in the existing x/y fields so snapshots and replays need
          // no raid-specific animation state.
          const dy = CENTER_Y - BOSS_STRUCT_Y;
          e.y = Math.min(CENTER_Y, e.y + (dy * dtMs) / BOSS_JUMP_MS);
          const t = clamp((e.y - BOSS_STRUCT_Y) / dy, 0, 1);
          e.x = BOSS_STRUCT_X + (ENEMY_HOLD_X - BOSS_STRUCT_X) * t;
          e.timerMs = this.cycleMs(e, null);
          if (e.y >= CENTER_Y) {
            e.x = ENEMY_HOLD_X;
            e.y = CENTER_Y;
            e.state = "hold";
          }
          continue;
        }
        // Leave the perch by heading OUT THE RIGHT SIDE (through the entrance),
        // staying up at structure height; the renderer slides it off-screen behind
        // the structure. Only once fully off-screen does it drop to the ground and
        // re-enter — no floating diagonally toward the middle.
        const sx = (EMERGE_SPEED * dtMs) / 1000;
        e.x = Math.min(ENEMY_SPAWN_X, e.x + sx); // walk out to the hidden spawn
        e.timerMs = this.cycleMs(e, null);
        if (e.x >= ENEMY_SPAWN_X) {
          e.x = ENEMY_SPAWN_X;
          e.y = CENTER_Y; // now a ground unit, hidden off the right edge
          e.state = "emerging"; // walk back in from the entrance, facing the zombies
        }
        continue;
      }
      if (e.state === "emerging") {
        // Re-enter from the right at ground level and walk left to the hold spot —
        // exactly where the normal enemies attack from.
        const sx = (EMERGE_SPEED * dtMs) / 1000;
        e.x = Math.max(ENEMY_HOLD_X, e.x - sx);
        e.y = CENTER_Y;
        e.timerMs = this.cycleMs(e, null);
        if (e.x <= ENEMY_HOLD_X) {
          e.x = ENEMY_HOLD_X;
          e.y = CENTER_Y;
          e.state = "hold";
        }
        continue;
      }
      // Stunned (by an Explode) — can't act; hold its attack clock.
      if (e.stunMs > 0) {
        e.stunMs -= dtMs;
        e.timerMs = this.cycleMs(e, null);
        continue;
      }
      const foe = this.playerInRange(e);
      if (foe) {
        e.state = "fight";
        this.tryAttack(e, foe, dtMs);
      } else {
        e.state = "hold";
        e.timerMs = this.cycleMs(e, null);
      }
    }

    // Measure each unit's velocity from this step's movement (for boss-throw lead).
    // A big jump is a teleport (knockback re-slot, boss perch↔ground) not real motion —
    // zero it so a throw doesn't lead a phantom high-speed vector.
    const dtSec = dtMs / 1000;
    if (dtSec > 0) {
      for (const u of this.units) {
        const ddx = u.x - u.prevX;
        const ddy = u.y - u.prevY;
        if (Math.hypot(ddx, ddy) > TELEPORT_PX) {
          u.vx = 0;
          u.vy = 0;
        } else {
          u.vx = ddx / dtSec;
          u.vy = ddy / dtSec;
        }
      }
    }

    if (!this.anyAlive(this.players) || !this.anyAlive(this.enemies) || this.elapsed >= MAX_SIM_MS) {
      this.finished = true;
    }
    return !this.finished;
  }

  /** Throw wind-up for the renderer's perched-boss throw animation: 0..1 filling over
   *  the last `windowMs` before the next throw releases (the arm cocks and swings), or
   *  null when the boss isn't perched-and-throwing / has no target. The projectile
   *  launches as this reaches 1, so the renderer can time the arm to the release. */
  bossThrowSwing(windowMs = 550, visualLeadMs = 0): number | null {
    if (!this.bossThrow || !this.boss || !this.boss.alive || this.boss.state !== "structure") {
      return null;
    }
    if (this.isCastingWall()) return null;
    if (this.nextAction?.kind !== "throw") return null; // a special is up next — arm rests
    if (!this.throwTarget()) return null; // empty lane → arm rests
    const visualTimer = Math.max(0, this.actionCd - visualLeadMs);
    if (visualTimer > windowMs) return 0;
    return clamp(1 - visualTimer / windowMs, 0, 1);
  }

  private isCastingWall(): boolean {
    return this.pendingSpecial?.name === "wall";
  }

  /** Progress of the wall-summoning pose. This replaces the normal throw swing
   *  throughout the wall action's authored cast time. */
  bossWallSummonProgress(): number | null {
    const sp = this.pendingSpecial;
    if (!sp || sp.name !== "wall") return null;
    return clamp(1 - this.specialCast / Math.max(1, sp.castMs), 0, 1);
  }

  /** Whether the boss is "active" (able to throw / cast specials): alive and either
   *  perched on its structure or fighting on the ground (not descending/queued). */
  private bossActive(): boolean {
    const b = this.boss;
    return !!b && b.alive && (b.state === "structure" || b.state === "hold" || b.state === "fight");
  }

  /** Round countdown → enrage. When the timer expires the boss enrages once: throws
   *  come faster, specials recover faster, and its melee hits harder. */
  private stepEnrage(dtMs: number) {
    if (this._enraged || !this.boss || !this.boss.alive) return;
    this.roundLeft -= dtMs;
    if (this.roundLeft > 0) return;
    if (this.escapeOnRoundEnd) {
      this.roundLeft = 0;
      this.escaped = true;
      this.finished = true;
      return;
    }
    this._enraged = true;
    if (this.bossThrow) this.bossThrow.intervalMs *= ENRAGE_THROW_MULT;
    this.boss.damage = Math.max(1, Math.round(this.boss.damage * ENRAGE_DMG_MULT));
  }

  /** Boss action scheduler — GROUND TRUTH (`CivilianActorFight bossUpdate:` 0x67e8c).
   *  When the boss's action cooldown expires it makes ONE weighted roll over its whole
   *  `bossActions` list (`rollAgainstFrequencyInArray:`) and dispatches on the chosen
   *  action's name: `throw` launches a projectile and recovers for the raid's
   *  `throwSpeed`; every other action winds up for its `castTime` and then recovers for
   *  its `cooldownTime`. Throws therefore COMPETE with specials for the same slot —
   *  a boss whose list is all throws (most of them) tosses on a plain interval, while
   *  the Robot BrainBot (75 % throws) and the Video Games boss (27 %) throw
   *  proportionally less because their specials consume the budget.
   *
   *  The next action is rolled as soon as the previous one resolves so the renderer can
   *  telegraph it (`bossThrowSwing` only winds the arm when a throw is actually next). */
  private stepBossActions(dtMs: number) {
    if (!this.actions.length || !this.bossActive() || !this.anyAlive(this.players)) return;
    // A special that is already winding up owns the boss until it lands.
    if (this.pendingSpecial) {
      this.specialCast -= dtMs;
      if (this.specialCast <= 0) {
        const sp = this.pendingSpecial;
        this.runSpecial(sp);
        this.pendingSpecial = null;
        this.actionCd = Math.max(300, sp.cooldownMs * (this._enraged ? ENRAGE_SPECIAL_MULT : 1));
        this.rollNextAction();
      }
      return;
    }
    const next = this.nextAction;
    if (!next) return;
    this.actionCd -= dtMs;
    if (this.actionCd > 0) return;
    // The source checks each action's `allowedTo…` gate AFTER the roll but BEFORE arming
    // any timer, so an action it cannot perform right now (a second wall, an exhausted
    // summon) costs nothing — it simply re-rolls on the next tick instead of burning the
    // slot on a no-op cast.
    if (!this.canPerform(next)) {
      this.rollNextAction();
      return;
    }
    if (next.kind === "throw") {
      const target = this.throwTarget();
      if (!target) {
        this.actionCd = 0; // hold the slot until someone is in the lane
        return;
      }
      this.launchProjectile(target, next.option.damage, next.option.sprite, next.option.spriteSize);
      this.throwCount++;
      this.actionCd = this.bossThrow!.intervalMs;
      this.rollNextAction();
      return;
    }
    // A special: wind up now, resolve when the cast completes (above).
    this.pendingSpecial = next.special;
    this.specialCast = Math.max(0, next.special.castMs);
  }

  /** The source's per-action `allowedTo…` gates: a wall while one already stands and a
   *  summon past the cap are refused, and the boss picks again rather than casting a
   *  no-op. Everything else is always performable. */
  private canPerform(action: BossActionChoice): boolean {
    // Only a perched boss throws. Treating a grounded boss's throw as un-performable
    // (rather than simply waiting) matters: otherwise a pre-rolled throw would sit in
    // the slot forever once the boss descends and silently strangle its specials too.
    if (action.kind === "throw") return !!this.bossThrow && this.boss?.state === "structure";
    if (action.kind !== "special") return true;
    if (action.special.name === "wall") {
      // Only a perched boss walls, for the same reason it only throws from up top: the
      // wall materializes at the Garden support line, so a boss that has already climbed
      // down would keep summoning blockers BEHIND itself, mid-lane. Once it descends its
      // whole action budget is melee.
      if (this.boss?.state !== "structure") return false;
      const wt = this.wallTemplate;
      return !!wt && !this.enemies.some((e) => e.alive && e.sourceKey === wt.sourceKey);
    }
    if (action.special.name === "summonBoss") {
      return !!this.summonTemplate && this.summonsLeft > 0;
    }
    return true;
  }

  /** Roll the next action from the merged budget (deterministic — no RNG). */
  private rollNextAction() {
    this.nextAction = weightedPick(this.actions, this.actionCount, 0x51ec1a1);
    if (this.nextAction) this.actionCount++;
  }

  /** Merge the boss's throw options and specials into one weighted table, exactly the
   *  `bossActions` array the source rolls against: each throwable debris keeps its own
   *  authored frequency alongside each special's. */
  private buildActionBudget(): BossActionChoice[] {
    const out: BossActionChoice[] = [];
    if (this.boss && this.bossThrow) {
      for (const option of this.bossThrow.options) {
        out.push({ kind: "throw", weight: option.weight, option, special: null as never });
      }
    }
    for (const special of this.specials) {
      out.push({ kind: "special", weight: special.weight, special, option: null as never });
    }
    return out;
  }

  /** Land a boss special. Effects that need spawned entities (summonBoss, wall) go
   *  through spawnEnemy; both are capped so the fight still resolves. */
  private runSpecial(sp: BossSpecial) {
    switch (sp.name) {
      case "alienLaser": {
        // Flat 200 per bolt — a hard constant in the source, not a stat-derived value
        // (`AlienStageBullet collidedWith:` passes the immediate 200.0f to `damage:`).
        const target = this.throwTarget();
        if (target) {
          this.launchProjectile(target, sp.damage || ALIEN_LASER_DAMAGE, "", 20, { straight: true });
        }
        break;
      }
      case "pixelFire": {
        // Source (`ZFFightMan pixelFire`): picks ONE random eligible zombie and calls
        // `setOnFire` — single-target, and an INTERRUPT rather than a damage-over-time.
        // `setOnFire` cancels the zombie's scheduled swing and puts it in the burning
        // state, but with its destination set to its own position, so the state burns for
        // exactly one frame and leaves. That is the whole effect: a cancelled attack, the
        // stun sfx + pixel-explosion particles, and ~0.08 % of max HP. See
        // combatStats.BURN_MAX_HP_FRACTION_PER_SEC — do NOT turn this back into a DoT.
        const eligible = this.players.filter(
          (p) => p.alive && !p.taken && (p.state === "advance" || p.state === "fight")
        );
        const victim = eligible.length
          ? eligible[Math.floor(hash(this.actionCount * 7 + 5) * eligible.length) % eligible.length]
          : null;
        if (victim) {
          victim.windupKey = null; // the cancelled swing
          victim.windupMs = 0;
          victim.timerMs = this.cycleMs(victim, null);
          this.dealEnemyDamage(
            victim,
            victim.maxHp * BURN_MAX_HP_FRACTION_PER_SEC * SOURCE_FRAME_SEC
          );
          victim.struckThisTick = true;
        }
        break;
      }
      case "turnZombie": {
        // Zedzox turns a zombie against you — model as losing your front unit.
        const victim = this.frontFighter();
        if (victim) {
          this.dealDamage(victim, victim.hp, false);
          victim.struckThisTick = true;
        }
        break;
      }
      case "telekinesis": {
        // Source (`ZFFightMan telekinesis:`) deals NO damage: it lifts the zombie,
        // `knockBackBy:force:` it down the lane and `stunSelfFor:` holds it there.
        const victim = this.frontFighter() ?? this.throwTarget();
        if (victim) {
          this.knockBackZombie(victim);
          victim.stunMs = Math.max(victim.stunMs, TELEKINESIS_STUN_MS);
          victim.struckThisTick = true;
        }
        break;
      }
      case "summonBoss": {
        // Reinforce with a fresh minion (capped so the fight still resolves). It
        // emerges through the normal queue, keeping the boss perched behind it.
        if (this.summonTemplate && this.summonsLeft > 0) {
          this.summonsLeft--;
          this.spawnEnemy(this.summonTemplate);
        }
        break;
      }
      case "wall": {
        // Materialize at the Garden support line. It never walks or attacks.
        // Re-check the perch here as well as in canPerform: with no wall standing and
        // the last minion dead, promote() can start the boss's descent DURING the 3 s
        // cast, and a wall that lands after that would sit behind the boss forever.
        const wt = this.boss?.state === "structure" ? this.wallTemplate : null;
        if (wt && !this.enemies.some((e) => e.alive && e.sourceKey === wt.sourceKey)) {
          const wall = this.spawnEnemy(wt);
          wall.isWall = true;
          wall.state = "hold";
          wall.x = this.supportX;
          wall.y = CENTER_Y;
          wall.prevX = wall.x;
          wall.prevY = wall.y;
          wall.vx = 0;
          wall.vy = 0;
          for (const p of this.players) {
            if (p.alive && p.x > wall.x + 0.5) p.passedWall = true;
          }
        }
        break;
      }
      // telekinesis handled above; anything else is a no-op.
      default:
        break;
    }
  }

  /** Spawn a new enemy from a template mid-fight (summoned minion / wall). It joins
   *  the enemy roster + the shared units array (so the renderer picks it up) and
   *  emerges through the normal one-at-a-time queue. */
  private spawnEnemy(template: CombatUnit): SimUnit {
    const su = toSim({ ...template, id: `spawn${this.spawnSeq++}` }, this.enemies.length);
    su.state = "queued";
    su.hp = su.maxHp;
    su.alive = true;
    this.enemies.push(su);
    this.units.push(su);
    return su;
  }

  /** Front-most fighting player zombie (nearest the enemy), or null. */
  private frontFighter(): SimUnit | null {
    let best: SimUnit | null = null;
    for (const p of this.players) {
      if (!p.alive || (p.state !== "fight" && p.state !== "advance")) continue;
      if (!best || p.x > best.x + 0.5 || (Math.abs(p.x - best.x) <= 0.5 && p.y > best.y)) best = p;
    }
    return best;
  }

  /** Deployed zombies (released from the focus bar and out on the lane). */
  private deployed(): SimUnit[] {
    return this.players.filter(
      (p) => p.alive && (p.state === "advance" || p.state === "fight")
    );
  }

  /** Advance the Trapeze Artist grab hazard. Spawns one at a time on a cadence; successive
   *  appearances alternate right-to-left and left-to-right, seize a selected zombie on
   *  contact, hold ~1s, then rise to carry it off. Tapping (tapGrabber) whittles its HP — killed → the
   *  zombie DROPS back into the fight; escaped off the top → the carried zombie DIES. */
  private stepGrabbers(dtMs: number) {
    if (!this.grabberCfg) return;
    // Spawn one at a time on a cadence, only while there's a deployed zombie to threaten.
    const active = this.grabbers.some((g) => g.state !== "gone");
    if (!active && this.anyAlive(this.players)) {
      this.grabberTimer -= dtMs;
      if (this.grabberTimer <= 0 && this.deployed().length > 0) {
        const victim = this.deployed().sort((a, b) => a.x - b.x)[0];
        this.spawnGrabber(victim);
        this.grabberTimer = GRABBER_SPAWN_MS;
      }
    }
    for (const g of this.grabbers) {
      if (g.state === "gone") continue;
      if (g.tapCdMs > 0) g.tapCdMs -= dtMs;
      if (g.state === "swoop") {
        g.pauseMs = Math.max(0, g.pauseMs - dtMs);
        const t = 1 - g.pauseMs / g.swingTotalMs;
        const eased = t * t * (3 - 2 * t);
        g.rot = g.swingStartDeg + (g.contactDeg - g.swingStartDeg) * eased;
        if (g.pauseMs <= 0) {
          const victim = g.targetId
            ? this.players.find((p) => p.id === g.targetId)
            : null;
          if (!victim || !victim.alive ||
              (victim.state !== "advance" && victim.state !== "fight")) {
            g.state = "gone";
            continue;
          }
          // Re-anchor directly above the victim and turn vertical. Because contactDeg
          // put the artist itself at the victim first, only the rope pivot jumps.
          g.x = victim.x;
          g.y = victim.y - GRABBER_ZOMBIE_OFFSET_Y;
          g.rot = GRABBER_CONTACT_DEG;
          g.grabbedId = victim.id;
          g.targetId = null;
          g.state = "carry";
          g.pauseMs = GRABBER_CARRY_PAUSE_MS;
          victim.state = "grabbed";
          victim.windupKey = null;
          victim.windupMs = 0;
          victim.stunMs = 0;
        }
      } else if (g.state === "carry") {
        const z = g.grabbedId ? this.players.find((p) => p.id === g.grabbedId) : null;
        if (!z || !z.alive) {
          g.grabbedId = null;
          g.state = "gone";
          continue;
        }
        if (g.pauseMs > 0) {
          g.pauseMs -= dtMs;
        } else {
          g.y -= (GRABBER_RISE_SPEED * dtMs) / 1000;
          g.rot = 90;
        }
        z.x = g.x; // the seized zombie rides below the overhead trapeze
        z.y = g.y + GRABBER_ZOMBIE_OFFSET_Y;
        z.prevX = z.x;
        z.prevY = z.y;
        if (z.y <= GRABBER_ESCAPE_ZOMBIE_Y) {
          z.hp = 0; // carried off — the zombie is lost
          z.alive = false;
          z.state = "dead";
          g.grabbedId = null;
          g.state = "gone";
        }
      }
    }
    // Drop inert grabbers so the array (and snapshots) stay small.
    for (let i = this.grabbers.length - 1; i >= 0; i--) {
      if (this.grabbers[i].state === "gone") this.grabbers.splice(i, 1);
    }
  }

  /** Advance the Beach crab hazard. Ground truth (`BeachStageActorCrab update:`): spawns on
   *  the obstacle timer up to `limit` alive at once, wanders, grabs the first deployed
   *  zombie it touches (that zombie goes inert + invincible), holds `holdMs`, then hauls it
   *  off the LEFT edge — at which point the zombie leaves the fight (`taken`, source state
   *  38: NOT death, it comes home afterwards). Tapping it to death (`tapCrab`) frees the
   *  zombie and returns the spawn slot. */
  private stepCrabs(dtMs: number) {
    if (!this.crabCfg) return;
    const live = this.crabs.filter((c) => c.state !== "gone").length;
    if (live < this.crabCfg.limit && this.anyAlive(this.players)) {
      this.crabTimer -= dtMs;
      if (this.crabTimer <= 0) {
        this.spawnCrab();
        this.crabTimer = this.crabCfg.spawnMs;
      }
    }
    for (const c of this.crabs) {
      if (c.state === "gone") continue;
      if (c.tapCdMs > 0) c.tapCdMs -= dtMs;
      if (c.state === "wander") {
        c.wanderMs -= dtMs;
        if (c.wanderMs <= 0) {
          // Re-pick a heading deterministically from the crab's own id + the sim clock,
          // so a replay of the same tick stream reproduces the same patrol.
          c.dir = ((this.crabSeq + Math.floor(this.elapsed / CRAB_WANDER_MS)) % 2 === 0 ? -1 : 1);
          c.wanderMs = CRAB_WANDER_MS;
        }
        c.x += (CRAB_WALK_SPEED * c.dir * dtMs) / 1000;
        if (c.x < CRAB_WANDER_MIN_X) { c.x = CRAB_WANDER_MIN_X; c.dir = 1; }
        if (c.x > CRAB_WANDER_MAX_X) { c.x = CRAB_WANDER_MAX_X; c.dir = -1; }
        const victim = this.deployed().find(
          (p) => !p.taken && Math.hypot(p.x - c.x, p.y - c.y) <= CRAB_HIT_R
        );
        if (victim) {
          c.grabbedId = victim.id;
          c.state = "hold";
          c.holdMs = this.crabCfg.holdMs;
          victim.state = "grabbed";
          victim.windupKey = null;
          victim.windupMs = 0;
          victim.stunMs = 0;
        }
      } else if (c.state === "hold" || c.state === "carry") {
        const z = c.grabbedId ? this.players.find((p) => p.id === c.grabbedId) : null;
        if (!z || !z.alive) {
          c.grabbedId = null;
          c.state = "gone";
          continue;
        }
        if (c.state === "hold") {
          c.holdMs -= dtMs;
          if (c.holdMs <= 0) c.state = "carry";
        } else {
          c.x -= (CRAB_CARRY_SPEED * dtMs) / 1000; // haul it off the left edge
        }
        z.x = c.x; // the seized zombie rides along with the crab
        z.y = c.y;
        z.prevX = z.x;
        z.prevY = z.y;
        if (c.x <= CRAB_EXIT_X) {
          z.taken = true; // out of THIS fight; still alive, still a survivor
          c.grabbedId = null;
          c.state = "gone";
        }
      }
    }
    for (let i = this.crabs.length - 1; i >= 0; i--) {
      if (this.crabs[i].state === "gone") this.crabs.splice(i, 1);
    }
  }

  private spawnCrab() {
    const cfg = this.crabCfg!;
    this.crabs.push({
      id: `crab${this.crabSeq++}`,
      x: CRAB_WANDER_MAX_X,
      y: CENTER_Y,
      state: "wander",
      dir: -1,
      wanderMs: CRAB_WANDER_MS,
      hp: cfg.hp,
      maxHp: cfg.hp,
      tapDamage: cfg.tapDamage,
      grabbedId: null,
      holdMs: 0,
      tapCdMs: 0,
      sprite: cfg.sprite,
      struckThisTick: false,
    });
  }

  /** Player tapped a crab: one tap of damage (rate-limited). Ground truth 100 damage vs
   *  1000 HP = exactly 10 taps. Killing it releases any zombie it holds back onto the lane
   *  (source state 9 → 10, invincibility off) and frees its spawn slot. */
  tapCrab(id: string): boolean {
    const c = this.crabs.find((x) => x.id === id && x.state !== "gone");
    if (!c || c.tapCdMs > 0) return false;
    c.tapCdMs = CRAB_TAP_CD_MS;
    c.hp -= c.tapDamage;
    c.struckThisTick = true;
    if (c.hp <= 0) {
      c.hp = 0;
      const z = c.grabbedId ? this.players.find((p) => p.id === c.grabbedId) : null;
      if (z && z.alive) {
        z.state = "advance"; // released: back on the lane, re-advances from the rear
        z.y = CENTER_Y;
        z.timerMs = this.cycleMs(z, null);
        z.stunMs = 0;
        z.formOrder = this.releaseSeq++;
        z.frontPriority = false;
      }
      c.grabbedId = null;
      c.state = "gone";
    }
    return true;
  }

  /** Crabs the renderer can draw / the player can tap. */
  activeCrabs(): SimCrab[] {
    return this.crabs.filter((c) => c.state !== "gone");
  }

  /** Prepare living zombies for the presentation-only end march. Remaining rescue
   *  hazards are destroyed and drop their passengers; focus/ability poses are
   *  cleared so nobody keeps thinking or attacking after combat has ended. */
  prepareArmyExit(): void {
    const heldIds = new Set<string>();
    for (const grabber of this.grabbers) {
      if (grabber.grabbedId) heldIds.add(grabber.grabbedId);
    }
    for (const crab of this.crabs) {
      if (crab.grabbedId) heldIds.add(crab.grabbedId);
    }

    this.grabbers.length = 0;
    this.crabs.length = 0;
    this.projectiles.length = 0;

    for (const zombie of this.players) {
      if (!zombie.alive || zombie.taken) continue;
      if (heldIds.has(zombie.id)) zombie.y = CENTER_Y;
      if (!zombie.buddyCarrierId) zombie.state = "advance";
      zombie.prevX = zombie.x;
      zombie.prevY = zombie.y;
      zombie.vx = 0;
      zombie.vy = 0;
      zombie.charge = 0;
      zombie.distracted = false;
      zombie.awaitRelease = false;
      zombie.bubbleMs = 0;
      zombie.windupKey = null;
      zombie.windupMs = 0;
      zombie.stunMs = 0;
    }
  }

  private spawnGrabber(victim: SimUnit) {
    const cfg = this.grabberCfg!;
    const seq = this.grabSeq++;
    const swingStartDeg = seq % 2 === 0 ? 0 : 180;
    const targetDx = clamp(
      (victim.x - GRABBER_PIVOT_X) / GRABBER_SWING_RADIUS_X,
      -1,
      1
    );
    const contactDeg = Math.acos(targetDx) * 180 / Math.PI;
    const swingTotalMs = Math.max(
      1,
      GRABBER_FULL_ARC_MS * Math.abs(contactDeg - swingStartDeg) / 180
    );
    this.grabbers.push({
      id: `grab${seq}`,
      x: GRABBER_PIVOT_X,
      y: GRABBER_PIVOT_Y,
      state: "swoop",
      hp: cfg.hp,
      maxHp: cfg.hp,
      tapDamage: cfg.tapDamage,
      grabbedId: null,
      pauseMs: swingTotalMs,
      tapCdMs: 0,
      sprite: cfg.sprite,
      rot: swingStartDeg,
      swingStartDeg,
      contactDeg,
      swingTotalMs,
      targetId: victim.id,
      struckThisTick: false,
    });
  }

  /** Player tapped a Trapeze Artist: deal one tap of damage (rate-limited by tapDelay).
   *  Killing it frees (drops) the zombie it carried back onto the lane. Returns true if a
   *  tap registered (drives tap feedback). */
  tapGrabber(id: string): boolean {
    const g = this.grabbers.find((x) => x.id === id && x.state !== "gone");
    if (!g || g.tapCdMs > 0) return false;
    g.tapCdMs = GRABBER_TAP_CD_MS;
    g.hp -= g.tapDamage;
    g.struckThisTick = true;
    if (g.hp <= 0) {
      g.hp = 0;
      const z = g.grabbedId ? this.players.find((p) => p.id === g.grabbedId) : null;
      if (z && z.alive) {
        // Dropped: it just falls back to the lane and resumes advancing/fighting.
        z.state = "advance";
        z.y = CENTER_Y;
        z.timerMs = this.cycleMs(z, null);
        z.stunMs = 0;
        z.formOrder = this.releaseSeq++; // re-enters at the back of the formation
        z.frontPriority = false;
      }
      g.grabbedId = null;
      g.state = "gone";
    }
    return true;
  }

  /** The live Trapeze Artist currently carrying a zombie (renderer taps it), or null. */
  activeGrabber(): SimGrabber | null {
    return this.grabbers.find((g) => g.state === "carry") ?? null;
  }

  /** Player tapped a boss-summoned wall: chip it (ground truth ZFFightWall ccTouchEnded →
   *  damage: ≈ maxHp/20). Returns true if a wall took the tap. */
  tapWall(id: string): boolean {
    const w = this.enemies.find((e) => e.id === id && e.isWall && e.alive);
    if (!w) return false;
    this.dealDamage(w, WALL_TAP_DAMAGE, true);
    w.struckThisTick = true;
    return true;
  }

  /** Launch a projectile at a target, LEADING its (capped) motion so it connects with
   *  advancing zombies. Ballistic by default (a lobbed throw); pass `straight` for a
   *  fast flat bolt (alien laser). */
  private launchProjectile(
    target: SimUnit,
    damage: number,
    sprite: string,
    spriteSize: number,
    opts: { straight?: boolean } = {}
  ) {
    const x0 = BOSS_STRUCT_X;
    const y0 = BOSS_STRUCT_Y;
    const grav = opts.straight ? 0 : GRAVITY;
    // Flight time: a straight bolt is range/speed; a ballistic lob scales with range.
    const T = opts.straight
      ? (Math.hypot(target.x - x0, target.y - y0) || 1) / LASER_SPEED
      : clamp(Math.abs(target.x - x0) / 520 + 0.7, 0.85, 1.7);
    // Aim where the target will be after T, using its speed-capped lead velocity.
    const { vx: lvx, vy: lvy } = this.leadVelocity(target);
    const tx = target.x + lvx * T;
    const ty = target.y + lvy * T;
    let vx: number;
    let vy: number;
    if (opts.straight) {
      const dx = tx - x0;
      const dy = ty - y0;
      const d = Math.hypot(dx, dy) || 1;
      vx = (dx / d) * LASER_SPEED;
      vy = (dy / d) * LASER_SPEED;
    } else {
      vx = (tx - x0) / T;
      vy = (ty - y0) / T - 0.5 * GRAVITY * T; // ballistic solve to the lead point
    }
    this.projectiles.push({
      id: `proj${this.projSeq++}`,
      x: x0,
      y: y0,
      vx,
      vy,
      rot: 0,
      rotSpeed: (vx < 0 ? -1 : 1) * 7,
      damage: damage > 0 ? Math.max(1, Math.round(damage)) : 0,
      sprite,
      spriteSize,
      done: false,
      gravity: grav,
    });
  }

  /** Integrate each throw under gravity; lazy circle collision vs zombies; a throw
   *  that reaches the ground has missed. Fast/small zombies can be missed. */
  private stepProjectiles(dtMs: number) {
    const dt = dtMs / 1000;
    for (const pr of this.projectiles) {
      if (pr.done) continue;
      pr.vy += pr.gravity * dt; // gravity 0 for straight bolts (alien laser)
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.rot += pr.rotSpeed * dt;
      const hitR = ZOMBIE_HIT_R + pr.spriteSize * PROJ_HIT_FACTOR;
      for (const p of this.players) {
        // A thrown item can only strike zombies that have moved out to fight —
        // ones still waiting in the group or charging up are safe.
        if (!p.alive || (p.state !== "advance" && p.state !== "fight")) continue;
        const dx = p.x - pr.x;
        const dy = p.y - pr.y;
        if (dx * dx + dy * dy <= hitR * hitR) {
          // Carried grabs are the Trapeze Artist (stepGrabbers) and the Beach crab
          // (stepCrabs), not projectiles — a projectile only ever deals damage.
          this.dealEnemyDamage(p, pr.damage);
          p.struckThisTick = true;
          this.projectileImpactsThisTick++;
          pr.done = true;
          break;
        }
      }
      if (pr.done) continue;
      // A ballistic throw fizzles (misses) once it reaches the ground.
      if (pr.y >= GROUND_Y) pr.done = true;
    }
    // Compact in place (keep the readonly array reference stable).
    let w = 0;
    for (let r = 0; r < this.projectiles.length; r++) {
      if (!this.projectiles[r].done) this.projectiles[w++] = this.projectiles[r];
    }
    this.projectiles.length = w;
  }

  /** Whether the player side won (all enemies dead). Meaningful once finished. */
  get playerWon(): boolean {
    return !this.anyAlive(this.enemies);
  }

  /** Ms left before the boss enrages (0 once enraged / no boss). For the HUD timer. */
  roundRemainingMs(): number {
    return this.boss ? Math.max(0, this.roundLeft) : 0;
  }

  /** Has the boss enraged (round timer expired)? Drives the HUD's ENRAGED banner. */
  get enraged(): boolean {
    return this._enraged;
  }

  /** Snapshot the result in the shape the reward pipeline expects. */
  outcome(): RaidOutcome {
    return {
      win: this.playerWon,
      rounds: this.attacksLanded,
      survivors: this.players.filter((u) => u.alive).map((u) => u.id),
      losses: this.players.filter((u) => !u.alive).map((u) => u.id),
      enemiesBeaten: this.enemies.filter((e) => !e.alive).length,
      playerDamage: this.playerDamage,
      escaped: this.escaped,
    };
  }
}
