/** The player-facing half of the server's invasion session TTL.
 *
 *  `/raid/start` stamps `expires_at = now + 15 min` on WALL clock, and `/raid/finish`
 *  zeroes anything settled after it ? no replay, no rewards, whatever the fight did.
 *  The fight itself does not run on wall clock: it is driven by the Pixi ticker, so a
 *  backgrounded tab freezes it while the TTL keeps counting. That mismatch is the only
 *  way an honest win reaches the expired branch, and until now nothing on the client
 *  even read the `expiresAt` that /raid/start has always returned.
 *
 *  This module is the rule alone so it stays testable without a scene or a DOM. */

/** How much warning the player gets. Long enough to finish a fight that is already
 *  under way (invasions run ~1 minute of wall clock) without nagging during the
 *  first two thirds of a session that is in no danger. */
export const EXPIRY_WARNING_LEAD_MS = 3 * 60 * 1000;

export type InvasionExpiryState = "ok" | "expiring" | "expired";

/** Where a live session sits against its TTL. `expiresAt` is in the CLIENT's clock
 *  domain (translate the server's stamp with serverTimestampToClient first); null for
 *  an offline fight or a Worker too old to send one, which is always "ok" ? inventing
 *  a deadline the server is not keeping would be worse than staying quiet. */
export function invasionExpiryState(expiresAt: number | null, now: number): InvasionExpiryState {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return "ok";
  if (now >= expiresAt) return "expired";
  if (now >= expiresAt - EXPIRY_WARNING_LEAD_MS) return "expiring";
  return "ok";
}

export const EXPIRED_MID_FIGHT_MESSAGE =
  "This invasion's 15-minute session has ended, so it can no longer be rewarded. " +
  "Your zombies are safe ? invasions left running in the background time out.";

/** What to say on entering `state`, or null if that state needs nothing said. Only
 *  called on a TRANSITION (see the caller), so an unchanged state stays silent rather
 *  than repeating itself every frame. */
export function invasionExpiryMessage(state: InvasionExpiryState, remainingMs: number): string | null {
  if (state === "expired") return EXPIRED_MID_FIGHT_MESSAGE;
  if (state !== "expiring") return null;
  const mins = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Finish this invasion soon ? its session ends in about ${mins} minute${mins === 1 ? "" : "s"}, ` +
    "and a fight settled after that pays nothing.";
}
