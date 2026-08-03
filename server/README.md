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
- `GET /black-market/orders`, `GET /black-market/summary`, `POST /black-market/orders`,
  `POST /black-market/orders/:id/cancel`, `POST /black-market/orders/:id/fulfill`
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
(`stale_ruleset`, currently `RAID_RULESET_VERSION = 10`) are defense-in-depth on top of the
replay, not substitutes for it.

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
- Player-to-player trading now ships as the Black Market, which makes value transferable
  between accounts. Keep it behind `BLACK_MARKET_ENABLED` in any environment where the
  release gates in `../SECURITY.md` have not been confirmed.
- Paid currency, competitive rankings, and PvP must remain disabled until those gates pass.
- A raid and an Epic Boss fight are mutually exclusive: `/raid/start` rejects with
  `409 raid_in_progress` while an Epic Boss session is live, and vice versa.

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
local sign-in without the Google popup. **Never deploy with `DEV_AUTH=1`.**

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

## Operational notes

- CORS permits `ALLOWED_ORIGIN` plus the local development origins. CORS is a browser
  boundary, not an anti-cheat control.
- Cloudflare rate-limit bindings throttle authentication, read, and write tiers. D1
  uniqueness and transaction guards remain the correctness controls.
- Multi-device command writes use single-writer account-version CAS. A takeover changes
  writer generation and makes the replaced device read-only.
- Repair balance, gameplay, quest, farm/object, roster, and raid state together. Restoring
  an individual JSON document can create an inconsistent or exploitable account.
