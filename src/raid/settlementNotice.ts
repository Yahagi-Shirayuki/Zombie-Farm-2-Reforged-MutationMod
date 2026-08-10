import type { RaidOutcome } from "./types";

/** What the player is told when the server's settlement disagrees with the fight they
 *  just watched. Kept out of the result panel itself so the RULE is testable without a
 *  DOM: the panel only renders whatever this returns. */
export const UNSETTLED_INVASION_NOTICE =
  "This invasion could not be settled — its session had already been closed, " +
  "so no rewards were granted. Your zombies all came home safely.";

export const UNSETTLED_INVASION_TOAST =
  "That invasion could not be settled and paid nothing. Your army is safe — " +
  "please report it if it happens again.";

/** The TTL case, told apart from the closed-session one because the player can DO
 *  something about it: an invasion left running in a hidden tab is the only way to
 *  reach it (the fight is rAF-driven and freezes with the page, while the server's
 *  15-minute session clock keeps running on wall time). Blaming an unexplained
 *  "could not be settled" for something the player can avoid is the wrong message. */
export const EXPIRED_INVASION_NOTICE =
  "This invasion ran past its 15-minute session, so the server could no longer settle " +
  "it and granted no rewards. Your zombies all came home safely — an invasion left " +
  "running in the background is what causes this.";

export const EXPIRED_INVASION_TOAST =
  "That invasion timed out before it was settled and paid nothing. Your army is safe — " +
  "invasions must be finished within 15 minutes of starting.";

export interface SettlementNotice {
  /** Persistent line shown on the result panel itself. */
  notice: string;
  /** Transient toast, for a player who closes the panel without reading it. */
  toast: string;
}

/** Does this settlement contradict the battle that was played?
 *
 *  `/raid/finish` answers 200 with the session's ALREADY-STORED result whenever the
 *  session was closed by something other than this fight — a boot-time abandon from a
 *  device that took over the writer, or a session that outlived its 15-minute TTL. The
 *  reward rows then patch to zero on a victory screen, which is exactly how this class
 *  of bug stayed invisible: no error, no rejection, no log line, just a win that paid
 *  nothing (see EconomyClient.recoverResumableRaid).
 *
 *  Only the win → loss direction counts. The reverse cannot happen (the server never
 *  upgrades a result), and a CONCEDED loss — where the client itself reported the
 *  defeat — is the settlement agreeing with the player, not contradicting them. */
export function isUnsettledInvasion(
  played: Pick<RaidOutcome, "win">,
  settled: Pick<RaidOutcome, "win"> | null | undefined
): boolean {
  return !!played.win && !!settled && !settled.win;
}

/** The whole "your victory paid nothing" rule, in one place.
 *
 *  The expired branch exists because the TTL settlement carries NO `outcome` at all —
 *  its stored body is `{expired, gold, xp, firstClear, loot}` and nothing more — so
 *  `isUnsettledInvasion` could never see it and the case this module was written for
 *  went out silently for weeks. Read `expired` directly rather than treating a missing
 *  outcome as suspicious: an older Worker also omits it, and accusing IT of eating a
 *  reward would be a lie. */
export function invasionSettlementNotice(
  played: Pick<RaidOutcome, "win">,
  settled: { expired?: boolean; outcome?: Pick<RaidOutcome, "win"> | null }
): SettlementNotice | null {
  // A defeat that pays nothing is a defeat behaving normally, whatever closed the
  // session — there is no contradiction to explain.
  if (!played.win) return null;
  if (settled.expired) {
    return { notice: EXPIRED_INVASION_NOTICE, toast: EXPIRED_INVASION_TOAST };
  }
  if (isUnsettledInvasion(played, settled.outcome)) {
    return { notice: UNSETTLED_INVASION_NOTICE, toast: UNSETTLED_INVASION_TOAST };
  }
  return null;
}
