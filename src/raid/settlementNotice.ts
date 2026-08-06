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
