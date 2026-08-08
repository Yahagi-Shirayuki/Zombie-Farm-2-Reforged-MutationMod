# Zombie Farm — Security & Capacity Runbook

Operational companion to [`../SECURITY.md`](../SECURITY.md). Covers what the Worker
logs, what to alert on, and how to respond.

Last reviewed: 2026-07-25.

> **Protocol-v3 notice (2026-07-25):** the v2 save/action/sync routes are retired behind a
> `410` middleware (`retiredV2` in `src/index.ts`), which runs as `app.use("*")` and therefore
> short-circuits *before* those handlers. Their `slog()` calls still exist in the source but
> are **unreachable** — see the dead-events table in §2. Protocol v3 emits request metrics and
> durable audit rows; individual semantic command rejections inside an HTTP-200 batch are still
> not emitted through `slog()`. Do not assume quiet logs prove v3 traffic is clean.
>
> For an active gameplay-integrity incident, set `MUTATIONS_DISABLED=1` and deploy.
> Raising `MIN_PROTOCOL_VERSION` stops stale `/commands` clients only. The other mutation
> routes (`/raid/*`, `/epic-boss/*`, `/black-market/*`, `PUT /presentation`) are gated instead
> by the writer lease's `X-Integrity-Version` check under `WRITER_LEASE_MODE=enforce`.

The Worker is a Cloudflare Worker (`src/index.ts`) backed by one D1 database named
`zombiefarm` (see `wrangler.toml`). Logs go to stdout; view them live with
`wrangler tail` or in the Cloudflare dashboard (Workers → Logs).

---

## 1. Log shape

Every security-relevant line is one JSON object emitted by `slog()`:

```json
{ "sec": "<event>", "lvl": "info|warn|alert", "account": "…", "…": "…" }
```

- `sec` — the event name (stable; alert rules key on it).
- `lvl` — severity, so a rule can filter cheaply:
  - **info** — routine / operational. Alert only on an unusual *rate*, never on one line.
  - **warn** — a rejected or abnormal request. Alert on a per-account or global *threshold*.
  - **alert** — a strong signal. Page a human on essentially any occurrence.
- All lines are **PII-free** (ids only), so they are safe to retain and forward.

Tail only security lines:

```sh
wrangler tail --format json | grep '"sec":'
# just the high-signal ones:
wrangler tail --format json | grep '"lvl":"alert"'
```

---

## 2. Events, meaning, and alert thresholds

| `sec` | `lvl` | Meaning | Alert when |
|---|---|---|---|
**Live under protocol v3:**

| `sec` | `lvl` | Meaning | Alert when |
|---|---|---|---|
| `dev_auth_rejected` | alert | A `devSub` (dev-bypass) sign-in hit a **prod** server (`DEV_AUTH` unset). Should be impossible in normal use. | **any** occurrence → page. Confirm `DEV_AUTH` is unset in prod. |
| `account_command_rejected` | alert | An account exceeded its hourly/daily command-volume ceiling and was refused. | **any** sustained occurrence → automation or a runaway client on that account. |
| `auth_token_invalid` | warn | A Google ID token failed verification. | > ~20/min globally, or a burst from one IP → credential/endpoint probing. |
| `auth_denied` | info | A request was rejected at auth. `stage:"token"` = bad/expired/absent JWT (routine). `stage:"session"` = valid signature but the session is revoked / idle-expired / mismatched. | Spike in `stage:"session"` → possible **leaked-token replay after a revoke**. Investigate the account; consider logout-all + secret rotation. |
| `rate_limited` | warn | A route's per-key limit tripped (`route`, `who`). | Sustained for one `who` → abuse or a stuck client. Global spike across routes → attack/DDoS. |
| `signup_refused` | info | An unknown Google identity was turned away at `/auth` because the service closedown (`mode` field) is not `open`. Expected traffic during a planned closedown. | **Never alert on this while a closedown is deliberate.** Any occurrence while you believe the service is `open` → check `service_state`; the switch may have been left set. |
| `account_command_volume` | warn | An account's command volume crossed the soft warning threshold (`hourly`, `daily`). | Repeated for one `account` → precursor to `account_command_rejected`. |
| `writer_operation_rejected` | warn | A mutation was refused because another operation held the account's writer fence. | Sustained for one `account` → a stuck lease or two clients fighting; check `active_batch_expires_at`. |
| `gift_claim_deferred` | warn | A gift claim lost the account fence to a live raid/Epic Boss/command settlement and returned `409 operation_in_progress` for the client to retry. The gift stays in the inbox — nothing is lost. | Recurring for the same `account`/`gift` → the fence is not clearing; inspect `active_batch_id`. |
| `logout_all` | info | An account revoked all its sessions. | — |
| `cleanup` | info | Nightly cron purge counts (`sessions`, `buckets`, `requests`, `raidSessions`). v3 deliberately retains premium, purchase/refund, zombie-lifecycle, and raid audit events. | Absence for > 24h → cron not firing. |

Raid integrity is audited durably in D1 rather than through `slog()`: `audit_events_v3` carries
raid start/finish rows and a `raid_finish_rejected` row for every refused finish (including the
`concessionFallbackError` code). Query that table, not the logs, when investigating raid forgery.

**Dead — retired v2 handlers (do not build alert rules on these):**

`save_invalid`, `save_too_large`, `save_conflict`, `grants_reconciled`, `economy_rejected`,
`farm_rejected`, `inventory_rejected`, `object_rejected`, `roster_rejected`, `shop_rejected`,
`storage_rejected`, `quest_rejected`, and the legacy `raid_replay` / `invalid_raid_input` pair.
Their call sites still exist in `src/index.ts`, but every route that reaches them is intercepted
by the `retiredV2` `410` middleware, so they can no longer fire. (The live v3 raid path logs to
`audit_events_v3` instead.) An older alert rule keyed on these will be silent forever — which
reads as "clean" and is not.

Note the previous edition of this table listed `gift_credit_deferred`; no such event exists. The
real name is `gift_claim_deferred`.

**General rule:** a single `warn` is usually a modified client poking one account —
scope the response to that account. A **global** rise in `warn`/`alert` across many
accounts is an attack or a regression — treat as an incident.

---

## 3. Capacity signals to watch

The correctness controls are D1 constraints, but the **free-tier D1 write budget** is
the scaling ceiling (see `SECURITY.md` “Method for reducing server load”). Track, in
the Cloudflare dashboard:

- **D1 rows written / day** — the binding constraint. Under v3 the dominant write path is
  `/commands` batches (plus raid/Epic Boss settlement and presentation writes), not the retired
  per-flush save. The client coalesces gameplay into batches — the rollout doc's smoke check is
  fifty farm commands settling in no more than six `/commands` requests per minute.
- **D1 rows read / day**, **database size**.
- **Worker requests, CPU time, error rate (5xx).**

Rate-limit counters use the Cloudflare Rate Limiting **binding** (no D1 writes); the
D1 fallback only runs if the binding is unavailable. So throttling does not itself
consume the write budget.

---

## 4. Response procedures

All commands target the remote DB; add `--remote` (omit for local dev). Replace
`ACCT` / `SID` with the id from the log line.

**Revoke one stolen session** (from the device list, or by id):
```sh
wrangler d1 execute zombiefarm --remote \
  --command "UPDATE sessions SET revoked_at = strftime('%s','now')*1000 WHERE id = 'SID'"
```

**Sign an account out everywhere** (revoke all its sessions):
```sh
wrangler d1 execute zombiefarm --remote \
  --command "UPDATE sessions SET revoked_at = strftime('%s','now')*1000 WHERE account_id = 'ACCT' AND revoked_at IS NULL"
```
(Or call `POST /session/logout-all` as that account.) Sessions also idle-expire
automatically after `SESSION_IDLE_MAX_MS` (8 days; see `db.ts`).

**Rotate the session secret** — invalidates **every** JWT (all users re-login once).
Use on secret compromise or a broad token-leak scare:
```sh
wrangler secret put SESSION_SECRET
```

**Disable one abused route fast** — tighten its limiter to near-zero and redeploy
(edit the `rateLimit(...)` line in `index.ts`), or add an early `return c.json({error:"disabled"},503)`
at the top of the handler. Prefer this over taking the whole Worker down.

**Stuck gift claims** — the v2 deferred-`grants` model is retired along with `GET /save`, so
there is no longer a self-healing reconcile pass. Under v3 a gift claim is atomic
(`db.claimGiftBrain`); if it loses the account fence it logs `gift_claim_deferred`, returns
`409 operation_in_progress`, and **leaves the gift claimable in the inbox** for the client to
retry. Nothing is owed and nothing needs manual settlement. If the 409 repeats for one account,
the problem is a stuck writer fence, not the gift:
```sh
wrangler d1 execute zombiefarm --remote \
  --command "SELECT active_batch_id, active_batch_expires_at FROM account_runtime_v3 WHERE account_id = 'ACCT'"
```
An expired `active_batch_expires_at` that is not clearing points at a settlement that died
mid-operation; releasing the lease (or waiting out the TTL) unblocks the account.

**Quarantine / inspect a suspect account** — v3 gameplay state is server-owned and no longer
lives in the v2 `saves` blob (`GET`/`PUT /save` both return `410`). Inspect the authoritative
tables instead — `balances`, `roster_v3`, `gameplay_documents_v3`, `farm_documents_v3`,
`object_documents_v3`, `account_runtime_v3` — and read `audit_events_v3` for how the account
got there:
```sh
wrangler d1 execute zombiefarm --remote \
  --command "SELECT kind, created_at, detail_json FROM audit_events_v3 WHERE account_id = 'ACCT' ORDER BY created_at DESC LIMIT 50"
```
Repair balance, roster, object, quest, and raid rows together — restoring one in isolation can
leave an inconsistent or exploitable account.

**Restore data** — D1 supports point-in-time restore (Time Travel). Find a bookmark
before the incident and restore:
```sh
wrangler d1 time-travel info zombiefarm --remote
wrangler d1 time-travel restore zombiefarm --remote --timestamp "<ISO8601>"
```

**Quota approaching the daily D1 write limit** — the game is offline-first, so shed
server load without breaking play: raise the client save cadence (increase
`SaveManager` debounce / max-dirty), and/or tighten write-route rate limits. No data
loss — the local save keeps the player whole until writes resume.

---

## 5. After any incident

1. Confirm the triggering `sec`/`lvl` rate has returned to baseline (`wrangler tail`).
2. If a client-side forgery got through, add a regression case to the integration
   suite so it can't recur silently — and add it to `v3.spec.ts` or `blackMarket.spec.ts`,
   which are the only two files `vitest.integration.config.ts` actually runs. A spec added
   elsewhere under `test/integration/` will never execute.
3. Note the event + response here if the procedure was missing or wrong.

---

## 6. Player-report forensics (read-only)

Settle a "my stuff disappeared" report from the audit trail before theorising about
client bugs. `audit_events_v3` records every durable command (`durableKinds` in
`src/v3/db.ts`) with its full command JSON and `createdIds`, plus one
`command_rejected` row per batch and a `zombie_created` row.

```sh
wrangler d1 execute zombiefarm --remote --json --command \
  "SELECT id FROM accounts WHERE username LIKE '<name>'"
wrangler d1 execute zombiefarm --remote --json --command \
  "SELECT kind, detail_json, created_at FROM audit_events_v3 \
   WHERE account_id='<id>' ORDER BY created_at DESC LIMIT 20"
```

Cross-check any `createdIds` against `roster_v3`; `locked_by_raid LIKE 'pot:%'`
identifies units currently reserved inside a Zombie Pot. `--json` output is prefixed by
a config warning banner, so slice from the first `[` before parsing.

Note that a Zombie Pot combine returns ONE unit, usually of slot 1's species: below level
25, combining two of a kind gives back one that looks identical to its parents, which is
reported as a loss far more often than it is one. At level 25+ a matched pair comes back
as that body type's silver (tier-4) instead, or rarely its tier-5 special.

### Verifying migration `0034_quest_45_popcorn_backfill`

It is a plain `UPDATE` outside the command pipeline's batch guard, so a player mid-batch
can be clipped. After applying, this must return 0; re-apply if it does not.

```sh
wrangler d1 execute zombiefarm --remote --json --command \
  "SELECT COUNT(*) AS still_owed FROM gameplay_documents_v3 g \
   WHERE json_extract(g.current_json,'\$.storage.received.\"Circus Popcorn\"') IS NULL \
     AND EXISTS (SELECT 1 FROM quest_documents_v3 q, \
                 json_each(json_extract(q.current_json,'\$.completed')) e \
                 WHERE q.account_id=g.account_id AND e.value='45')"
```

### Verifying migration `0035_headless_mutation_repair`

Clears head + hair/eye mutation bits (mask 951) from headless units, which the v3 combine
used to store even though the client strips them on load. It is a plain `UPDATE` on
`roster_v3`, so a player mid-batch can be clipped — re-running is a safe no-op.
After applying, this must return 0.

```sh
wrangler d1 execute zombiefarm --remote --json --command \
  "SELECT COUNT(*) AS v3_bad FROM roster_v3 WHERE (mutation & 951)!=0 \
     AND (zombie_key LIKE 'ZombieActorHeadless%' OR zombie_key='ZombieActorBombie')"
```

### Applying migration `0043_black_market_brain_payout`

The migration and the Worker deploy are a PAIR, and the order matters. The migration
backfills every order that is `FULFILLED` at the moment it runs as already paid
(`payout_at = closed_at`), because those brains were credited at settlement by the old
code. Any sale fulfilled AFTER the migration but BEFORE the new Worker is live is
credited by the old code *and* left `payout_at IS NULL`, so its seller would be paid a
second time when they collect.

Deploy the Worker straight after applying the migration, then close that window by
sweeping anything the old code settled inside it. `<deploy_epoch_ms>` is the moment the
new Worker went live:

```sh
wrangler d1 execute zombiefarm --remote --json --command \
  "UPDATE black_market_orders SET payout_at = closed_at \
   WHERE status='FULFILLED' AND payout_at IS NULL AND closed_at < <deploy_epoch_ms>"
```

Deploying BEFORE the migration is the worse order: the new code writes `payout_at` on
every fulfil, so the whole Black Market 500s on a missing column until the migration
lands. After both are in place this must return 0 — every unpaid row should be a sale
that settled under the new Worker and is genuinely waiting to be collected:

```sh
wrangler d1 execute zombiefarm --remote --json --command \
  "SELECT COUNT(*) AS suspect FROM black_market_orders \
   WHERE status='FULFILLED' AND payout_at IS NULL AND closed_at < <deploy_epoch_ms>"
```

### Applying migration `0045_black_market_gold`

Adds `black_market_orders.currency` and widens the price CHECK to 10,000,000, so a post
can be priced in gold. **Migrate first, then deploy** — the safe order, and unlike 0043
there is no window to sweep afterwards:

* Migration before Worker: every existing row backfills to `'BRAINS'`, which is what it
  was, and the old Worker keeps inserting brains posts (it never names the column, so the
  DEFAULT applies). Nothing behaves differently until the new Worker is live.
* Worker before migration: the new code names `currency` in its INSERT, so every post
  500s until the migration lands. Same failure shape as 0043.

The migration is a table REBUILD, and `black_market_receipts` cascades from the table it
drops — it is written in 0044's order (receipts dropped first) for that reason, and
rehearsed against real SQLite in `test/migration0045.test.ts`. After applying, the
receipts ledger must be intact and every pre-existing post must read as brains:

```sh
wrangler d1 execute zombiefarm --remote --json --command \
  "SELECT (SELECT COUNT(*) FROM black_market_receipts) AS receipts, \
          (SELECT COUNT(*) FROM black_market_orders WHERE currency NOT IN ('BRAINS','GOLD')) AS bad_currency"
```
