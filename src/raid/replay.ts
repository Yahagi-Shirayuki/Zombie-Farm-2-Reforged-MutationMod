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
export const RAID_RULESET_VERSION = 17;
export const RAID_TICK_MS = 50;
export const RAID_MAX_TICKS = 4 * 60 * 1000 / RAID_TICK_MS;
export const RAID_MAX_INPUTS = 512;
export const RAID_MAX_TRANSCRIPT_BYTES = 32 * 1024;

export type RaidReplayInput =
  | { seq: number; tick: number; type: "bubble"; unitId: string }
  | { seq: number; tick: number; type: "ability"; abilityKey: string }
  | { seq: number; tick: number; type: "wallTap"; unitId: string }
  | { seq: number; tick: number; type: "retreat" };

/** How far the server's replay had to depart from the client's account of the fight.
 *  Both counters are ZERO for a fight the two simulations agreed on; anything else is a
 *  divergence worth watching, which is how the ruleset-14 wall desync was caught. */
export interface ReplayDivergence {
  /** Ticks simulated BEYOND the client's `finalTick` to reach an outcome. */
  overrunTicks: number;
  /** Taps dropped because the server's fight had already ended when they arrived. */
  inputsAfterFinish: number;
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
 * Deliberately NOT covered: a tap the sim REFUSES (`illegal_bubble` / `illegal_ability`
 * / `illegal_wall_tap`) stays fatal. Those address a unit in the wrong state rather than
 * a fight in the wrong phase, they are ~30x rarer in practice than the timing failures,
 * and they are the signal that caught the ruleset-14 wall desync. A checkpoint passes
 * false — mid-fight segments must stay exact. */
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
        if (typeof input.unitId !== "string" || !sim.popBubble(input.unitId)) return { ok: false, error: "illegal_bubble" };
      } else if (input.type === "ability") {
        if (typeof input.abilityKey !== "string" || !sim.activate(input.abilityKey)) return { ok: false, error: "illegal_ability" };
      } else if (input.type === "wallTap") {
        // Only a live wall takes a tap, so this can neither reach a normal enemy nor
        // outrun the wall's own hit points: `tapWall` refuses everything else.
        if (typeof input.unitId !== "string" || !sim.tapWall(input.unitId)) return { ok: false, error: "illegal_wall_tap" };
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
    divergence: { overrunTicks, inputsAfterFinish },
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
