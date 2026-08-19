/** The player-facing half of the server's invasion session TTL.
 *
 *  `/raid/start` stamps `expires_at = now + 15 min` on WALL clock. The fight does not
 *  run on wall clock — it is driven by the Pixi ticker, so a backgrounded tab or a
 *  locked phone freezes the battle while the deadline keeps counting, which is how an
 *  honest player passes it without doing anything wrong.
 *
 *  Passing it no longer voids the fight: a late finish is replayed and paid like any
 *  other, as long as the session still holds its roster lock (see RAID_TTL_MS on the
 *  server). What the deadline now means to the player is narrower and more actionable —
 *  from here on, anything that makes the server re-read the account releases that lock
 *  and ends the fight for good: a reload, a resync, opening the farm on another device,
 *  or starting a different invasion. So the warnings say "finish it, and don't reload",
 *  which is advice they can act on, instead of "this is already worthless", which was
 *  both defeating and — once the TTL stopped gating rewards — untrue.
 *
 *  This module is the rule alone so it stays testable without a scene or a DOM. */

/** How much warning the player gets. Long enough to finish a fight that is already
 *  under way (invasions run ~1 minute of wall clock) without nagging during the
 *  first two thirds of a session that is in no danger. */
export const EXPIRY_WARNING_LEAD_MS = 3 * 60 * 1000;

export type InvasionExpiryState = "ok" | "expiring" | "expired";

/** Where a live session sits against its TTL. `expiresAt` is in the CLIENT's clock
 *  domain (translate the server's stamp with serverTimestampToClient first); null for
 *  an offline fight or a Worker too old to send one, which is always "ok" — inventing
 *  a deadline the server is not keeping would be worse than staying quiet. */
export function invasionExpiryState(expiresAt: number | null, now: number): InvasionExpiryState {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return "ok";
  if (now >= expiresAt) return "expired";
  if (now >= expiresAt - EXPIRY_WARNING_LEAD_MS) return "expiring";
  return "ok";
}

export const EXPIRED_MID_FIGHT_MESSAGE =
  "This invasion has outrun its 15-minute session. You can still finish it and be paid " +
  "in full — but reloading, or starting another invasion, will end it first.";

/** What to say on entering `state`, or null if that state needs nothing said. Only
 *  called on a TRANSITION (see the caller), so an unchanged state stays silent rather
 *  than repeating itself every frame. */
export function invasionExpiryMessage(state: InvasionExpiryState, remainingMs: number): string | null {
  if (state === "expired") return EXPIRED_MID_FIGHT_MESSAGE;
  if (state !== "expiring") return null;
  const mins = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Finish this invasion soon — its session ends in about ${mins} minute${mins === 1 ? "" : "s"}, ` +
    "after which reloading or starting another invasion would end the fight.";
}
