# Integration suite

These specs drive a **real `wrangler dev` Worker + local D1** over HTTP (`globalSetup.ts`
boots it once on port 8799). They are the only tests that exercise the Worker as
Cloudflare actually runs it — the unit suite imports modules directly and never boots
workerd.

That difference is not academic. A named export of a non-function from `src/index.ts`
(the Worker entry) makes workerd refuse to start:

```
Incorrect type for map entry 'X': the provided value is not of type 'function or ExportedHandler'
```

The unit suite cannot see that. This suite fails instantly on it.

Run with `npm run test:integration`.

## Which specs run

`vitest.integration.config.ts` uses a **glob**, so a new `*.spec.ts` in this directory
runs the day it is written. Opting out is the thing that has to be spelled out.

It did not always work that way. The config used to name two files explicitly, so 19 of
21 specs silently did not run while CI reported the suite green. Most were legitimately
dead — they drove protocol-v2 routes that now answer 410 — and have been deleted
(`combine`, `farm`, `fertilize`, `objects`, `quests`, `roster`, `shop`,
`stateConsistency`, `zombieField`). But `smoke`, `sessions` and `raidGates` were not
dead: they cover live v3 routes and had gone dark alongside them, with nothing recording
the loss. Both `sessions` and `raidGates` needed real repairs when they were brought
back — the game had moved under them while nothing was running them.

## Still excluded, and what that costs

Four specs remain excluded because they are written against retired v2 routes. Each is
listed with the **live** surface it would cover, so the gap is a decision rather than an
accident. Porting one means swapping its v2 setup for `grantBalance` / `grantRoster` and
its v2 mutations for `commandBody` + `POST /commands` (see `raidGates.spec.ts`, which is
the worked example).

| Spec | Live routes it would restore | Already covered elsewhere? |
| --- | --- | --- |
| `api.spec.ts` | `/friends/block`, `/logout`, `/session/logout-all` | Partly — `v3.spec.ts` covers friend add/accept/requests and the whole gift flow. **Block and logout-all are covered nowhere.** |
| `raidLoot.spec.ts` | `/raid/checkpoint`, loot rolls on `/raid/finish` | No. `/raid/checkpoint` has **no integration coverage at all**. |
| `raidRewards.spec.ts` | reward/XP math on `/raid/finish` | Partly — `v3.spec.ts` settles raids but does not assert the payout curve. |
| `inventory.spec.ts` | boost consumption across `/raid/start` → `/raid/finish` | Partly — unit tests cover the catalog; nothing covers the round trip. |

The highest-value port is `raidLoot.spec.ts`: `/raid/checkpoint` is a live, unverified
route on the money path.

## Conventions

- **Isolate by account, not by database.** One Worker and one D1 are shared for the whole
  run, so every spec gets fresh accounts via `signIn(uniqueSub("prefix"))`. Never reuse a
  `devSub` across tests.
- **Only one session per account may hold the writer lease.** A second device must use
  `signIn(sub, false)`, or its acquire is refused with 423.
- **`grantRoster` files units in the Mausoleum by default.** Pass `stored: false` for a
  zombie that needs to be deployable, or `/raid/start` answers `unit_not_owned`.
- **Read a fresh `/bootstrap` before every `/commands` batch.** The envelope is fenced on
  `accountVersion`; a stale one is refused, not applied.
