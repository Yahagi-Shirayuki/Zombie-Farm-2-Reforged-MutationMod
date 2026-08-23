// Friend invasions (PvP) — server routes' logic. See src/raid/pvp.ts (shared rules)
// and raidVerifier.buildPinnedPvpRaid (the pinned config).
//
// The invariants this file exists to hold:
//  - NOBODY LOSES ANYTHING. The defender is a snapshot pinned at start; the finish
//    path touches no roster row, no balance, no cooldown — the only mutation a fight
//    settles is a boost grant into the WINNER's own inventory.
//  - The defender's account is never written while they are away. Their reward for a
//    successful defense parks on the session row until THEY claim it (/raid/pvp/collect),
//    exactly the Black Market's claim-on-login shape.
//  - The outcome is the server's own deterministic replay of the pinned config, same
//    verifier as ordinary raids; `clientWin` remains a pure concession (ANDed).
//  - Zero-risk rewards invite collusion, so attacks on the same friend are capped per
//    UTC day (PVP_DAILY_ATTACKS_PER_PAIR) and gated on a live friendship.
import { MAX_STACK, BOOST_KEYS } from "../boostCatalog";
import { areFriends } from "../db";
import { dayBucket } from "../logic";
import {
  buildPinnedPvpRaid,
  verifyRaid,
  RAID_RULESET_VERSION,
  type PinnedPvpConfig,
  type RaidReplayInput,
} from "../raidVerifier";
import {
  PVP_DAILY_ATTACKS_PER_PAIR,
  pvpRewardsForTier,
  type PvpReward,
} from "../../../src/raid/pvp";
import type { RaidOutcome } from "../../../src/raid/types";

/** Same job as the raid TTL, same length, same limits: it only releases an ABANDONED
 *  session (here: frees the one-live-session slot); a finish keyed on `finished_at
 *  IS NULL` still settles late on its merits. */
const PVP_TTL_MS = 15 * 60 * 1000;
const EARLIEST_FINISH_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface SessionRow {
  id: string;
  attacker_id: string;
  defender_id: string;
  config_json: string;
  ruleset_version: number;
  attack_score: number;
  defense_score: number;
  boosts_json: string;
  started_at: number;
  finished_at: number | null;
  result_json: string | null;
  win: number | null;
  defense_claimed_at: number | null;
}

interface CoreState {
  inventory: Record<string, number>;
  [key: string]: unknown;
}

const parse = <T>(value: string | null | undefined, fallback: T): T => {
  try { return JSON.parse(value ?? "") as T; } catch { return fallback; }
};

/** Release an abandoned live session (win stays NULL — it never fought). */
async function expireLivePvp(db: D1Database, attackerId: string, now: number): Promise<void> {
  await db.prepare(`UPDATE pvp_sessions_v3 SET finished_at = ?
    WHERE attacker_id = ? AND finished_at IS NULL AND expires_at <= ?`)
    .bind(now, attackerId, now).run();
}

export async function startPvp(
  db: D1Database,
  accountId: string,
  body: { defenderId?: unknown; orderedUnitIds?: unknown; rulesetVersion?: unknown },
  now: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  await expireLivePvp(db, accountId, now);
  if (body.rulesetVersion !== RAID_RULESET_VERSION) {
    return { status: 426, body: { ok: false, error: "stale_ruleset", rulesetVersion: RAID_RULESET_VERSION } };
  }
  const defenderId = typeof body.defenderId === "string" ? body.defenderId : "";
  if (!defenderId || defenderId === accountId) return { status: 400, body: { ok: false, error: "bad_defender" } };
  if (!await areFriends(db, accountId, defenderId)) {
    return { status: 403, body: { ok: false, error: "not_friends" } };
  }
  const [live, pairToday] = await Promise.all([
    db.prepare("SELECT id FROM pvp_sessions_v3 WHERE attacker_id = ? AND finished_at IS NULL")
      .bind(accountId).first<{ id: string }>(),
    // The pair cap counts OPENED attacks (not wins): abandoning a fight must not
    // refund the attempt, or the cap is a suggestion.
    db.prepare(`SELECT COUNT(*) AS n FROM pvp_sessions_v3
      WHERE attacker_id = ? AND defender_id = ? AND started_at >= ?`)
      .bind(accountId, defenderId, dayBucket(now) * DAY_MS).first<{ n: number }>(),
  ]);
  if (live) return { status: 409, body: { ok: false, error: "raid_in_progress" } };
  if ((pairToday?.n ?? 0) >= PVP_DAILY_ATTACKS_PER_PAIR) {
    return { status: 429, body: { ok: false, error: "pair_limit", limit: PVP_DAILY_ATTACKS_PER_PAIR } };
  }
  const pinned = await buildPinnedPvpRaid(db, accountId, defenderId, body.orderedUnitIds);
  if (!pinned.ok) {
    const status = pinned.error === "bad_roster" || pinned.error === "bad_defender" ? 400 : 409;
    return { status, body: { ok: false, error: pinned.error } };
  }
  const sessionId = crypto.randomUUID();
  const tiers = { attackerTier: pinned.config.pvp.attackerTier, defenderTier: pinned.config.pvp.defenderTier };
  await db.batch([
    db.prepare(`INSERT INTO pvp_sessions_v3
      (id, attacker_id, defender_id, config_json, ruleset_version, attack_score, defense_score,
       boosts_json, started_at, earliest_finish_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(sessionId, accountId, defenderId, JSON.stringify(pinned.config), RAID_RULESET_VERSION,
        pinned.config.pvp.attackScore, pinned.config.pvp.defenseScore, JSON.stringify(tiers),
        now, now + EARLIEST_FINISH_MS, now + PVP_TTL_MS),
    db.prepare(`INSERT INTO audit_events_v3(id,account_id,kind,detail_json,created_at)
      VALUES(?,?, 'pvp_start', ?, ?)`)
      .bind(crypto.randomUUID(), accountId, JSON.stringify({
        sessionId, defenderId,
        attackScore: pinned.config.pvp.attackScore, defenseScore: pinned.config.pvp.defenseScore,
      }), now),
  ]);
  return { status: 200, body: {
    ok: true, sessionId, config: pinned.config,
    expiresAt: now + PVP_TTL_MS, earliestFinishAt: now + EARLIEST_FINISH_MS,
    serverTime: now, rulesetVersion: RAID_RULESET_VERSION,
  } };
}

async function closeInvalidPvp(
  db: D1Database,
  accountId: string,
  sessionId: string,
  now: number,
  rejection: { error: string; finalTick: unknown; inputCount: number }
): Promise<void> {
  await db.batch([
    db.prepare("UPDATE pvp_sessions_v3 SET finished_at=? WHERE id=? AND attacker_id=? AND finished_at IS NULL")
      .bind(now, sessionId, accountId),
    db.prepare(`INSERT INTO audit_events_v3(id,account_id,kind,detail_json,created_at)
      VALUES(?,?, 'pvp_finish_rejected', ?, ?)`)
      .bind(crypto.randomUUID(), accountId, JSON.stringify({ sessionId, ...rejection }), now),
  ]);
}

export async function finishPvp(
  db: D1Database,
  accountId: string,
  body: { sessionId?: unknown; finalTick?: unknown; inputs?: unknown; clientWin?: unknown },
  now: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (typeof body.sessionId !== "string" || !body.sessionId) return { status: 400, body: { error: "bad_session" } };
  if (body.clientWin !== undefined && typeof body.clientWin !== "boolean") {
    return { status: 400, body: { error: "bad_client_win" } };
  }
  const conceded = body.clientWin === false;
  const session = await db.prepare("SELECT * FROM pvp_sessions_v3 WHERE id = ? AND attacker_id = ?")
    .bind(body.sessionId, accountId).first<SessionRow>();
  if (!session) return { status: 404, body: { error: "bad_session" } };
  if (session.result_json) {
    return { status: 200, body: { ...parse<Record<string, unknown>>(session.result_json, {}), serverTime: now } };
  }
  if (session.finished_at) return { status: 409, body: { error: "already_finished" } };
  if (session.ruleset_version !== RAID_RULESET_VERSION) {
    await closeInvalidPvp(db, accountId, session.id, now, {
      error: "stale_ruleset", finalTick: body.finalTick,
      inputCount: Array.isArray(body.inputs) ? body.inputs.length : 0,
    });
    return { status: 409, body: { error: "stale_ruleset", rulesetVersion: RAID_RULESET_VERSION } };
  }
  const pacedTick = Math.floor((now - session.started_at) / 50) + 40;
  if (Number(body.finalTick) > pacedTick) return { status: 422, body: { error: "future_finish" } };
  let config: PinnedPvpConfig;
  try { config = JSON.parse(session.config_json) as PinnedPvpConfig; }
  catch {
    await closeInvalidPvp(db, accountId, session.id, now, {
      error: "bad_session_config", finalTick: body.finalTick,
      inputCount: Array.isArray(body.inputs) ? body.inputs.length : 0,
    });
    return { status: 409, body: { error: "bad_session_config" } };
  }
  const verified = verifyRaid(config, body.finalTick as number, body.inputs as RaidReplayInput[]);
  if (!verified.ok) {
    await closeInvalidPvp(db, accountId, session.id, now, {
      error: verified.error, finalTick: body.finalTick,
      inputCount: Array.isArray(body.inputs) ? body.inputs.length : 0,
    });
    return { status: 422, body: { error: verified.error } };
  }
  // No hazards exist in a friend invasion, so no concession-fallback branch: the
  // replay always completes. `clientWin` stays a one-way concession all the same.
  const win = !verified.retreated && verified.outcome.win && !conceded;
  const tiers = parse<{ attackerTier?: number; defenderTier?: number }>(session.boosts_json, {});
  const rewards: PvpReward[] = win ? pvpRewardsForTier(tiers.attackerTier ?? 1) : [];
  // Echo the SETTLED outcome (a conceded win reads as the loss it was paid as).
  const outcome: RaidOutcome = { ...verified.outcome, win };
  const settlementId = crypto.randomUUID();
  const result = {
    settlementId, win, outcome, rewards,
    attackScore: session.attack_score, defenseScore: session.defense_score,
    rewardTier: win ? tiers.attackerTier ?? 1 : null,
    defenderName: config.pvp?.defenderName ?? "",
    rulesetVersion: RAID_RULESET_VERSION,
  };
  const resultJson = JSON.stringify(result);
  const guard = "EXISTS (SELECT 1 FROM pvp_sessions_v3 s WHERE s.id = ? AND s.result_json = ?)";
  // The transcript is kept for a future replay viewer; the replay cap bounds it at
  // 32 KB, but a belt-and-braces size check keeps a hostile body out of the row.
  const inputsJson = JSON.stringify(Array.isArray(body.inputs) ? body.inputs : []);
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE pvp_sessions_v3 SET finished_at = ?, result_json = ?, win = ?,
      final_tick = ?, inputs_json = ? WHERE id = ? AND finished_at IS NULL`)
      .bind(now, resultJson, win ? 1 : 0, Math.max(0, Math.trunc(Number(body.finalTick) || 0)),
        inputsJson.length <= 40_000 ? inputsJson : null, session.id),
    db.prepare(`INSERT INTO audit_events_v3(id,account_id,kind,detail_json,created_at)
      SELECT ?, ?, 'pvp_finish', ?, ? WHERE ${guard}`)
      .bind(settlementId, accountId, JSON.stringify({
        sessionId: session.id, defenderId: session.defender_id, win,
        rewards, tier: win ? tiers.attackerTier ?? 1 : null,
      }), now, session.id, resultJson),
  ];
  let inventory: Record<string, number> | null = null;
  if (rewards.length) {
    // Boost grants come from this trusted settlement path only (see inventory.ts's
    // "no public grant" rule) — same shape as raid loot's bundled boost drop.
    const coreRow = await db.prepare("SELECT current_json FROM gameplay_documents_v3 WHERE account_id = ?")
      .bind(accountId).first<{ current_json: string }>();
    if (!coreRow) return { status: 409, body: { error: "state_conflict" } };
    const core = parse<CoreState>(coreRow.current_json, { inventory: {} });
    core.inventory = core.inventory ?? {};
    for (const reward of rewards) {
      if (!BOOST_KEYS.includes(reward.key)) continue;
      core.inventory[reward.key] = Math.min(MAX_STACK, (core.inventory[reward.key] ?? 0) + reward.qty);
    }
    inventory = core.inventory;
    statements.push(
      db.prepare(`UPDATE gameplay_documents_v3 SET current_json = ?, updated_at = ?
        WHERE account_id = ? AND ${guard}`)
        .bind(JSON.stringify(core), now, accountId, session.id, resultJson)
    );
  }
  const committed = await db.batch(statements);
  if ((committed[0]?.meta.changes ?? 0) !== 1) {
    const raced = await db.prepare("SELECT result_json FROM pvp_sessions_v3 WHERE id = ?")
      .bind(session.id).first<{ result_json: string | null }>();
    return raced?.result_json
      ? { status: 200, body: { ...parse<Record<string, unknown>>(raced.result_json, {}), serverTime: now } }
      : { status: 409, body: { error: "state_conflict" } };
  }
  return { status: 200, body: { ...result, ...(inventory ? { inventory } : {}), serverTime: now } };
}

export interface PvpHistoryEntry {
  sessionId: string;
  role: "attacker" | "defender";
  otherName: string;
  finishedAt: number;
  /** Whether the ATTACKER won the fight. */
  attackerWon: boolean;
  attackScore: number;
  defenseScore: number;
  /** Set on rows where the CALLER is the defender, the defense held, and the reward
   *  is still unclaimed — the client renders a Claim button from it. */
  claimableTier?: number;
}

export async function historyPvp(
  db: D1Database,
  accountId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const rows = await db.prepare(`SELECT id, attacker_id, defender_id, finished_at, win,
      attack_score, defense_score, boosts_json, defense_claimed_at
    FROM pvp_sessions_v3
    WHERE (attacker_id = ? OR defender_id = ?) AND win IS NOT NULL
    ORDER BY finished_at DESC LIMIT 20`)
    .bind(accountId, accountId).all<SessionRow>();
  const sessions = rows.results ?? [];
  const otherIds = [...new Set(sessions.map((s) =>
    s.attacker_id === accountId ? s.defender_id : s.attacker_id))];
  const names = new Map<string, string>();
  if (otherIds.length) {
    const placeholders = otherIds.map(() => "?").join(",");
    const accounts = await db.prepare(`SELECT id, username FROM accounts WHERE id IN (${placeholders})`)
      .bind(...otherIds).all<{ id: string; username: string | null }>();
    for (const row of accounts.results ?? []) names.set(row.id, row.username?.trim() || "A friend");
  }
  const entries: PvpHistoryEntry[] = sessions.map((s) => {
    const role = s.attacker_id === accountId ? "attacker" as const : "defender" as const;
    const tiers = parse<{ defenderTier?: number }>(s.boosts_json, {});
    const claimable = role === "defender" && s.win === 0 && s.defense_claimed_at == null;
    return {
      sessionId: s.id,
      role,
      otherName: names.get(role === "attacker" ? s.defender_id : s.attacker_id) ?? "A friend",
      finishedAt: s.finished_at ?? 0,
      attackerWon: s.win === 1,
      attackScore: s.attack_score,
      defenseScore: s.defense_score,
      ...(claimable ? { claimableTier: tiers.defenderTier ?? 1 } : {}),
    };
  });
  return { status: 200, body: { ok: true, entries } };
}

/** The defender collects a successful defense's reward — claim-on-login, one time.
 *  This is the only PvP write into the defender's account, and they are the caller. */
export async function collectPvp(
  db: D1Database,
  accountId: string,
  body: { sessionId?: unknown },
  now: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (typeof body.sessionId !== "string" || !body.sessionId) return { status: 400, body: { error: "bad_session" } };
  const session = await db.prepare(`SELECT id, defender_id, win, boosts_json, defense_claimed_at
    FROM pvp_sessions_v3 WHERE id = ? AND defender_id = ?`)
    .bind(body.sessionId, accountId).first<SessionRow>();
  if (!session) return { status: 404, body: { error: "bad_session" } };
  if (session.win !== 0) return { status: 409, body: { error: "not_defended" } };
  if (session.defense_claimed_at != null) return { status: 409, body: { error: "already_claimed" } };
  const tiers = parse<{ defenderTier?: number }>(session.boosts_json, {});
  const rewards = pvpRewardsForTier(tiers.defenderTier ?? 1);
  const coreRow = await db.prepare("SELECT current_json FROM gameplay_documents_v3 WHERE account_id = ?")
    .bind(accountId).first<{ current_json: string }>();
  if (!coreRow) return { status: 409, body: { error: "state_conflict" } };
  const core = parse<CoreState>(coreRow.current_json, { inventory: {} });
  core.inventory = core.inventory ?? {};
  for (const reward of rewards) {
    if (!BOOST_KEYS.includes(reward.key)) continue;
    core.inventory[reward.key] = Math.min(MAX_STACK, (core.inventory[reward.key] ?? 0) + reward.qty);
  }
  const guard = `EXISTS (SELECT 1 FROM pvp_sessions_v3 s
    WHERE s.id = ? AND s.defender_id = ? AND s.defense_claimed_at = ?)`;
  const committed = await db.batch([
    db.prepare(`UPDATE pvp_sessions_v3 SET defense_claimed_at = ?
      WHERE id = ? AND defender_id = ? AND win = 0 AND defense_claimed_at IS NULL`)
      .bind(now, session.id, accountId),
    db.prepare(`UPDATE gameplay_documents_v3 SET current_json = ?, updated_at = ?
      WHERE account_id = ? AND ${guard}`)
      .bind(JSON.stringify(core), now, accountId, session.id, accountId, now),
    db.prepare(`INSERT INTO audit_events_v3(id,account_id,kind,detail_json,created_at)
      SELECT ?, ?, 'pvp_defense_collect', ?, ? WHERE ${guard}`)
      .bind(crypto.randomUUID(), accountId,
        JSON.stringify({ sessionId: session.id, rewards, tier: tiers.defenderTier ?? 1 }), now,
        session.id, accountId, now),
  ]);
  if ((committed[0]?.meta.changes ?? 0) !== 1) return { status: 409, body: { error: "already_claimed" } };
  return { status: 200, body: { ok: true, rewards, tier: tiers.defenderTier ?? 1, inventory: core.inventory, serverTime: now } };
}
