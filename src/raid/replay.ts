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
export const RAID_RULESET_VERSION = 14;
export const RAID_TICK_MS = 50;
export const RAID_MAX_TICKS = 4 * 60 * 1000 / RAID_TICK_MS;
export const RAID_MAX_INPUTS = 512;
export const RAID_MAX_TRANSCRIPT_BYTES = 32 * 1024;

export type RaidReplayInput =
  | { seq: number; tick: number; type: "bubble"; unitId: string }
  | { seq: number; tick: number; type: "ability"; abilityKey: string }
  | { seq: number; tick: number; type: "wallTap"; unitId: string }
  | { seq: number; tick: number; type: "retreat" };

export type ReplayResult =
  | { ok: true; outcome: RaidOutcome; retreated: boolean }
  | { ok: false; error: string };

export type SegmentResult =
  | { ok: true; snapshot: BattleSimSnapshot; finished: boolean; outcome?: RaidOutcome; retreated: boolean; lastSeq: number }
  | { ok: false; error: string };

/** Advance an existing verifier snapshot. Input ticks/sequences remain global, while
 * only the new segment is simulated. A checkpoint never accepts retreat. */
export function advanceRaidSegment(
  sim: BattleSim,
  startTick: number,
  finalTick: number,
  startingSeq: number,
  inputs: RaidReplayInput[],
  allowRetreat: boolean
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
  for (let tick = startTick; tick <= finalTick; tick++) {
    while (cursor < inputs.length && inputs[cursor].tick === tick) {
      const input = inputs[cursor++];
      if (sim.finished) return { ok: false, error: "input_after_finish" };
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
  return {
    ok: true,
    snapshot: sim.snapshot(),
    finished: sim.finished || retreated,
    outcome: sim.finished || retreated ? (retreated ? { ...sim.outcome(), win: false, survivors: [] } : sim.outcome()) : undefined,
    retreated,
    lastSeq,
  };
}

/** Replay only outcome-relevant input against a server-built BattleSim. Rendering and
 * wall-clock frame cadence never enter this function. */
export function replayRaid(sim: BattleSim, finalTick: number, inputs: RaidReplayInput[]): ReplayResult {
  const advanced = advanceRaidSegment(sim, 0, finalTick, 0, inputs, true);
  if (!advanced.ok) return advanced;
  if (!advanced.finished || !advanced.outcome) return { ok: false, error: "truncated_transcript" };
  return { ok: true, retreated: advanced.retreated, outcome: advanced.outcome };
}
