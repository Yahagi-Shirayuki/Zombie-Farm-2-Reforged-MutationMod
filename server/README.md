# Zombie Farm server

Protocol-v3 gameplay and social server built on a Cloudflare Worker (Hono) and D1
(SQLite). Identity is Google Sign-In verified server-side; the browser client calls
the API cross-origin from the deployed site (`ALLOWED_ORIGIN`, currently
`https://zombiefarmreforged.com`).

Both the ordinary command path and the raid path are server-authoritative. Residual
concurrency and audit gaps remain. Read `../SECURITY.md` before deploying or enabling
anything competitive or money-like.

The online server remains optional. With `VITE_API_URL` unset, the client runs in
offline-only mode and never contacts the Worker.

## Active protocol-v3 surface

Core routes:

- `GET /` — unauthenticated health probe
- `POST /auth` — Google ID token → session JWT
- `POST /bootstrap` — gameplay + presentation + writer + social + resumable-raid projection
- `POST /commands` — allowlisted semantic command batch (account-version CAS)
- `PUT /presentation` — versioned presentation-only document
- `POST /writer/acquire`, `POST /writer/release`, `GET /writer/status` — exclusive writer lease
- `POST /raid/start`, `POST /raid/finish`, `POST /raid/revive`
- `POST /epic-boss/activate|end|start|finish`
- `GET /black-market/orders`, `GET /black-market/summary`, `GET /black-market/fulfillments`,
  `GET /black-market/history`, `POST /black-market/orders`,
  `POST /black-market/orders/:id/cancel`, `POST /black-market/orders/:id/fulfill`,
  `POST /black-market/orders/:id/collect`, `POST /black-market/orders/:id/repost`
- `GET /me`, `POST /username`, `POST /session/refresh`, `POST /logout`,
  `POST /session/logout-all`, `GET /session/list`, `POST /session/revoke`
- `GET /friends`, `GET /friends/requests`, `GET /friends/:id/save` (read-only visit projection),
  `POST /friends/add|accept|reject|remove|block`, `POST /friends/code/rotate`
- `POST /gifts`, `GET /gifts/inbox`, `POST /gifts/claim`
- `POST /dev/fixture/*` — DEV-only test fixtures, gated by `DEV_AUTH`

`/commands` applies allowlisted semantic gameplay commands against server-held state
using an account version, writer generation, sequential commands, and a D1 transaction
guard. Presentation state is stored and versioned separately. Historical v2 save,
state-sync, action, and raid-checkpoint routes are authenticated but return
`410 update_required`.

`/raid/start` pins the combat config (enemy set and player roster, built from
server-owned tables and catalogs) into the session row. `/raid/finish` accepts
`{ sessionId, finalTick, inputs, clientWin?, clientLosses? }`. The outcome is derived by
replaying that input transcript against the pinned config (`src/raidVerifier.ts` →
`src/raid/replay.ts`), and rewards are priced from the server catalog against the replayed
survivor ratio. An elapsed-time gate (`future_finish`) and ruleset-version pinning
(`stale_ruleset`, currently `RAID_RULESET_VERSION = 39` — declared once in
`src/raid/replay.ts` and imported by both sides) are defense-in-depth on top of the replay,
not substitutes for it. `/epic-boss/start` performs the same handshake and refuses a
mismatched client with `426 stale_ruleset` before charging a token or a brain.

The optional `clientWin` / `clientLosses` fields exist because the Beach crab and Circus
trapeze hazards run **client-only** — `raidVerifier.grabberOf` returns `null`, so the server
replays the un-harassed fight, which is an optimistic ceiling. They are merged strictly
one-way (`win = !retreated && replayOutcome.win && !conceded`; conceded deaths are
intersected with zombies the replay brought home alive), so a client can only concede a
worse result for itself. Epic Boss finishes use the same replay path and have **no**
concession field.

## Current security restrictions

- If a transcript fails replay with `truncated_transcript`, `illegal_bubble`,
  `illegal_ability`, `illegal_wall_tap`, or `input_after_finish` **and** the client conceded, the finish settles
  as a synthesised zero-reward loss instead of rejecting, skipping roster-partition
  validation. It grants nothing, but it is a gap in "every settlement is replay-verified"
  and is recorded in the audit ledger.
- `MIN_PROTOCOL_VERSION` gates `/commands` only; other mutation routes are gated by the
  writer lease's `X-Integrity-Version` / `WRITER_LEASE_MODE` check. Use `MUTATIONS_DISABLED=1`
  to stop commands, presentation writes, and the raid, Epic Boss, and Black Market mutation
  routes during an incident.
- A **planned** closedown uses the `service_state` row instead (migration `0042`, read by
  `src/serviceState.ts`). See "Service closedown" below.
- Player-to-player trading now ships as the Black Market, which makes value transferable
  between accounts. Keep it behind `BLACK_MARKET_ENABLED` in any environment where the
  release gates in `../SECURITY.md` have not been confirmed.
- Paid currency, competitive rankings, and PvP must remain disabled until those gates pass.
- A raid and an Epic Boss fight are mutually exclusive: `/raid/start` rejects with
  `409 raid_in_progress` while an Epic Boss session is live, and vice versa.

## Service closedown (beta → full release)

`service_state` (one row, migration `0042_service_state.sql`) holds a planned-closedown
switch that the local admin console flips over D1 — **no Worker deploy**, which matters
because that console's Cloudflare token is scoped to D1 read/write only. `MUTATIONS_DISABLED`
remains the incident lever and still wins over anything here.

| `mode` | `/auth` new account | `/auth` existing | Reads (`/bootstrap`, `GET /friends`, …) | Gameplay + social writes |
|---|---|---|---|---|
| `open` | yes | yes | yes | yes |
| `signups_closed` | **403 `signups_closed`** | yes | yes | yes |
| `export_only` | 403 | yes | **yes** | **503 `mutations_disabled`** |
| `closed` | **503 `service_closed`** | **503** | n/a (no session) | n/a |

`export_only` is the beta→release window. Reads deliberately stay up: an Online Farm keeps
no full save blob on the device, so the client can only serialise a farm it has hydrated
from `/bootstrap`. The client reads the mode from the unauthenticated `GET /` probe
**before** the farm chooser, shows "Export My Online Farm", and — after sign-in and a
read-only load — hands the player a screen that downloads their farm (`src/exportOnly.ts`).
That file is byte-for-byte what Settings' Export already writes, so Local Farm's existing
Settings → Import is the only thing needed to load it; nothing new can ingest it and an
export can never travel back online. Local Farm is untouched in every mode and keeps
receiving app updates through the service worker.

Writes halted in `export_only`/`closed`: `/commands`, `PUT /presentation`, `/raid/*`,
`/epic-boss/*`, `/black-market/*`, `/gifts`, `/gifts/claim`, and the `/friends/*` mutations.
Gifts and friend changes are included on purpose — a gift claimed after a player exported
would silently make their exported copy wrong.

Operational notes:

- The Worker memoises the row for **~30 s per isolate**, so a flip reaches players within
  about half a minute. It is not instant and does not need to be.
- Reads **fail open**: a missing table (Worker deployed ahead of the migration) or a D1
  blip serves `open`. Locking the whole player base out of a running service is the worse
  mistake of the two.
- `GET /` publishes `serviceMode` and `serviceNotice`. `service` keeps its literal
  `"zombiefarm"` value — the admin console's uptime probe matches on it.
- `notice` (≤ 240 chars) replaces the client's built-in copy on the start screen.

Flip it by hand with:

```sh
wrangler d1 execute zombiefarm --remote   --command "UPDATE service_state SET mode='export_only', notice='Back for the full release!', updated_at=$(date +%s000) WHERE id=1"
```

## Local development

```bash
cd server
npm install
cp .dev.vars.example .dev.vars
npm run db:apply:local
npm run dev
```

The local Worker runs at `http://127.0.0.1:8787`. In the repository root, copy
`.env.example` to `.env.local` and run the client with `npm run dev`.

With `DEV_AUTH=1`, the client exposes `window.zfDevSignIn(sub, name)` for automated
local sign-in without the Google popup. **Never deploy with `DEV_AUTH=1`** — the one
exception is the staging Worker below, which is a separate deployment with its own
database and exists precisely so test accounts never touch prod.

Validation commands:

```bash
npm run typecheck
npm test
npm run test:integration
```

## Production setup

1. In Google Cloud, create an OAuth 2.0 Web client and add the Pages origin and local
   development origin to Authorized JavaScript origins.
2. Create the D1 database and place its ID in `wrangler.toml`.
3. Follow `../docs/PROTOCOL_V3_ROLLOUT.md`. Protocol v3 uses a destructive reset and
   intentionally has no legacy data migration.
4. Store `SESSION_SECRET` with `wrangler secret put SESSION_SECRET`; never commit it.
5. Set `GOOGLE_CLIENT_ID`, `ALLOWED_ORIGIN`, `DEV_AUTH=0`, and the operational protocol
   variables in `wrangler.toml`.
6. Deploy the Worker and client in the documented order, then perform the authenticated
   smoke checks before enabling mutations.

## Staging environment

A fully separate Worker + D1 database for testing server features on real Cloudflare
infrastructure without risking prod. Defined as `[env.staging]` in `wrangler.toml`
(named environments inherit almost nothing — its bindings and vars are all redeclared
there). Live at `https://zombiefarm-server-staging.zombiefarm.workers.dev`, database
`zombiefarm-staging`.

- Deploy: `npx wrangler deploy --env staging` (plain `npx wrangler deploy` still
  targets prod — the top-level config is untouched).
- Config mirrors prod except `DEV_AUTH=1` (sign in via `window.zfDevSignIn`, no
  Google) and `ALLOWED_ORIGIN=http://localhost:5173`.
- To point a local client at it, set `VITE_API_URL` to the staging URL in `.env.local`.
- New migrations: `npx wrangler d1 migrations apply zombiefarm-staging --remote
  --env staging`. The database was initialized via the fresh path (`schema.sql` +
  `scripts/baseline-migrations.sql` — see `migrations/README.md`), so only migrations
  added after the baseline apply. Because prod upgrades in place while staging was
  built fresh, always rehearse a new migration against a prod snapshot too; passing
  on staging alone doesn't prove the upgrade path.
- Staging's data is disposable; there is no prod-data copy step.

## Operational notes

- CORS permits `ALLOWED_ORIGIN` plus the local development origins. CORS is a browser
  boundary, not an anti-cheat control.
- Cloudflare rate-limit bindings throttle authentication, read, and write tiers. D1
  uniqueness and transaction guards remain the correctness controls.
- Multi-device command writes use single-writer account-version CAS. A takeover changes
  writer generation and makes the replaced device read-only.
- Repair balance, gameplay, quest, farm/object, roster, and raid state together. Restoring
  an individual JSON document can create an inconsistent or exploitable account.
