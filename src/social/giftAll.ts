// ---------------------------------------------------------------------------
// "Gift all" cost model
// ---------------------------------------------------------------------------
// Sending to every friend at once is just N ordinary sends, so it obeys exactly
// the same rules the server enforces one at a time (server/src/db.ts): the first
// FREE_DAILY_GIFTS sends each UTC day are free and later ones cost GIFT_GOLD_COST
// gold. There is no ceiling on how many friends you may gift in a day — gold is the
// only thing that trims the batch. Which friends are ELIGIBLE (not gifted today, not
// still holding an unopened gift from you) is decided by the caller.
//
// This module exists so the confirmation dialog can quote a price BEFORE spending
// anything, and so that quote is unit-tested rather than assembled inline in the
// DOM code. It is a PREVIEW, never an authority: every send is still validated and
// charged server-side, and the summary the player sees afterwards is built from
// what the server actually reported.
import { FREE_DAILY_GIFTS, GIFT_GOLD_COST } from "../net/protocol";

export interface GiftAllPlan {
  /** Friend ids to send to, in order — already trimmed to the daily cap and budget. */
  targets: string[];
  /** How many of `targets` land inside today's free allowance. */
  freeCount: number;
  /** How many of `targets` are charged. */
  paidCount: number;
  /** Total gold this plan will spend. */
  goldCost: number;
  /** Eligible friends left out because there isn't gold for them. */
  skippedForGold: number;
}

export interface GiftAllInput {
  /** Friends who can still receive a gift today, in display order. */
  eligibleIds: string[];
  /** Gifts already sent today (any recipient). */
  sentToday: number;
  /** Gold on hand. */
  gold: number;
}

/** Work out who a single "Gift all" press would actually reach, and what it costs.
 *  Gold is the only thing that trims the batch, and the shortfall is reported so the
 *  dialog can explain WHY someone was left out rather than silently dropping them. */
export function planGiftAll({ eligibleIds, sentToday, gold }: GiftAllInput): GiftAllPlan {
  const alreadySent = Math.max(0, Math.floor(sentToday));
  const purse = Math.max(0, Math.floor(gold));

  // Free sends come off the front of the day, not the front of this batch: someone
  // who already sent both freebies pays for every gift in the plan.
  const freeLeft = Math.max(0, FREE_DAILY_GIFTS - alreadySent);
  const affordablePaid = GIFT_GOLD_COST > 0 ? Math.floor(purse / GIFT_GOLD_COST) : eligibleIds.length;
  const reach = Math.min(eligibleIds.length, freeLeft + affordablePaid);

  const targets = eligibleIds.slice(0, reach);
  const freeCount = Math.min(targets.length, freeLeft);
  const paidCount = targets.length - freeCount;

  return {
    targets,
    freeCount,
    paidCount,
    goldCost: paidCount * GIFT_GOLD_COST,
    skippedForGold: eligibleIds.length - targets.length,
  };
}
