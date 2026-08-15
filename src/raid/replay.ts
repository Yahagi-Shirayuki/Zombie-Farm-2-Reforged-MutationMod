import { BattleSim, type BattleSimSnapshot } from "./BattleSim";
import type { RaidOutcome } from "./types";

// 6: hazards moved client-only (the verifier no longer simulates the trapeze) and
// `clientWin` concessions were added — in-flight v5 sessions must not replay under these
// rules, so the bump invalidates them via the existing stale_ruleset path.
// 7: recovered zombie abilities changed deterministic damage, healing, movement,
// resurrection, and fight duration. This bump prevents a newer client and an older
// Worker from accepting a fight under the same identifier and then disagreeing on
// whether its transcript reached a completed outcome.
// 8: enemy CADENCE corrected to the disassembled clock — `ENEMY_ATTACK_PACE=2` retired
// (enemies attack at 1/dex, twice as often as an equal-dex zombie), per-attack
// `speedMultiplier`, the Scallywag's opponent mirror, the farm raid's level speed-up, the
// player lineup-depth slowdown band, and ground-truth boss throw / laser / burn /
// telekinesis values. Every one of those changes the deterministic transcript.
// 9: post-v8 simulator corrections changed pixelFire from a long burn to a one-frame
// interrupt and made Mini Buddy use authored Small/Large groups for special zombies.
// In particular, a v8 client could attach a mini to Dapper while an older v8 Worker
// attached it to a different Large zombie, causing a late truncated_transcript.
// 10: boss throws and specials now share ONE weighted action budget (ground truth: the
// source makes a single roll over `bossActions` per cycle), instead of running on two
// independent timers. Bosses whose lists mix throws with specials — the Robot BrainBot
// and the Video Games boss — now throw proportionally less, which changes the
// deterministic transcript from the first boss action onward.
// 11: two fidelity corrections that both change the transcript from tick 0. (a) Mutation
// stat bonuses are now applied LAST, as the source's `modifyStatWithMutations:` does,
// instead of being baked into the base stat before the player-level ramp — mutated
// zombies below level 25 are substantially stronger than under v10. (b) The 10 raids
// that are not McDonnell now field their AUTHORED single wave at every level instead of
// an extrapolated per-level ladder, so both the enemy count and composition change.
// 12: formation vacancies now refill correctly after knockback. A displaced Headless
// zombie temporarily yields its priority so the next row can advance, then resumes its
// defining push-to-front behavior after reaching its recovery slot.
// 13: the boss's wall special is now gated on the perch (Ninja carrotWall / Robot
// junkWall). A descended boss used to keep summoning blockers behind itself at the
// Garden support line; it now spends its whole budget on melee once it climbs down, so
// the transcript diverges from the first post-descent action. This bump also raises
// ARMY_CAP 16 → 20, which a v12 Worker would reject as `bad_roster`.
// 14: player taps on a boss-summoned wall (Ninja carrotWall / Robot junkWall) are now
// TRANSCRIBED as `wallTap` input. The wall is the one hazard the verifier simulates — the
// other two are client-only — so the client chipping it for 75 a tap without telling the
// server put the two simulations permanently out of step from the first tap. The player
// then lost the fight on the server's un-tapped wall while winning it on screen, and the
// finish was rejected (`illegal_ability` / `truncated_transcript`). Losses were absorbed
// by the `clientWin` concession; wins were not, so a winning Ninja run could never settle.
// 15: NOT a simulation change — a deliberate retirement of every bundle that can
// destroy its own live invasion. Up to v14 the client's abandoned-raid recovery
// (EconomyClient.recoverResumableRaid) ran from four MID-SESSION bootstraps and settled
// the fight in progress with a tick-0 retreat; the player then won, /raid/finish
// replayed that stored zero result, and the victory panel showed 0 gold / 0 brains /
// no loot with no error anywhere. The fix is client-side, so a cached or installed v14
// bundle would keep eating wins until its owner happened to accept the update prompt.
// Bumping here refuses `/raid/start` from those bundles (426 stale_ruleset → the
// existing reload prompt), which is the only way to make the fix reach everyone. Cost,
// accepted knowingly: an invasion in flight at deploy time settles as stale_ruleset and
// pays nothing.
// 16: Zombies vs Robots composes its wave differently. The raid's `randomBoss` flag is
// now honoured (one of each bot, a random one leading — ground truth ZFFightMan
// initialSpawn), seeded by the raid session id so the client and the pinned server
// config draw the SAME wave; and boss specials no longer scan the whole roster, so only
// a JunkBot boss summons junk walls. A v15 bundle would field the old fixed BrainBot
// wave against a v16 pinned config and desync on the first tick.
// 17: the Lawyers boss's Double Punch special (`CorporateBossPunchSpecial`) STUNS and no
// longer knocks back. The shipped plist flagged it both; his page lists the stun as his
// special, and he is the only stunner in the attack table, so the shove is dropped and the
// 1 s hold kept (see ATTACK_OVERRIDES in tools/prep_raids.py). The struck zombie now holds
// its slot instead of being re-sent to the back of the formation, so a v16 client and a v17
// Worker would disagree about the Lawyers fight from the boss's first special onward.
// 18: a ONE-USE activated ability (Explode / Explode Ver.2 / Mini Buddy) is now spent
// the instant the player commits it, not when its wind-up pays off. Anything that
// cancels a wind-up mid-charge — a knockback, the Video Games boss's pixelFire, and
// (client-only) a trapeze or crab grab — used to hand the move straight back, because
// `usedAbilities` was written at the payoff and Explode carries no cooldown to mask the
// gap. On the two hazard raids that made the two simulations disagree about a REFUSED
// tap rather than about timing: the client's grabbed leprechaun could explode a second
// time, the server's (which never grabs anyone) was still charging the first, and the
// finish died on `illegal_ability` — a player-reported bug on exactly the Silver Small's
// two explosion buttons. Same cost as v15: an invasion in flight at deploy time settles
// as stale_ruleset and pays nothing.
// 19: Explode / Explode Ver.2 now KILL the zombie that uses them. The blast still lands
// first (full 10× area hit and 3 s stun), then the performer is dealt its remaining Life
// and joins the raid's losses — a real price for the army's biggest single hit, and what
// "the zombie explodes" should have meant all along. Only Smalls carry the move and
// `tryResurrect` refuses Smalls, so the death is final. This changes who is standing for
// the rest of the fight, so a v18 client and a v19 Worker diverge from the first tap
// onward. Same cost as v15: an invasion in flight at deploy time settles as
// stale_ruleset and pays nothing.
// 20: Explode is a FUSE, not a swing. It can now be lit by any zombie that has reached
// the combat zone — no enemy has to be standing in front of it — and once lit the charge
// keeps burning down and detonates on schedule even into an empty field. Before this the
// gate was `state === "fight"`, which flips off in every gap between one enemy dying and
// the next walking on, so the move you most want to pre-time was the one you could not.
// Both halves move the client/server agreement: a tap that a v19 Worker REFUSES as
// `illegal_ability` a v20 client accepts, and a charge a v19 Worker freezes a v20 client
// pays off. Same cost as v15: an invasion in flight at deploy time settles as
// stale_ruleset and pays nothing.
// 21: Resurrect no longer refuses Small zombies, so an exploder can be brought back —
// and a revived zombie now comes back WHOLE, one-use moves included. Two corrections in
// one: the blanket `isSmall` refusal was read off a wrong annotation in
// ZOMBIE_ABILITIES_BINARY_AUDIT.md (it called `canRez`'s state-100 rejection "the
// mini-zombie case"; `-[ZombieActorSmall suicide:]` sets exactly state 100, so the source
// was refusing the SUICIDED zombie, not Smalls as a type) — which meant a Small cut down
// by an ordinary enemy could not be revived either, for no reason at all. And ZF2's
// refusal of the suicided zombie is DELIBERATELY not carried over: an exploder that a
// Garden holder brings back rejoins the queue its move is picked from. It rejoins at the
// BACK, though — `abilityRearms` outranks position in `activate` — so a second Explode
// spends a zombie that still has one instead of killing the same one twice while its
// squadmates stand there. All three change who is standing and who acts, so a v20 client
// and a v21 Worker diverge from the first revival. Same cost as v15: an invasion in
// flight at deploy time settles as stale_ruleset and pays nothing.
// 22: two changes, either of which alone would force the bump.
// (a) The Brain Ticket adds ELITE invasions (src/raid/eliteInvasion.ts) — an authorized
// launch may now pin a wave whose enemy str/con/dex, boss projectiles, boss specials and
// summoned wall are all multiplied by that raid's elite profile. A v21 Worker ignores
// `brainTicket` entirely, so it would pin the ordinary wave against a v22 client fighting
// the scaled one and diverge on the very first tick; `/raid/start` also gained a
// `no_brain_ticket` refusal a v21 client cannot interpret.
// (b) A KNOCKBACK enemy with nothing inside `engageDistance` now strikes the front-most
// zombie close enough to be hitting IT (BattleSim.playerInRange). Knockback shoves its
// victim 150 units back and re-slots it last, landing it inside the 220-deep band it
// still attacks from but far outside the enemy's 60-unit reach — so an enemy could clear
// its own melee range and then stand there being killed, punished for using its ability.
// This changes the transcript of every fight against a knockback unit from its first
// shove: Old McDonnell's Lumberjack and boss, and the Video Games knights, monsters and
// boss. Only those units, deliberately — handing the longer reach to every enemy also
// re-balances the raids that merely lose a target for a beat, and flips a recorded Circus
// victory in the server's fixtures into a defeat. It does make the ORDINARY Video Games
// invasion materially harder (measured difficulty 1.59 -> 2.11), which is the fix landing
// rather than a balance pass. Same cost as v15: an invasion in flight at deploy time
// settles as stale_ruleset and pays nothing.
// 23: the ZOMBIE FORMATION and KNOCKBACK, plus the alien boss's laser, are now the ones in
// the binary rather than this sim's approximations. Four transcript-changing pieces, any
// one of which forces the bump (see docs/mechanics/ZOMBIE_FORMATION_RECOVERED.md and
// ALIEN_RAID_RECOVERED.md):
// (a) FORMATION. `-[ZombieActor calculateDestinationPoint]` derives a zombie's slot from
// its index in `[fightMan zombies]`: depth band = index / FIVE (the same divisor the damage
// and cadence falloffs already used, where the layout used four), and the slot inside a band
// is its rank by BODY TYPE — Small, Headless, Girl, Regular, Large, Garden — each with its
// own standoff, so a light body plants closer to the enemy than a heavy one. Gardens take a
// further fixed setback. The old layout filled 4-deep columns in release order with the
// Headless sorted to the front; the new one changes who is standing where, and therefore who
// the enemy's front-most-target rule picks, from the first frame of every fight.
// (b) HEADLESS PROMOTION is now the source's repair rather than a standing sort: only when
// NO engaged Headless is in the front five is the last one pulled to index 0.
// (c) KNOCKBACK. `-[Actor damageIn:]` rolls `-(50 + arc4random() % 100)` at `force: 5.0`, and
// `movementUpdate:` SLIDES the victim there at force*60 — it is not the old fixed 150-unit
// teleport. For the 0.17-0.5 s the slide lasts the zombie neither walks nor fights and is not
// a melee target, because a live `knockBackPoint` makes `isInMeleeRange` false.
// (d) The alien boss's laser picks a RANDOM ENGAGED zombie (`shootBullet:from:`) instead of
// the rear-most deployed one, holds fire when nobody is engaged, flies at the recovered 180
// points/second instead of a guessed 900, and leaves from one of the saucer's two gun ports.
//
// (d2) SUPER ARMOUR. `cantInterrupt` in Attacks.json is carried by exactly four attacks —
// ZombieBash, ZombieBashV2, ZombieExplode, ZombieExplodeV2 — and `-[Actor fightAttack:]`
// turns it into `fightData.canInterrupt = NO` for that swing, which `damageIn:` checks before
// applying EITHER the stun or the knockback. So a zombie mid-Bash/Smash/Explode can no longer
// be shoved or stunned out of the move it spent a charge on. Previously nothing was immune.
// (e) BALANCE RE-FIT, forced by (c). The Video Games invasion is built out of knockback
// enemies, so it absorbs nearly all of the new shove: its measuring-stick difficulty goes
// 1.99 -> 2.38 ORDINARY. That is the ladder's top rung, and three elite profiles are pinned
// to it, so ELITE_PROFILES 3 / 5 / 6 are re-fitted x1.3 on each multiplier's distance from
// 1.0 (shape untouched) to hold the rungs and the top band. ELITE_PROFILES[9] is NOT
// touched: flattening it was tried and cannot buy back the winnability, because the problem
// was never its own multipliers. The balance suite's "maxed roster" stick also moves 2.2 ->
// 3.0, since at 2.2 it was consumed by the ORDINARY Video Games fight alone and so measured
// its own ceiling rather than the tuning. Same cost as v15: an invasion in flight at deploy
// time settles as stale_ruleset and pays nothing.
// 24: MINIS NO LONGER LEAD THE ROW. v23 brought over the binary's per-body standoff, in
// which the lightest body plants closest to the enemy — `Small: -15`, and the front-most
// slot of its band. Paired with this sim's front-most-target rule (`playerInRange` commits
// an enemy's whole output to the single nearest zombie), that made every Mini in the army
// the designated casualty of every fight, which is what players reported. A Mini now
// buckets and stands with Regular (so do the Cupid Gardens that bucket with Small), leaving
// the Headless as the one body that pushes to the front — its defining behaviour, and
// untouched here. Who stands where decides who the enemy hits, so the transcript diverges
// from the first frame of every fight with a Mini in the party. Narrowing the standoff
// spread also shortens BAND_ROW_DEPTH, which relaxes the in-row compression for every army.
// Same cost as v15: an invasion in flight at deploy time settles as stale_ruleset and pays
// nothing.
// 25: MUTATION VALUES. Four entries in the mutation CATALOG changed what they are worth,
// which changes the army a raid is fought with — `buildPlayerUnits` folds the mutation
// bonus in as a flat addition (v11), so a mutated party's str/dex/con differ from the
// first frame. Eyebiscus and Heartichoke also stopped RIDING a lower tier's bit and were
// appended as mutations of their own, so a unit of either species now carries a different
// mask entirely (upgraded on both sides inside makeOwned — see zombie/variantMutations,
// which is why the two simulations still agree). The four:
//   Eyebiscus    (new bit) +1 str, +2 dex — was Carrot-eyed's +1 dex
//   Heartichoke  (new bit) +5 con         — was Cauli-hair's +3 con, and in the BODY slot
//   Cauli-hair   +3 -> +4 con             — it was identical to Broccohair, six crop
//                                           levels earlier, and lost every Pot conflict
//   Pumpking     +3 -> +4 str             — it was identical to Garlichead, fourteen crop
//                                           levels earlier
// A fight ALREADY in flight replays from its pinned `config_json` and so is not affected
// by the numbers themselves; the bump is for the launch handshake, where a client holding
// the old catalog would otherwise build a different army than the Worker does. Same cost
// as v15: an invasion in flight at deploy time settles as stale_ruleset and pays nothing.
// 26: RESURRECT, brought back to what the binary actually does. Three changes, all in
// BattleSim, all of which move raid outcomes and so must be versioned:
//   * A revived zombie is ALIVE BUT SPENT. `-[ZombieActorGarden ressurectZombie:]`
//     (0x7d3c2-0x7d436) walks the revived actor's abilityList and hands every consumable
//     ability `setConsumed:YES`; `isUseable` (0x9cafc) then refuses it. So an exploder
//     pulled out of its own blast can NOT light a second fuse, and a revived Garden holder
//     can NOT pay the revive forward. It is unconditional — a one-use move the zombie never
//     got round to using is spent too. This retires the v21 re-arm divergence along with
//     `SimUnit.abilityRearms` and its back-of-the-queue tiebreak, which existed only to
//     make the re-arm survivable.
//   * Resurrect now draws from a CORPSE BACKLOG. `-[ZombieActor fightUpdate:]` (0x4d406)
//     appends the dead to `ZFFightMan.defeatedZombies`, which nothing drains but a revival,
//     and the Garden polls `canRez` against it from its own update. The old model fired at
//     the instant of death and lost the corpse if no holder was deployed yet; a holder that
//     arrives later now still brings that casualty back. Target is the most recent corpse.
//   * Resurrect pre-empts Heal on a holder that carries both, matching the single shared
//     cast slot and the `canRez`-before-`canHeal` order at 0x7c0a8.
// Same cost as v15: an invasion in flight at deploy time settles as stale_ruleset and pays
// nothing. In-flight checkpoints are safe — a session pinned to 25 is rejected outright,
// so no pre-backlog snapshot is ever fed to this code.
// 27: THE ALIEN RAID, run against the binary a second time after a tester's report. Full
// disassembly in docs/mechanics/ALIEN_RAID_RECOVERED.md §7. Three of the fixes move raid
// outcomes and so must be versioned:
//   * ZOMBIES VS ALIENS IS A SWARM. `-[ZFFightMan spawnEnemyIn:]` fills a five-slot
//     `enemySlots` array beside the one "current" enemy — six at once — and `spawnTimer`
//     seeds to 10 s on stage 6 and 3600 s everywhere else, so the alien raid is the only
//     one whose slots are ever filled. The other ten stay one-at-a-time, unchanged.
//   * A LANDED BOSS HAS NO ACTIONS. `-[CivilianActorFight bossUpdate:]` only rolls an
//     action in state 19, and a boss that has finished its descent is in state 9 — below
//     the 15..27 window — so it drops through to `civilianUpdate` and just swings. This
//     used to be enforced for throws and walls only, which left Zedzox casting turnZombie
//     and the alien boss firing its laser for the whole ground phase.
//   * `summonBoss` ABDUCTS HUMANS. `bossSummonList` is seeded with four of them and
//     refilled by a five-way roll on every cast, so it never runs dry; the real limit is
//     `allowedToSummonBoss` refusing a second while the first still lives. It replaces a
//     cap of three copies of the wave's own minion, and the abductee is off-budget.
//   * AN ATTACK'S EFFECTS LAND AT ITS OWN FREQUENCY. A unit rolls ONE entry out of its
//     `attacks` list per swing and applies that entry's flags, so knockback and stun
//     belong to the entry that carries them, not to the unit. Collapsing the list to a
//     boolean gave every swing the rarest entry's effects — the Lumberjack's shove lives
//     on a 10 %-frequency special and he was shoving on all 100 %. Also moves the Lawyers
//     boss's stun (40 %) and the Special/TreeWorld/Valentine's minions 2 and 3 (50 %);
//     every other carrier is already at 100 % and is unchanged.
// Two data changes ride along, both playtest verdicts rather than recovered values, and
// both recorded where a regeneration cannot undo them (tools/prep_raids.py UNIT_OVERRIDES,
// BattleSim SUMMON_SPAWN_X): the alien minion's str 6 -> 5 (4 was tried first and read as
// too soft), because the recovered swarm delivers the authored number six times over onto
// one zombie; and the abductee's landing point moved from the stage's arithmetic centre
// onto the scorch mark it is visibly beamed onto. A later playtest also moved the two
// LINES both armies stand on — ENEMY_HOLD_X 915 -> 940 (the zombies' front rank follows it)
// and the Garden healers off a relative setback onto a fixed station at 3/10 of the stage
// (GARDEN_STATION_X) — which changes who is in range of what from the first frame.
// ELITE_PROFILES 6 and 9 are re-fitted in the same change — both raids' difficulty moved
// under the rules above, and the profiles are pinned to a measured ladder.
// Same cost as v15: an invasion in flight at deploy time settles as stale_ruleset and pays
// nothing. The v26 checkpoint fields it retires (`summonsLeft`) are read defensively in
// BattleSim.restore, but a session pinned to 26 is rejected at the handshake anyway.
// v28 — EPIC BOSS RETUNE, two coupled edits in tools/prep_all_epic_bosses.py, mirrored
// into every epic catalog:
//   * the attempt window (EPIC_BOSS_FIGHT_MS) 30 s -> 60 s, and
//   * every rung of EPIC_BOSS_DAMAGE scaled by 0.8 (the ramp's SHAPE is unchanged, so
//     "higher unlock, higher damage" still holds exactly).
// Epic fights are server-replayed through this module and the window is the fight's
// deadline, so a transcript recorded under 30 s does not replay under 60 s.
//
// A BALANCE change, not a mechanics one — no rule here moved. Zombies still enter one at
// a time every CHARGE_MS, which is precisely why the window is load-bearing: it decides
// how much of the army ever reaches the boss (6 of 20 at 30 s, 13 at 60 s), so damage per
// attempt is super-linear in it and a 20-rung ladder cost 135 attempts for an ordinary
// army. Cutting that to roughly a third was the point. The second effect is that the
// per-boss ramp finally becomes legible — it was worth about one zombie across the whole
// ladder at 30 s — and the 0.8x scale is what keeps that from overshooting into
// "own the one right tank or do not play".
// Same cost as every bump: an epic attempt in flight at deploy settles as stale_ruleset.
//
// v29 — EPIC BOSS DAMAGE COMPOUNDS 5% PER RUNG (epicBossDamage in epicBoss/catalog.ts).
// Rung 1 keeps its authored value, so the entry fight of every event is unchanged; the top
// of a ten-rung ladder now hits 1.05^9 = 1.55x. Both the client sim and this module's
// replay read the same helper, so a fight recorded on rung N replays at rung N's damage.
//
// WHY. Play-tested: a maxed army cleared Loco Locust — the hardest event in the game — in
// 11 attempts without losing a single zombie, taking the top rung in two. HP could not fix
// that. HP only buys attempts (the fight is capped and damage carries over), so a ladder
// tuned by HP alone is walkable by any army with enough patience, which is precisely what
// an endgame event should not be. Damage is regressive by design here: it costs a weak
// roster far more than a developed one, and that IS the gate. The bounding rule is
// unchanged and still holds at the new top-rung values — see epicBoss/combat.test.ts.
//
// v30 COMBAT POSITIONING AND EFFECT-FREQUENCY PASS. Production is already pinned to v29,
// so this deterministic batch needs its own version. It changes enemy/front-line and
// Garden support positions, makes alien abductees stationary mid-field blockers, and
// makes knockback/stun respect authored attack-entry frequency instead of every swing.
//
// The same bump covers MINI BUDDY's window. The move is loaded onto a Large while it
// stands in the deployment slot, and
// `readyToActivate` also accepted one still queued at the back ("waiting"), which is not a
// display detail: the button armed from the first frame of the fight and a tap loaded the
// mini onto whichever carrier was furthest right, deployment slot or not. It now requires
// the carrier to have REACHED the slot, which is a tap the sim used to accept and now
// refuses. The finish path drops a refused ability rather than failing (see
// `advanceRaidSegment`), so the two simulations would have settled different fights
// instead of erroring — which is exactly why this needs the bump rather than a quiet fix.
// v31 ZEDZOX'S TWO SPECIALS. Both change the Video Games transcript from the boss's first
// action, and both add a transcribed tap, so the bump is forced twice over.
//
//   * `turnZombie` CONVERTS instead of deleting. It used to be modelled as
//     `dealDamage(victim, victim.hp)`: your front zombie evaporated where it stood, with
//     no projectile, no animation and no attacker within reach, and went home a permanent
//     casualty. That is the "zombies keep dying suddenly for no reason" players reported
//     on this invasion, and it was never what the action does — the source name, the wiki
//     text, and an authored-but-never-spawned `VideoGameStageZombieActor` (con 10000, its
//     own idle/attack frames, listed in no stage table) all say convert. The zombie is now
//     carried out of the fight as `taken` — alive, a survivor, NOT a loss — and a pixel
//     zombie stands up mid-lane wearing its identity. Twenty taps break it open and hand
//     the zombie back (`turnedTap`). A converted body is excluded from the win condition:
//     at a million hit points a fight that had to kill it would run to the cap every time.
//   * `pixelFire` BURNS. Recovered, it lasts exactly one frame — `setOnFire` parks the
//     zombie's destination on its own position, so the burning state ticks once and
//     leaves, making the boss's headline special worth about two damage. It now burns for
//     PIXEL_FIRE_BURN_MS at the recovered 5 %/s while the zombie panics on the spot, and
//     the player can smother it with a tap (`fireTap`). A DELIBERATE divergence from
//     ENEMY_DAMAGE_RECOVERED.md, which the doc now records as such.
//
// Both taps are transcribed for the reason `wallTap` is (v14): they move the SERVER's
// simulation too, and an untranscribed one puts the two permanently out of step.
//
// The same bump covers an ELITE RE-FIT that the conversion forces. ELITE_PROFILES 3/4/5/6
// and 9 all move, so every elite transcript on those five raids changes. The old table put
// the Robots, the Aliens and the Video Games in one shared top BAND, because raid 9's
// ordinary fight measured 2.11-2.72 on the balance stick and there was no headroom above it
// to ramp into — and raid 9's own profile was kept deliberately tiny for the same reason,
// so a Brain Ticket there bought the brains rather than a different fight. That difficulty
// was the instant kill. With it gone the ordinary fight measures 1.33, and the five late
// invasions are re-fitted as a smooth RAMP in ladder order instead: Pirates 1.50, Ninjas
// 1.67, Robots 1.82, Aliens 2.04, Video Games 2.21. Each profile keeps its SHAPE — every
// multiplier's distance from 1.0 is scaled by one factor per raid — so no raid's character
// changes, only where it sits. See eliteInvasion.ts.
//
// Same cost as every bump: an invasion in flight at deploy time settles as stale_ruleset
// and pays nothing.
export const RAID_RULESET_VERSION = 31;
export const RAID_TICK_MS = 50;
export const RAID_MAX_TICKS = 4 * 60 * 1000 / RAID_TICK_MS;
export const RAID_MAX_INPUTS = 512;
export const RAID_MAX_TRANSCRIPT_BYTES = 32 * 1024;

export type RaidReplayInput =
  | { seq: number; tick: number; type: "bubble"; unitId: string }
  | { seq: number; tick: number; type: "ability"; abilityKey: string }
  | { seq: number; tick: number; type: "wallTap"; unitId: string }
  | { seq: number; tick: number; type: "fireTap"; unitId: string }
  | { seq: number; tick: number; type: "turnedTap"; unitId: string }
  | { seq: number; tick: number; type: "retreat" };

/** How far the server's replay had to depart from the client's account of the fight.
 *  Both counters are ZERO for a fight the two simulations agreed on; anything else is a
 *  divergence worth watching, which is how the ruleset-14 wall desync was caught. */
export interface ReplayDivergence {
  /** Ticks simulated BEYOND the client's `finalTick` to reach an outcome. */
  overrunTicks: number;
  /** Taps dropped because the server's fight had already ended when they arrived. */
  inputsAfterFinish: number;
  /** Well-formed taps the server's own sim REFUSED — its copy of that unit was in a
   *  different state than the player's. Dropped rather than fatal on the finish path
   *  (see `advanceRaidSegment`), and counted here so the desync stays queryable. */
  refusedInputs: number;
}

export type ReplayResult =
  | { ok: true; outcome: RaidOutcome; retreated: boolean; divergence: ReplayDivergence }
  | { ok: false; error: string };

export type SegmentResult =
  | { ok: true; snapshot: BattleSimSnapshot; finished: boolean; outcome?: RaidOutcome; retreated: boolean; lastSeq: number; divergence: ReplayDivergence }
  | { ok: false; error: string };

/** Advance an existing verifier snapshot. Input ticks/sequences remain global, while
 * only the new segment is simulated. A checkpoint never accepts retreat.
 *
 * `runToCompletion` is for the FINISH path only. Client-only hazards (the Circus
 * trapeze, the Beach crab) mean the player's fight and the server's are not the same
 * LENGTH, and transcript ticks are coordinates in the CLIENT's timeline. `finalTick`
 * therefore says when the player's fight ended, which is no reason to stop the server's
 * — but stopping there is what voided ~6% of all Circus/Beach victories. So the server
 * finishes its own fight, and a tap that arrives after it has done so is dropped rather
 * than fatal. Both effects are one-way self-harm: a dropped tap is help the server's
 * player never receives, and the overrun only ever runs the server's OWN deterministic
 * simulation to its own conclusion.
 *
 * A tap the sim REFUSES (`illegal_bubble` / `illegal_ability` / `illegal_wall_tap` /
 * `illegal_fire_tap` / `illegal_turned_tap`) is dropped the same way, for the same reason.
 * All five are the player HELPING their own army — releasing a charged zombie, spending an
 * activated move, chipping a wall, smothering a fire, breaking a converted zombie back
 * out — so a refusal is help the server's player never receives, and every consequence
 * lands on the
 * server's own outcome: a slower fight, fewer survivors, less reward. It cannot invent a
 * win. Holding them fatal instead cost 84 accounts their hazard-raid victories outright
 * (`clientWin` concedes losses only), which is a far worse answer than settling the
 * server's honest, un-helped fight. `refusedInputs` keeps the desync signal that caught
 * the ruleset-14 wall bug. Structurally malformed input (a non-string id, an unknown
 * type, a bad tick or sequence) remains fatal — that is a broken transcript, not a
 * disagreement about state. A checkpoint passes false: mid-fight segments stay exact. */
export function advanceRaidSegment(
  sim: BattleSim,
  startTick: number,
  finalTick: number,
  startingSeq: number,
  inputs: RaidReplayInput[],
  allowRetreat: boolean,
  runToCompletion = false
): SegmentResult {
  if (!Number.isInteger(startTick) || !Number.isInteger(finalTick) || finalTick < startTick || finalTick > RAID_MAX_TICKS) {
    return { ok: false, error: "bad_final_tick" };
  }
  if (!Array.isArray(inputs) || inputs.length > RAID_MAX_INPUTS) return { ok: false, error: "too_many_inputs" };
  if (JSON.stringify(inputs).length > RAID_MAX_TRANSCRIPT_BYTES) return { ok: false, error: "transcript_too_large" };
  let lastSeq = startingSeq;
  let lastTick = startTick;
  let sawRetreat = false;
  for (const input of inputs) {
    if (sawRetreat) return { ok: false, error: "input_after_retreat" };
    if (!input || !Number.isInteger(input.seq) || input.seq !== lastSeq + 1) return { ok: false, error: "bad_sequence" };
    if (input.seq > RAID_MAX_INPUTS) return { ok: false, error: "too_many_inputs" };
    if (!Number.isInteger(input.tick) || input.tick < lastTick || input.tick > finalTick) return { ok: false, error: "bad_input_tick" };
    if (startTick > 0 && input.tick <= startTick) return { ok: false, error: "bad_input_tick" };
    if (input.type === "retreat" && !allowRetreat) return { ok: false, error: "retreat_requires_finish" };
    if (input.type === "retreat") sawRetreat = true;
    lastSeq = input.seq;
    lastTick = input.tick;
  }
  let cursor = 0;
  let retreated = false;
  let inputsAfterFinish = 0;
  let refusedInputs = 0;
  /** A well-formed tap the sim would not take. Fatal mid-fight, dropped at the finish. */
  const refuse = (error: string): { ok: false; error: string } | null => {
    if (!runToCompletion) return { ok: false, error };
    refusedInputs++;
    return null;
  };
  for (let tick = startTick; tick <= finalTick; tick++) {
    while (cursor < inputs.length && inputs[cursor].tick === tick) {
      const input = inputs[cursor++];
      if (sim.finished) {
        // The server's fight ended before the player's did. A tap cannot change an
        // outcome that is already settled, so drop it instead of failing the finish.
        if (!runToCompletion) return { ok: false, error: "input_after_finish" };
        inputsAfterFinish++;
        continue;
      }
      if (input.type === "bubble") {
        if (typeof input.unitId !== "string") return { ok: false, error: "illegal_bubble" };
        if (!sim.popBubble(input.unitId)) {
          const fatal = refuse("illegal_bubble");
          if (fatal) return fatal;
        }
      } else if (input.type === "ability") {
        if (typeof input.abilityKey !== "string") return { ok: false, error: "illegal_ability" };
        if (!sim.activate(input.abilityKey)) {
          const fatal = refuse("illegal_ability");
          if (fatal) return fatal;
        }
      } else if (input.type === "wallTap") {
        // Only a live wall takes a tap, so this can neither reach a normal enemy nor
        // outrun the wall's own hit points: `tapWall` refuses everything else.
        if (typeof input.unitId !== "string") return { ok: false, error: "illegal_wall_tap" };
        if (!sim.tapWall(input.unitId)) {
          const fatal = refuse("illegal_wall_tap");
          if (fatal) return fatal;
        }
      } else if (input.type === "fireTap") {
        // Smothering a `pixelFire` burn. `tapFire` refuses anything that is not a live
        // player zombie actually alight, so this can neither reach another unit nor
        // extinguish a fire twice.
        if (typeof input.unitId !== "string") return { ok: false, error: "illegal_fire_tap" };
        if (!sim.tapFire(input.unitId)) {
          const fatal = refuse("illegal_fire_tap");
          if (fatal) return fatal;
        }
      } else if (input.type === "turnedTap") {
        // Chipping a converted pixel zombie. `tapTurned` refuses everything that is not a
        // live turned unit, so it cannot be aimed at an ordinary enemy or the boss.
        if (typeof input.unitId !== "string") return { ok: false, error: "illegal_turned_tap" };
        if (!sim.tapTurned(input.unitId)) {
          const fatal = refuse("illegal_turned_tap");
          if (fatal) return fatal;
        }
      } else if (input.type === "retreat") {
        retreated = true;
      } else return { ok: false, error: "bad_input_type" };
    }
    if (retreated || sim.finished || tick === finalTick) break;
    sim.step(RAID_TICK_MS);
  }
  // Breaking on `finished` above leaves every LATER tap unvisited. They are dropped for
  // the same reason as the ones the loop did see, so count them the same way.
  if (runToCompletion) inputsAfterFinish += inputs.length - cursor;
  // Past `finalTick` the transcript is exhausted (an input beyond it is `bad_input_tick`
  // above), so this is the server finishing its own unattended fight — no player help
  // reaches it. RAID_MAX_TICKS still caps it at four minutes, and `future_finish` still
  // bounds what the client may CLAIM about elapsed wall-clock time.
  let overrunTicks = 0;
  if (runToCompletion && !retreated && !sim.finished) {
    while (!sim.finished && finalTick + overrunTicks < RAID_MAX_TICKS) {
      sim.step(RAID_TICK_MS);
      overrunTicks++;
    }
  }
  return {
    ok: true,
    snapshot: sim.snapshot(),
    finished: sim.finished || retreated,
    outcome: sim.finished || retreated ? (retreated ? { ...sim.outcome(), win: false, survivors: [] } : sim.outcome()) : undefined,
    retreated,
    lastSeq,
    divergence: { overrunTicks, inputsAfterFinish, refusedInputs },
  };
}

/** Replay only outcome-relevant input against a server-built BattleSim. Rendering and
 * wall-clock frame cadence never enter this function. */
export function replayRaid(sim: BattleSim, finalTick: number, inputs: RaidReplayInput[]): ReplayResult {
  const advanced = advanceRaidSegment(sim, 0, finalTick, 0, inputs, true, true);
  if (!advanced.ok) return advanced;
  // Now only a genuine stalemate — neither side able to finish the other inside the
  // four-minute cap — leaves the replay without an outcome.
  if (!advanced.finished || !advanced.outcome) return { ok: false, error: "truncated_transcript" };
  return { ok: true, retreated: advanced.retreated, outcome: advanced.outcome, divergence: advanced.divergence };
}
