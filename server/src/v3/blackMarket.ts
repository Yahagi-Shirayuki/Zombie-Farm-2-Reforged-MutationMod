import type {
  BlackMarketCollectResponse,
  BlackMarketFulfillmentsResponse,
  BlackMarketFulfillmentView,
  BlackMarketHistoryEntry,
  BlackMarketHistoryResponse,
  BlackMarketListResponse,
  BlackMarketMutationResponse,
  BlackMarketOrderKind,
  BlackMarketOrderView,
  BlackMarketSummary,
  BlackMarketTradeStats,
  ClaimedUnit,
} from "../../../src/net/protocol";
import objectRows from "../../../public/assets/placeables.json";
import { SLOTS, SLOT_MASK } from "../../../src/zombie/mutations";
import { REQUESTABLE_MUTATION_MASK } from "../../../src/blackMarketRules";
import { levelForXp, XP_THRESHOLDS } from "../levels";
import {
  blackMarketFilterKeys,
  blackMarketPurchaseRequirement,
  isTradableZombie,
  type BlackMarketPurchaseRequirement,
} from "../rosterCatalog";

const ACTIVE_LIMIT = 10 as const;
const DAILY_LIMIT = 50 as const;
const MAX_PRICE = 1_000_000;
const PAGE_SIZE = 30;

const placedObjectCases = (field: "armyMax" | "zombieSlots") =>
  (objectRows as Array<{ key: string; armyMax?: number; zombieSlots?: number }>)
    .filter((object) => Number.isSafeInteger(object[field]) && (object[field] ?? 0) > 0)
    .map((object) => `WHEN '${object.key.replaceAll("'", "''")}' THEN ${object[field]}`)
    .join(" ");

const placedObjects = `FROM object_documents_v3 documents, json_each(documents.current_json) entry
  WHERE documents.account_id=? AND json_extract(entry.value,'$.status')='placed'`;

/** Deployed units the army cap limits. A unit reserved in a Zombie Pot is already
 *  `stored`, so it never counts here. */
const ACTIVE_UNITS = "(SELECT COUNT(*) FROM roster_v3 WHERE account_id=? AND stored=0)";
/** Mausoleum occupants. Pot reservations are deliberately excluded: they are flagged
 *  `stored` purely to free their army slot, the client hides them, and counting them
 *  would make the crypt read full to the server and roomy to the player (see the
 *  `reservedInPot` note in engine.ts). */
const CRYPT_UNITS = `(SELECT COUNT(*) FROM roster_v3 WHERE account_id=? AND stored=1
  AND (locked_by_raid IS NULL OR locked_by_raid NOT LIKE 'pot:%'))`;
/** zombieMax plus every placed object that raises it (Zombie Monolith). */
const ARMY_CAP = `(COALESCE((SELECT CAST(json_extract(current_json,'$.zombieMax') AS INTEGER)
    FROM gameplay_documents_v3 WHERE account_id=?),16) +
  COALESCE((SELECT SUM(CASE json_extract(entry.value,'$.catalogKey')
    ${placedObjectCases("armyMax")} ELSE 0 END) ${placedObjects}),0))`;
/** Storage slots of the placed Mausoleum, by tier. ZERO with none placed — the case
 *  that made a purchase disappear into a crypt the player does not own. */
const CRYPT_CAP = `COALESCE((SELECT MAX(CASE json_extract(entry.value,'$.catalogKey')
    ${placedObjectCases("zombieSlots")} ELSE 0 END) ${placedObjects}),0)`;

/** Where a claimed zombie lands: the army first, the Mausoleum once it is full.
 *  Binds: active-count, zombieMax, army-objects. */
const claimDestinationSql = `CASE WHEN ${ACTIVE_UNITS} >= ${ARMY_CAP} THEN 1 ELSE 0 END`;
const claimDestinationBinds = (accountId: string) => [accountId, accountId, accountId];

/** True while EITHER destination has a free slot. Evaluated inside the mutating batch
 *  so two simultaneous deliveries observe occupancy in transaction order instead of
 *  both claiming the same last slot. Binds: active, zombieMax, army-objects, crypt
 *  count, crypt objects. */
const hasRoomSql = `(${ACTIVE_UNITS} < ${ARMY_CAP} OR ${CRYPT_UNITS} < ${CRYPT_CAP})`;
const hasRoomBinds = (accountId: string) =>
  [accountId, accountId, accountId, accountId, accountId];

interface OrderRow {
  id: string;
  creator_account_id: string;
  creator_name: string | null;
  kind: BlackMarketOrderKind;
  zombie_key: string;
  mutated_required: number;
  mutation_required: number | null;
  price_brains: number;
  status: "OPEN" | "FULFILLED" | "CANCELLED";
  created_at: number;
  escrow_mutation: number | null;
  escrow_invasions: number | null;
  // Present on every `SELECT o.*`; the traded unit as stamped at settlement, and
  // whether the recipient has taken delivery of it yet (migrations 0033 / 0040).
  delivered_mutation?: number | null;
  delivered_invasions?: number | null;
  claimed_at?: number | null;
}

interface ReceiptRow { request_fingerprint: string; order_id: string }
interface RuntimeRow { account_version: number; active_batch_id: string | null }

export type MarketFailure = {
  status: 400 | 403 | 404 | 409;
  error: string;
};

const dayBucket = (now: number): number => Math.floor(now / 86_400_000);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const validPrice = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_PRICE;
// REQUESTABLE_MUTATION_MASK is shared with the compose form (see blackMarketRules):
// the stored column's CHECK caps it at the 13 bits that existed in migration 0030, so
// a bit added later (Pumpking) is rejected here as a clean 400 rather than failing the
// D1 INSERT. Widening the CHECK needs a table rebuild, which would cascade-delete
// black_market_receipts — deliberately deferred.
const validMutationRequirement = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) > 0 &&
    (Number(value) & ~REQUESTABLE_MUTATION_MASK) === 0);
export const matchesMutationRequirement = (
  mutation: number,
  mutated: number,
  mutationRequired: number | null
): boolean => {
  if (mutationRequired === null) return (mutation !== 0) === !!mutated;
  return SLOTS.every((slot) => {
    const requestedInSlot = mutationRequired & SLOT_MASK[slot];
    return requestedInSlot === 0 || (mutation & requestedInSlot) !== 0;
  });
};
const mutationRequirementSql = (mutationRequired: number | null): {
  sql: string;
  binds: number[];
} => {
  if (mutationRequired === null) return { sql: "(mutation!=0)=?", binds: [] };
  const slotMasks = SLOTS
    .map((slot) => mutationRequired & SLOT_MASK[slot])
    .filter((mask) => mask !== 0);
  return {
    sql: slotMasks.map(() => "(mutation & ?) != 0").join(" AND "),
    binds: slotMasks,
  };
};

async function purchaseRequirementFailure(
  db: D1Database,
  accountId: string,
  zombieKey: string
): Promise<MarketFailure | null> {
  const requirement = blackMarketPurchaseRequirement(zombieKey);
  if (!requirement) return { status: 400, error: "bad_zombie_request" };
  if (requirement.minLevel) {
    const balance = await db.prepare("SELECT xp FROM balances WHERE account_id=?")
      .bind(accountId).first<{ xp: number }>();
    if (!balance || levelForXp(balance.xp) < requirement.minLevel) {
      return { status: 403, error: "black_market_level_locked" };
    }
  }
  return null;
}

function purchaseRequirementGuard(
  accountId: string,
  requirement: BlackMarketPurchaseRequirement
): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (requirement.minLevel) {
    clauses.push("EXISTS(SELECT 1 FROM balances WHERE account_id=? AND xp>=?)");
    binds.push(accountId, XP_THRESHOLDS[requirement.minLevel - 1] ?? Number.MAX_SAFE_INTEGER);
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "1=1", binds };
}

const toView = (row: OrderRow, accountId: string): BlackMarketOrderView => ({
  id: row.id,
  kind: row.kind,
  zombieKey: row.zombie_key,
  mutated: !!row.mutated_required,
  ...(row.kind === "BUY_ZOMBIE" && row.mutation_required !== null
    ? { mutationRequired: row.mutation_required }
    : {}),
  ...(row.kind === "SELL_ZOMBIE" && row.escrow_mutation !== null
    ? { mutation: row.escrow_mutation, invasions: row.escrow_invasions ?? 0 }
    : {}),
  priceBrains: row.price_brains,
  status: row.status,
  createdAt: row.created_at,
  creatorName: row.creator_name ?? "Player",
  mine: row.creator_account_id === accountId,
});

async function orderRow(db: D1Database, id: string): Promise<OrderRow | null> {
  return db.prepare(`SELECT o.*, a.username AS creator_name FROM black_market_orders o
    JOIN accounts a ON a.id=o.creator_account_id WHERE o.id=?`).bind(id).first<OrderRow>();
}

export async function summary(db: D1Database, accountId: string, now: number): Promise<BlackMarketSummary> {
  const [active, daily] = await Promise.all([
    db.prepare("SELECT COUNT(*) n FROM black_market_orders WHERE creator_account_id=? AND status='OPEN'")
      .bind(accountId).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) n FROM black_market_orders WHERE creator_account_id=? AND created_day=?")
      .bind(accountId, dayBucket(now)).first<{ n: number }>(),
  ]);
  return {
    activePosts: active?.n ?? 0,
    postsToday: daily?.n ?? 0,
    activeLimit: ACTIVE_LIMIT,
    dailyLimit: DAILY_LIMIT,
    serverTime: now,
  };
}

export async function list(
  db: D1Database,
  accountId: string,
  query: {
    kind?: string; zombieClass?: string; zombieGroup?: string;
    zombieKey?: string; mutated?: string; sort?: string; mine?: string; cursor?: string;
  },
  now: number
): Promise<BlackMarketListResponse> {
  const kind: BlackMarketOrderKind = query.kind === "BUY_ZOMBIE" ? "BUY_ZOMBIE" : "SELL_ZOMBIE";
  const where = ["o.status='OPEN'", "o.kind=?"];
  const binds: unknown[] = [kind];
  // The toolbar's two dropdowns. A bucket can span dozens of keys, so the list is
  // inlined rather than bound — D1 caps bound parameters per query, and these are
  // catalog constants, never request text (blackMarketFilterKeys resolves a bucket
  // NAME, and the guard below re-checks the shape of what it returned).
  const filterKeys = blackMarketFilterKeys(query.zombieClass, query.zombieGroup);
  if (filterKeys) {
    const safe = filterKeys.filter((key) => /^[A-Za-z0-9_]+$/.test(key));
    where.push(safe.length ? `o.zombie_key IN (${safe.map((key) => `'${key}'`).join(",")})` : "0=1");
  }
  // Retained for clients still on the older per-type / mutated-yes-no toolbar.
  if (query.zombieKey && isTradableZombie(query.zombieKey)) {
    where.push("o.zombie_key=?"); binds.push(query.zombieKey);
  }
  if (query.mutated === "true" || query.mutated === "false") {
    where.push("o.mutated_required=?"); binds.push(query.mutated === "true" ? 1 : 0);
  }
  if (query.mine === "true") { where.push("o.creator_account_id=?"); binds.push(accountId); }
  const offset = Math.max(0, Math.min(10_000, Number.parseInt(query.cursor ?? "0", 10) || 0));
  const order = query.sort === "price_asc" ? "o.price_brains ASC, o.created_at DESC, o.id" :
    query.sort === "price_desc" ? "o.price_brains DESC, o.created_at DESC, o.id" :
      "o.created_at DESC, o.id";
  const result = await db.prepare(`SELECT o.*, a.username AS creator_name FROM black_market_orders o
    JOIN accounts a ON a.id=o.creator_account_id WHERE ${where.join(" AND ")}
    ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, PAGE_SIZE + 1, offset).all<OrderRow>();
  const rows = result.results ?? [];
  return {
    orders: rows.slice(0, PAGE_SIZE).map((row) => toView(row, accountId)),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
    summary: await summary(db, accountId, now),
  };
}

const FULFILLMENT_PAGE = 50;

interface FulfillmentRow {
  id: string;
  kind: BlackMarketOrderKind;
  zombie_key: string;
  mutated_required: number;
  price_brains: number;
  created_at: number;
  closed_at: number;
  escrow_mutation: number | null;
  escrow_invasions: number | null;
  delivered_mutation: number | null;
  delivered_invasions: number | null;
  creator_account_id: string;
  claimed_at: number | null;
  fulfilled_by_name: string | null;
  creator_name: string | null;
}

/** The caller's settled-but-uncollected orders, newest first. Settlement has already
 * happened for all of these; they exist so each side finally hears about it — and, for
 * whoever the trade owes a zombie, so they have somewhere to take delivery.
 *
 * Both sides of a sale can hold a card for the same order at once: the seller's says
 * the brains arrived (`acknowledged_at`), the buyer's still owes them the zombie
 * (`claimed_at`). The two flags are independent, so one collecting never hides the
 * other's card. */
export async function fulfillments(
  db: D1Database,
  accountId: string
): Promise<BlackMarketFulfillmentsResponse> {
  const result = await db.prepare(`SELECT o.id,o.kind,o.zombie_key,o.mutated_required,o.price_brains,
      o.created_at,o.closed_at,o.escrow_mutation,o.escrow_invasions,
      o.delivered_mutation,o.delivered_invasions,o.creator_account_id,o.claimed_at,
      a.username AS fulfilled_by_name, ca.username AS creator_name
    FROM black_market_orders o
    LEFT JOIN accounts a ON a.id=o.fulfilled_by_account_id
    JOIN accounts ca ON ca.id=o.creator_account_id
    WHERE o.status='FULFILLED' AND (
      (o.creator_account_id=?1 AND o.acknowledged_at IS NULL)
      OR (o.claimed_at IS NULL AND ?1 = CASE o.kind
            WHEN 'SELL_ZOMBIE' THEN o.fulfilled_by_account_id ELSE o.creator_account_id END))
    ORDER BY o.closed_at DESC LIMIT ?2`).bind(accountId, FULFILLMENT_PAGE).all<FulfillmentRow>();
  const views: BlackMarketFulfillmentView[] = (result.results ?? []).map((row) => {
    // The traded unit, whichever direction it moved: a sale's escrowed zombie or the
    // unit the fulfiller handed over for a request. Both are stamped on the order at
    // settlement (migration 0033); the escrow fallback covers sales fulfilled before
    // that column existed, and a request that old simply has no unit to describe.
    const mutation = row.delivered_mutation ??
      (row.kind === "SELL_ZOMBIE" ? row.escrow_mutation : null);
    const invasions = row.delivered_invasions ??
      (row.kind === "SELL_ZOMBIE" ? row.escrow_invasions : null);
    const mine = row.creator_account_id === accountId;
    // A sale's buyer is its fulfiller, so "who completed the trade" is the wrong name
    // to show them — every card names the player on the OTHER side.
    const counterparty = (mine ? row.fulfilled_by_name : row.creator_name) ?? "Player";
    return {
      id: row.id,
      kind: row.kind,
      zombieKey: row.zombie_key,
      mutated: !!row.mutated_required,
      ...(mutation !== null ? { mutation, invasions: invasions ?? 0 } : {}),
      priceBrains: row.price_brains,
      createdAt: row.created_at,
      fulfilledAt: row.closed_at,
      fulfilledBy: counterparty,
      ...(row.claimed_at === null && (row.kind === "SELL_ZOMBIE") !== mine
        ? { awaitingClaim: true }
        : {}),
    };
  });
  return { fulfillments: views };
}

/** Who the traded zombie belongs to once the order settles: the fulfiller bought it
 *  on a sale, the creator requested it on a buy. */
const recipientOf = (row: Pick<OrderRow, "kind" | "creator_account_id"> & {
  fulfilled_by_account_id?: string | null;
}): string | null =>
  row.kind === "SELL_ZOMBIE" ? row.fulfilled_by_account_id ?? null : row.creator_account_id;

/** Does this account have a free army slot or a free Mausoleum slot? Read outside the
 *  mutating batch to turn "nowhere to put it" into a precise error; the same condition
 *  is re-asserted inside the batch (`hasRoomSql`) so the answer cannot go stale. */
async function hasDeliveryRoom(db: D1Database, accountId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT ${hasRoomSql} AS room`)
    .bind(...hasRoomBinds(accountId)).first<{ room: number }>();
  return !!row?.room;
}

/** Mint a settled trade's zombie into the recipient's roster, army slot first and
 *  Mausoleum second. Idempotent on `claimed_at`, and refused outright when neither
 *  destination has room — the unit keeps waiting on the order instead of being flagged
 *  `stored` into a crypt the player may not own. */
async function claimDelivery(
  db: D1Database,
  accountId: string,
  row: OrderRow & { fulfilled_by_account_id: string | null },
  now: number
): Promise<{ unit: ClaimedUnit } | MarketFailure> {
  if (!await hasDeliveryRoom(db, accountId)) return { status: 409, error: "no_room" };
  const unitId = crypto.randomUUID();
  const mutation = row.delivered_mutation ?? row.escrow_mutation ?? 0;
  const invasions = row.delivered_invasions ?? row.escrow_invasions ?? 0;
  // The `/black-market/*` writer middleware opens this caller's operation lease for
  // the life of the request, so requiring it here is what fences the claim against a
  // second device — the same guard every other market mutation uses.
  const claim = db.prepare(`UPDATE black_market_orders SET claimed_at=?,delivered_unit_id=?
    WHERE id=? AND status='FULFILLED' AND claimed_at IS NULL AND ${hasRoomSql}
      AND EXISTS(SELECT 1 FROM account_runtime_v3 WHERE account_id=? AND active_batch_id IS NOT NULL)`)
    .bind(now, unitId, row.id, ...hasRoomBinds(accountId), accountId);
  const guard = "EXISTS(SELECT 1 FROM black_market_orders WHERE id=? AND delivered_unit_id=?)";
  const committed = await db.batch([
    claim,
    db.prepare(`INSERT INTO roster_v3(account_id,unit_id,zombie_key,mutation,invasions,stored,created_at)
      SELECT ?,?,?,?,?,${claimDestinationSql},? WHERE ${guard}`)
      .bind(accountId, unitId, row.zombie_key, mutation, invasions,
        ...claimDestinationBinds(accountId), now, row.id, unitId),
    db.prepare(`UPDATE account_runtime_v3 SET account_version=account_version+1,updated_at=?
      WHERE account_id=? AND ${guard}`).bind(now, accountId, row.id, unitId),
    db.prepare(`INSERT INTO audit_events_v3(id,account_id,kind,detail_json,created_at)
      SELECT ?,?,'black_market_claim',?,? WHERE ${guard}`)
      .bind(`${accountId}:claim:${unitId}`, accountId,
        JSON.stringify({ orderId: row.id, zombieKey: row.zombie_key, unitId }), now, row.id, unitId),
  ]);
  if ((committed[0]?.meta.changes ?? 0) !== 1) return { status: 409, error: "claim_conflict" };
  const stored = await db.prepare("SELECT stored FROM roster_v3 WHERE account_id=? AND unit_id=?")
    .bind(accountId, unitId).first<{ stored: number }>();
  return { unit: { unitId, zombieKey: row.zombie_key, mutation, invasions, stored: !!stored?.stored } };
}

/** Collect one settled order: take delivery of the zombie it owes this account (if
 * any), then acknowledge it so it stops surfacing as uncollected.
 *
 * The claim runs FIRST and its failure aborts the whole thing — acknowledging an order
 * whose zombie could not land would dismiss the only card that can still deliver it.
 *
 * It also echoes the current balance. The brains were credited at settlement, by the
 * other player's fulfil — an event this account's client never saw — so collecting is
 * the moment it must learn the new total. Reading it here costs one extra SELECT and
 * saves the client a whole second round-trip. */
export async function collect(
  db: D1Database,
  accountId: string,
  orderId: string,
  now: number
): Promise<BlackMarketCollectResponse | MarketFailure> {
  if (!validId(orderId)) return { status: 400, error: "bad_market_collect" };
  const row = await db.prepare(`SELECT o.*, a.username AS creator_name FROM black_market_orders o
    JOIN accounts a ON a.id=o.creator_account_id WHERE o.id=?`).bind(orderId)
    .first<OrderRow & { fulfilled_by_account_id: string | null; claimed_at: number | null }>();
  if (!row) return { status: 404, error: "order_not_found" };
  const isCreator = row.creator_account_id === accountId;
  const owedZombie = recipientOf(row) === accountId && row.claimed_at === null;
  if (!isCreator && !owedZombie) return { status: 403, error: "not_order_owner" };
  if (row.status !== "FULFILLED") return { status: 409, error: "order_not_fulfilled" };

  let claimed: ClaimedUnit | undefined;
  if (owedZombie) {
    const result = await claimDelivery(db, accountId, row, now);
    if (!("unit" in result)) return result;
    claimed = result.unit;
  }
  const acknowledged = isCreator
    ? await db.prepare(`UPDATE black_market_orders SET acknowledged_at=?
        WHERE id=? AND creator_account_id=? AND status='FULFILLED' AND acknowledged_at IS NULL`)
      .bind(now, orderId, accountId).run()
    : null;
  return {
    ok: true,
    // "Already collected" only describes the acknowledgment. A claim that just landed
    // is news either way, so a fresh delivery never reports as a repeat.
    alreadyCollected: !claimed && (acknowledged?.meta.changes ?? 0) !== 1,
    ...(claimed ? { claimed } : {}),
    ...await balanceEcho(db, accountId),
  };
}

/** `{ balance }` for the account, or `{}` if the row is somehow missing — an absent
 *  balance is the same "older Worker" shape the client already tolerates. */
async function balanceEcho(
  db: D1Database,
  accountId: string
): Promise<{ balance?: { gold: number; brains: number; xp: number } }> {
  const balance = await db.prepare("SELECT gold, brains, xp FROM balances WHERE account_id=?")
    .bind(accountId).first<{ gold: number; brains: number; xp: number }>();
  return balance ? { balance } : {};
}

const HISTORY_PAGE = 100;

// A completed trade always has one brain-earning side and one brain-spending
// side. Which account sits on which side depends on the order kind: a sale's
// creator earns and its fulfiller spends; a request's creator spends and its
// fulfiller earns.
const EARNED_SIDE_SQL = `status='FULFILLED' AND
  ((kind='SELL_ZOMBIE' AND creator_account_id=?1) OR (kind='BUY_ZOMBIE' AND fulfilled_by_account_id=?1))`;
const SPENT_SIDE_SQL = `status='FULFILLED' AND
  ((kind='SELL_ZOMBIE' AND fulfilled_by_account_id=?1) OR (kind='BUY_ZOMBIE' AND creator_account_id=?1))`;

interface HistoryRow {
  id: string;
  kind: BlackMarketOrderKind;
  zombie_key: string;
  price_brains: number;
  closed_at: number;
  delivered_mutation: number | null;
  delivered_invasions: number | null;
  creator_account_id: string;
  creator_name: string | null;
  fulfiller_name: string | null;
}

/** The caller's completed trades (both roles), newest first, plus lifetime
 * aggregates computed over the full set — not just the returned page. */
export async function history(
  db: D1Database,
  accountId: string
): Promise<BlackMarketHistoryResponse> {
  const [entries, earnedTotals, bestSale, spentTotals, mostTraded] = await Promise.all([
    db.prepare(`SELECT o.id,o.kind,o.zombie_key,o.price_brains,o.closed_at,
        o.delivered_mutation,o.delivered_invasions,o.creator_account_id,
        ca.username AS creator_name, fa.username AS fulfiller_name
      FROM black_market_orders o
      JOIN accounts ca ON ca.id=o.creator_account_id
      LEFT JOIN accounts fa ON fa.id=o.fulfilled_by_account_id
      WHERE o.status='FULFILLED' AND (o.creator_account_id=?1 OR o.fulfilled_by_account_id=?1)
      ORDER BY o.closed_at DESC, o.id LIMIT ${HISTORY_PAGE}`)
      .bind(accountId).all<HistoryRow>(),
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(price_brains),0) brains
      FROM black_market_orders WHERE ${EARNED_SIDE_SQL}`)
      .bind(accountId).first<{ n: number; brains: number }>(),
    db.prepare(`SELECT zombie_key, price_brains, delivered_mutation
      FROM black_market_orders WHERE ${EARNED_SIDE_SQL}
      ORDER BY price_brains DESC, closed_at DESC LIMIT 1`)
      .bind(accountId).first<{ zombie_key: string; price_brains: number; delivered_mutation: number | null }>(),
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(price_brains),0) brains
      FROM black_market_orders WHERE ${SPENT_SIDE_SQL}`)
      .bind(accountId).first<{ n: number; brains: number }>(),
    db.prepare(`SELECT zombie_key, COUNT(*) n FROM black_market_orders
      WHERE status='FULFILLED' AND (creator_account_id=?1 OR fulfilled_by_account_id=?1)
      GROUP BY zombie_key ORDER BY n DESC, zombie_key LIMIT 1`)
      .bind(accountId).first<{ zombie_key: string; n: number }>(),
  ]);
  const stats: BlackMarketTradeStats = {
    sold: {
      count: earnedTotals?.n ?? 0,
      brains: earnedTotals?.brains ?? 0,
      best: bestSale
        ? { zombieKey: bestSale.zombie_key, priceBrains: bestSale.price_brains, mutation: bestSale.delivered_mutation }
        : null,
    },
    bought: { count: spentTotals?.n ?? 0, brains: spentTotals?.brains ?? 0 },
    mostTraded: mostTraded ? { zombieKey: mostTraded.zombie_key, count: mostTraded.n } : null,
  };
  const views: BlackMarketHistoryEntry[] = (entries.results ?? []).map((row) => {
    const mine = row.creator_account_id === accountId;
    return {
      id: row.id,
      kind: row.kind,
      mine,
      earned: (row.kind === "SELL_ZOMBIE") === mine,
      zombieKey: row.zombie_key,
      mutation: row.delivered_mutation,
      invasions: row.delivered_invasions ?? 0,
      priceBrains: row.price_brains,
      counterparty: (mine ? row.fulfiller_name : row.creator_name) ?? "Player",
      fulfilledAt: row.closed_at,
    };
  });
  return { stats, entries: views };
}

const fingerprint = (action: string, input: Record<string, unknown>): string =>
  JSON.stringify([action, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))]);

async function replay(
  db: D1Database,
  accountId: string,
  operationId: string,
  expectedFingerprint: string,
  now: number
): Promise<BlackMarketMutationResponse | MarketFailure | null> {
  const receipt = await db.prepare("SELECT request_fingerprint,order_id FROM black_market_receipts WHERE operation_id=? AND account_id=?")
    .bind(operationId, accountId).first<ReceiptRow>();
  if (!receipt) return null;
  if (receipt.request_fingerprint !== expectedFingerprint) return { status: 409, error: "operation_mismatch" };
  const row = await orderRow(db, receipt.order_id);
  if (!row) return { status: 404, error: "order_not_found" };
  return { ok: true, order: toView(row, accountId), summary: await summary(db, accountId, now) };
}

const response = async (db: D1Database, accountId: string, id: string, now: number): Promise<BlackMarketMutationResponse> => {
  const row = await orderRow(db, id);
  if (!row) throw new Error("black_market_order_missing_after_commit");
  return { ok: true, order: toView(row, accountId), summary: await summary(db, accountId, now) };
};

export async function create(
  db: D1Database,
  accountId: string,
  body: Record<string, unknown>,
  now: number
): Promise<BlackMarketMutationResponse | MarketFailure> {
  const operationId = body.operationId;
  const expectedVersion = body.expectedAccountVersion;
  const kind = body.kind;
  if (!validId(operationId) || !Number.isSafeInteger(expectedVersion) ||
      (kind !== "BUY_ZOMBIE" && kind !== "SELL_ZOMBIE") || !validPrice(body.priceBrains)) {
    return { status: 400, error: "bad_market_order" };
  }
  const input = kind === "SELL_ZOMBIE"
    ? { kind, unitId: body.unitId, priceBrains: body.priceBrains }
    : {
        kind,
        zombieKey: body.zombieKey,
        mutated: body.mutated,
        mutationRequired: body.mutationRequired ?? null,
        priceBrains: body.priceBrains,
      };
  const fp = fingerprint("CREATE", input);
  const prior = await replay(db, accountId, operationId, fp, now);
  if (prior) return prior;

  const runtime = await db.prepare("SELECT account_version,active_batch_id FROM account_runtime_v3 WHERE account_id=?")
    .bind(accountId).first<RuntimeRow>();
  if (!runtime || runtime.account_version !== expectedVersion) return { status: 409, error: "state_conflict" };
  if (!runtime.active_batch_id) return { status: 409, error: "operation_in_progress" };
  const counts = await summary(db, accountId, now);
  if (counts.activePosts >= ACTIVE_LIMIT) return { status: 409, error: "active_post_limit" };
  if (counts.postsToday >= DAILY_LIMIT) return { status: 409, error: "daily_post_limit" };

  let zombieKey: string;
  let mutated = 0;
  let mutationRequired: number | null = null;
  let mutation: number | null = null;
  let invasions: number | null = null;
  let unitId: string | null = null;
  if (kind === "SELL_ZOMBIE") {
    if (!validId(body.unitId)) return { status: 400, error: "bad_unit" };
    const unit = await db.prepare(`SELECT zombie_key,mutation,invasions FROM roster_v3
      WHERE account_id=? AND unit_id=? AND locked_by_raid IS NULL`).bind(accountId, body.unitId)
      .first<{ zombie_key: string; mutation: number; invasions: number }>();
    if (!unit) return { status: 409, error: "zombie_unavailable" };
    if (!isTradableZombie(unit.zombie_key)) return { status: 403, error: "zombie_not_tradable" };
    zombieKey = unit.zombie_key; mutation = unit.mutation; invasions = unit.invasions;
    mutated = unit.mutation !== 0 ? 1 : 0; unitId = body.unitId;
  } else {
    if (typeof body.zombieKey !== "string" || typeof body.mutated !== "boolean" ||
        !validMutationRequirement(body.mutationRequired) ||
        (body.mutationRequired !== undefined && body.mutated !== true) ||
        !isTradableZombie(body.zombieKey)) return { status: 400, error: "bad_zombie_request" };
    zombieKey = body.zombieKey; mutated = body.mutated ? 1 : 0;
    mutationRequired = body.mutationRequired ?? null;
    const requirementFailure = await purchaseRequirementFailure(db, accountId, zombieKey);
    if (requirementFailure) return requirementFailure;
    const balance = await db.prepare("SELECT brains FROM balances WHERE account_id=?")
      .bind(accountId).first<{ brains: number }>();
    if (!balance || balance.brains < Number(body.priceBrains)) return { status: 409, error: "insufficient_brains" };
  }

  const orderId = crypto.randomUUID();
  const guard = `EXISTS (SELECT 1 FROM account_runtime_v3 r WHERE r.account_id=?
    AND r.account_version=? AND r.active_batch_id IS NOT NULL)`;
  const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO black_market_orders
    (id,creator_account_id,kind,zombie_key,mutated_required,mutation_required,price_brains,status,created_day,created_at,
     source_unit_id,escrow_mutation,escrow_invasions,escrow_brains)
    SELECT ?,?,?,?,?,?,?,'OPEN',?,?,?,?,?,? WHERE ${guard}
      AND (SELECT COUNT(*) FROM black_market_orders WHERE creator_account_id=? AND status='OPEN')<?
      AND (SELECT COUNT(*) FROM black_market_orders WHERE creator_account_id=? AND created_day=?)<?`)
    .bind(orderId, accountId, kind, zombieKey, mutated, mutationRequired, body.priceBrains, dayBucket(now), now,
      unitId, mutation, invasions, kind === "BUY_ZOMBIE" ? body.priceBrains : 0,
      accountId, expectedVersion, accountId, ACTIVE_LIMIT, accountId, dayBucket(now), DAILY_LIMIT)];
  if (kind === "SELL_ZOMBIE") {
    statements.push(db.prepare(`DELETE FROM roster_v3 WHERE account_id=? AND unit_id=? AND locked_by_raid IS NULL
      AND EXISTS(SELECT 1 FROM black_market_orders WHERE id=?)`).bind(accountId, unitId, orderId));
  } else {
    statements.push(db.prepare(`UPDATE balances SET brains=brains-? WHERE account_id=? AND brains>=?
      AND EXISTS(SELECT 1 FROM black_market_orders WHERE id=?)`)
      .bind(body.priceBrains, accountId, body.priceBrains, orderId));
  }
  statements.push(
    db.prepare(`UPDATE account_runtime_v3 SET account_version=account_version+1,updated_at=?
      WHERE account_id=? AND account_version=? AND EXISTS(SELECT 1 FROM black_market_orders WHERE id=?)`)
      .bind(now, accountId, expectedVersion, orderId),
    db.prepare(`INSERT INTO black_market_receipts(operation_id,account_id,action,request_fingerprint,order_id,created_at)
      SELECT ?,?,'CREATE',?,?,? WHERE EXISTS(SELECT 1 FROM black_market_orders WHERE id=?)`)
      .bind(operationId, accountId, fp, orderId, now, orderId),
    db.prepare(`INSERT INTO audit_events_v3(id,account_id,kind,detail_json,created_at)
      SELECT ?,?,'black_market_create',?,? WHERE EXISTS(SELECT 1 FROM black_market_orders WHERE id=?)`)
      .bind(`${accountId}:market:${operationId}`, accountId, JSON.stringify({
        orderId, kind, zombieKey, mutated: !!mutated, mutationRequired, priceBrains: body.priceBrains,
      }), now, orderId)
  );
  const committed = await db.batch(statements);
  if ((committed[0]?.meta.changes ?? 0) !== 1 || (committed[1]?.meta.changes ?? 0) !== 1) {
    return { status: 409, error: "state_conflict" };
  }
  return response(db, accountId, orderId, now);
}

export async function cancel(
  db: D1Database, accountId: string, orderId: string, body: Record<string, unknown>, now: number
): Promise<BlackMarketMutationResponse | MarketFailure> {
  const operationId = body.operationId;
  const expectedVersion = body.expectedAccountVersion;
  if (!validId(orderId) || !validId(operationId) || !Number.isSafeInteger(expectedVersion))
    return { status: 400, error: "bad_market_cancel" };
  const fp = fingerprint("CANCEL", { orderId });
  const prior = await replay(db, accountId, operationId, fp, now);
  if (prior) return prior;
  const row = await orderRow(db, orderId);
  if (!row) return { status: 404, error: "order_not_found" };
  if (row.creator_account_id !== accountId) return { status: 403, error: "not_order_owner" };
  if (row.status !== "OPEN") return { status: 409, error: "order_closed" };
  // Taking a listing down hands the escrowed zombie straight back, so it needs
  // somewhere to land. With the farm AND the Mausoleum full the cancel is refused
  // outright rather than restoring a unit into a crypt that may not even exist —
  // the listing stays open and the player can retry once they free a slot.
  if (row.kind === "SELL_ZOMBIE" && !await hasDeliveryRoom(db, accountId))
    return { status: 409, error: "no_room" };
  const restoredId = crypto.randomUUID();
  const roomGuard = row.kind === "SELL_ZOMBIE"
    ? { sql: ` AND ${hasRoomSql}`, binds: hasRoomBinds(accountId) }
    : { sql: "", binds: [] };
  const claim = db.prepare(`UPDATE black_market_orders SET status='CANCELLED',closed_at=?,closed_operation_id=?
    WHERE id=? AND creator_account_id=? AND status='OPEN' AND EXISTS(SELECT 1 FROM account_runtime_v3
      WHERE account_id=? AND account_version=? AND active_batch_id IS NOT NULL)${roomGuard.sql}`)
    .bind(now, operationId, orderId, accountId, accountId, expectedVersion, ...roomGuard.binds);
  const guard = "EXISTS(SELECT 1 FROM black_market_orders WHERE id=? AND status='CANCELLED' AND closed_operation_id=?)";
  const statements: D1PreparedStatement[] = [claim];
  // from_escrow=1: this is the seller's own zombie coming home, not an acquisition.
  // Without the mark the client sees an unfamiliar unit id and credits the Zombie
  // Almanac, so list/cancel cycles inflated that species' lifetime count.
  if (row.kind === "SELL_ZOMBIE") statements.push(db.prepare(`INSERT INTO roster_v3
    (account_id,unit_id,zombie_key,mutation,invasions,stored,from_escrow,created_at)
    SELECT ?,?,?,?,?,${claimDestinationSql},1,? WHERE ${guard}`).bind(accountId, restoredId, row.zombie_key,
      row.escrow_mutation ?? 0, row.escrow_invasions ?? 0,
      ...claimDestinationBinds(accountId), now, orderId, operationId));
  else statements.push(db.prepare(`UPDATE balances SET brains=brains+? WHERE account_id=? AND ${guard}`)
    .bind(row.price_brains, accountId, orderId, operationId));
  statements.push(
    db.prepare(`UPDATE account_runtime_v3 SET account_version=account_version+1,updated_at=? WHERE account_id=?
      AND account_version=? AND ${guard}`).bind(now, accountId, expectedVersion, orderId, operationId),
    db.prepare(`INSERT INTO black_market_receipts(operation_id,account_id,action,request_fingerprint,order_id,created_at)
      SELECT ?,?,'CANCEL',?,?,? WHERE ${guard}`)
      .bind(operationId, accountId, fp, orderId, now, orderId, operationId),
    db.prepare(`INSERT INTO audit_events_v3(id,account_id,kind,detail_json,created_at)
      SELECT ?,?,'black_market_cancel',?,? WHERE ${guard}`)
      .bind(`${accountId}:market:${operationId}`, accountId, JSON.stringify({ orderId,
        restoredId: row.kind === "SELL_ZOMBIE" ? restoredId : null }), now, orderId, operationId)
  );
  const committed = await db.batch(statements);
  if ((committed[0]?.meta.changes ?? 0) !== 1) return { status: 409, error: "state_conflict" };
  return response(db, accountId, orderId, now);
}

export async function fulfill(
  db: D1Database, accountId: string, orderId: string, body: Record<string, unknown>, now: number
): Promise<BlackMarketMutationResponse | MarketFailure> {
  const operationId = body.operationId;
  const expectedVersion = body.expectedAccountVersion;
  if (!validId(orderId) || !validId(operationId) || !Number.isSafeInteger(expectedVersion))
    return { status: 400, error: "bad_market_fulfillment" };
  const fp = fingerprint("FULFILL", { orderId, unitId: body.unitId ?? null });
  const prior = await replay(db, accountId, operationId, fp, now);
  if (prior) return prior;
  const row = await orderRow(db, orderId);
  if (!row) return { status: 404, error: "order_not_found" };
  if (row.creator_account_id === accountId) return { status: 403, error: "self_trade" };
  if (row.status !== "OPEN") return { status: 409, error: "order_closed" };

  const recipientAccountId = row.kind === "SELL_ZOMBIE" ? accountId : row.creator_account_id;
  const requirementFailure = await purchaseRequirementFailure(db, recipientAccountId, row.zombie_key);
  if (requirementFailure) return requirementFailure;
  const recipientRequirement = purchaseRequirementGuard(
    recipientAccountId,
    blackMarketPurchaseRequirement(row.zombie_key) ?? {}
  );

  let offered: { unitId: string; mutation: number; invasions: number } | null = null;
  if (row.kind === "BUY_ZOMBIE") {
    if (!validId(body.unitId)) return { status: 400, error: "bad_unit" };
    const unit = await db.prepare(`SELECT unit_id,zombie_key,mutation,invasions FROM roster_v3
      WHERE account_id=? AND unit_id=? AND locked_by_raid IS NULL`).bind(accountId, body.unitId)
      .first<{ unit_id: string; zombie_key: string; mutation: number; invasions: number }>();
    const mutationMatches = !!unit && matchesMutationRequirement(
      unit.mutation,
      row.mutated_required,
      row.mutation_required
    );
    if (!unit || unit.zombie_key !== row.zombie_key || !mutationMatches)
      return { status: 409, error: "zombie_mismatch" };
    if (!isTradableZombie(unit.zombie_key)) return { status: 403, error: "zombie_not_tradable" };
    offered = { unitId: unit.unit_id, mutation: unit.mutation, invasions: unit.invasions };
  } else {
    const balance = await db.prepare("SELECT brains FROM balances WHERE account_id=?").bind(accountId)
      .first<{ brains: number }>();
    if (!balance || balance.brains < row.price_brains) return { status: 409, error: "insufficient_brains" };
  }
  const creatorRuntime = await db.prepare("SELECT active_batch_id,active_batch_expires_at FROM account_runtime_v3 WHERE account_id=?")
    .bind(row.creator_account_id).first<{ active_batch_id: string | null; active_batch_expires_at: number }>();
  if (creatorRuntime?.active_batch_id && creatorRuntime.active_batch_expires_at > now)
    return { status: 409, error: "counterparty_busy" };

  const mutationAsset = mutationRequirementSql(row.mutation_required);
  const actorAsset = row.kind === "SELL_ZOMBIE"
    ? "EXISTS(SELECT 1 FROM balances WHERE account_id=? AND brains>=?)"
    : `EXISTS(SELECT 1 FROM roster_v3 WHERE account_id=? AND unit_id=? AND zombie_key=?
        AND ${mutationAsset.sql}
        AND locked_by_raid IS NULL)`;
  const actorAssetBinds = row.kind === "SELL_ZOMBIE"
    ? [accountId, row.price_brains]
    : [
        accountId,
        offered!.unitId,
        row.zombie_key,
        ...(row.mutation_required === null ? [row.mutated_required] : mutationAsset.binds),
      ];
  // Stamp the actually-traded unit on the order so trade history can show it —
  // a request's escrow columns hold brains, so the offered unit has nowhere
  // else to live once the fulfiller's roster row is deleted.
  const delivered = row.kind === "SELL_ZOMBIE"
    ? { mutation: row.escrow_mutation ?? 0, invasions: row.escrow_invasions ?? 0 }
    : { mutation: offered!.mutation, invasions: offered!.invasions };
  const claim = db.prepare(`UPDATE black_market_orders SET status='FULFILLED',closed_at=?,
      closed_operation_id=?,fulfilled_by_account_id=?,delivered_mutation=?,delivered_invasions=?
      WHERE id=? AND status='OPEN'
      AND creator_account_id!=? AND ${actorAsset}
      AND EXISTS(SELECT 1 FROM account_runtime_v3 WHERE account_id=? AND account_version=? AND active_batch_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM account_runtime_v3 WHERE account_id=black_market_orders.creator_account_id
        AND active_batch_id IS NOT NULL AND active_batch_expires_at>?)
      AND ${recipientRequirement.sql}`)
    .bind(now, operationId, accountId, delivered.mutation, delivered.invasions,
      orderId, accountId, ...actorAssetBinds,
      accountId, expectedVersion, now, ...recipientRequirement.binds);
  const guard = "EXISTS(SELECT 1 FROM black_market_orders WHERE id=? AND status='FULFILLED' AND closed_operation_id=?)";
  const statements: D1PreparedStatement[] = [claim];
  if (row.kind === "SELL_ZOMBIE") {
    statements.push(
      db.prepare(`UPDATE balances SET brains=brains-? WHERE account_id=? AND ${guard}`)
        .bind(row.price_brains, accountId, orderId, operationId),
      db.prepare(`UPDATE balances SET brains=brains+? WHERE account_id=? AND ${guard}`)
        .bind(row.price_brains, row.creator_account_id, orderId, operationId)
    );
  } else {
    statements.push(
      db.prepare(`DELETE FROM roster_v3 WHERE account_id=? AND unit_id=? AND ${guard}`)
        .bind(accountId, offered!.unitId, orderId, operationId),
      db.prepare(`UPDATE balances SET brains=brains+? WHERE account_id=? AND ${guard}`)
        .bind(row.price_brains, accountId, orderId, operationId)
    );
  }
  // The traded zombie is NOT minted here. It waits on the order (its species and
  // stats are stamped in `delivered_*` above) until the recipient claims it, so a
  // recipient with no free army slot and no Mausoleum cannot be handed a unit that
  // has nowhere to exist. See `claimDelivery`.
  statements.push(
    db.prepare(`UPDATE account_runtime_v3 SET account_version=account_version+1,updated_at=? WHERE account_id=?
      AND account_version=? AND ${guard}`).bind(now, accountId, expectedVersion, orderId, operationId),
    db.prepare(`UPDATE account_runtime_v3 SET account_version=account_version+1,updated_at=? WHERE account_id=? AND ${guard}`)
      .bind(now, row.creator_account_id, orderId, operationId),
    db.prepare(`INSERT INTO black_market_receipts(operation_id,account_id,action,request_fingerprint,order_id,created_at)
      SELECT ?,?,'FULFILL',?,?,? WHERE ${guard}`)
      .bind(operationId, accountId, fp, orderId, now, orderId, operationId),
    db.prepare(`INSERT INTO audit_events_v3(id,account_id,kind,detail_json,created_at)
      SELECT ?,?,'black_market_fulfill',?,? WHERE ${guard}`)
      .bind(`${accountId}:market:${operationId}`, accountId, JSON.stringify({ orderId, creatorAccountId: row.creator_account_id,
        zombieKey: row.zombie_key, priceBrains: row.price_brains,
        recipientAccountId }), now, orderId, operationId)
  );
  const committed = await db.batch(statements);
  if ((committed[0]?.meta.changes ?? 0) !== 1) return { status: 409, error: "state_conflict" };
  return response(db, accountId, orderId, now);
}
