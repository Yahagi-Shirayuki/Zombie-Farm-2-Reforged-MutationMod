// How hard a rescue hazard is to tap apart, by what the player is tapping WITH.
//
// The Trapeze Artist and the Beach crab are the two hazards you beat with your finger
// rather than with your army: they carry a zombie off the field and you break them open
// to get it back. The authored numbers are a touch interaction — `damageSelf_100` against
// 1000 HP with `tapDelay 0.25` between registered taps, i.e. ten taps at four a second.
//
// A mouse is not a finger, and the difference is not a matter of taste:
//
//  - A finger taps a phone about four times a second, which is exactly what the authored
//    0.25 s gate is built around. A mouse goes two to three times faster, so at the same
//    gate MOST of a player's clicks land inside the cooldown and are thrown away. That is
//    the "there is a delay before my clicks register — one to three clicks, depending on
//    how fast I'm clicking" report: the faster you click, the more of them vanish.
//  - Ten (later seven) deliberate mouse clicks per hazard, several hazards a fight, is
//    simply a lot of clicking for one rescue.
//
// So the mouse profile does two separate things, and it is worth keeping them separate:
// `hpScale` halves how many clicks a hazard COSTS, and `cooldownMs` makes sure the clicks
// the player actually makes are the ones that count. Neither is a difficulty change on
// touch, which keeps the authored values untouched.
//
// SAFE TO VARY BY DEVICE. Both hazards are client-only — the server verifier builds its
// sim with `grabberOf` returning null and no crab at all (see server/src/raidVerifier.ts),
// and neither hazard's taps are transcribed, so nothing here can make a replay disagree.
// Do NOT extend this to the boss wall or the converted pixel zombie: those ARE simulated
// and their taps ARE transcribed, so their cost is a rule, not a control.
import { isMobile } from "../platform";

export interface HazardTapProfile {
  /** Minimum gap between taps that register, in ms. */
  cooldownMs: number;
  /** Multiplier on a rescue hazard's authored HP — i.e. on how many taps it takes. */
  hpScale: number;
}

/** The authored interaction: `tapDelay 0.25`, full hazard HP. */
export const TOUCH_TAPS: HazardTapProfile = { cooldownMs: 250, hpScale: 1 };

/** Mouse: half the clicks, and a gate under a fast clicker's own interval (~8/s) so the
 *  clicks they make all land instead of being eaten by the touch-paced cooldown. */
export const MOUSE_TAPS: HazardTapProfile = { cooldownMs: 120, hpScale: 0.5 };

/** True when there is no device to ask — a headless import graph (tests, the server's
 *  shared modules). Such a context gets the authored touch values, so nothing
 *  device-dependent leaks into somewhere that has no device. */
const touchByDefault = (): boolean => typeof window === "undefined" || isMobile();

/** The profile for `mobile` (default: the current device). */
export function hazardTapProfile(mobile: boolean = touchByDefault()): HazardTapProfile {
  return mobile ? TOUCH_TAPS : MOUSE_TAPS;
}

/** Hazard HP for the current input device, from its authored (touch) value. */
export function rescueHazardHp(authoredHp: number, mobile: boolean = touchByDefault()): number {
  return Math.max(1, Math.round(authoredHp * hazardTapProfile(mobile).hpScale));
}
