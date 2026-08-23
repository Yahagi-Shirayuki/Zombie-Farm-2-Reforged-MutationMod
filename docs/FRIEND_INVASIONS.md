# Friend Invasions (PvP)

**Status: BUILT, VERIFIED, PARKED.** The whole feature — server, client, tests — shipped
to staging on 2026-08-23 and was played end-to-end there. It is currently switched OFF
in every deployed environment while the interface is redesigned; nothing was removed.
This document is the record of what exists, why it is shaped the way it is, and the
open questions for the redesign.

## How to turn it back on (and off)

Two switches, flipped together:

| Switch | Where | Off | On |
|---|---|---|---|
| `PVP_ENABLED` | `server/wrangler.toml` `[vars]` (staging) **and** `[env.production]` — then deploy | `"0"` | `"1"` |
| `PVP_UI_ENABLED` | `src/raid/pvp.ts` | `false` | `true` |

Deploy the **Worker first** (the client handshake tolerates a newer server; a newer
client against an old server refuses cleanly). Local dev and the integration suite keep
the flag ON (`server/.dev.vars`, `server/test/integration/wrangler.test.env`), so the
feature stays tested while parked.

Asymmetries built into the off state, on purpose:
- `/raid/pvp/start` refuses with `503 pvp_disabled`; **`/finish`, `/collect` and
  `/history` stay live**, so a fight in flight at switch-off still settles, an earned
  defense reward stays claimable, and history stays readable.
- The client hides every surface (`PVP_UI_ENABLED`): the Invade button in the friend
  drawer, the "⚔ Friend invasions" section of the Friends panel, and the launch hook.

## What the feature is (as built)

- From the Friends panel, each friend's drawer has **Invade ⚔**. The attacker picks
  **exactly 8** zombies in attack order (`Hud.openPvpArmy` — a trimmed cousin of the
  raid army screen: no cooldown, no vouchers, no battle boosts).
- The fight runs on **Old McDonnell's stage** (backdrop, barn, music) against a
  **snapshot of the defender's deployed roster**: their strongest 16 non-crypt zombies,
  emerging weakest-first under a mild swarm cadence (3 on the field, +1 every 5 s).
  Defenders render with their real farm rigs — mutations, tints, names — mirrored to
  face the attackers.
- **Nobody loses anything.** The defender is only ever a snapshot; the settlement path
  touches no roster row, no balance, no cooldown, and offers no revival. There is no
  gold/XP/loot — the reward is **boost bundles**, priced by the difficulty of the
  OPPOSING army (attacker paid from the defense score, defender from the attack score).
  Only tier 5 pays a Brain Ticket.
- PvP always fights at **full focus** (concentration pinned on both sides): no
  focus-bubble minigame, so a transcript is just ability taps + retreat.
- A held defense parks a **claim-on-login reward** for the defender, surfaced in the
  Friends panel's invasions section with a Claim button (Black-Market `collect` shape —
  the defender's account is never written while they are away).
- Anti-collusion for a zero-risk mode: attacks are **friends-only**, capped at
  **3 OPENED attacks per friend per UTC day** (starts count, not wins), one live
  session per attacker, 15-minute TTL on an abandoned one.

## The architecture (read before touching)

**The one idea everything hangs off:** `/raid/pvp/start` builds and pins the ENTIRE
fight config server-side and the client **adopts it wholesale** — both armies as
materialised `CombatUnit`s, the wave cadence, the difficulty scores, both reward
tiers. The client builds its `RaidScene`/`BattleSim` from those exact units. No
per-side derivation → nothing to keep in sync → the ordinary deterministic-replay
verifier settles the fight (`verifyRaid`, same as raids: server replays the transcript;
`clientWin` is a pure concession). The PvP feature itself required **zero BattleSim
changes and no ruleset bump** — a defender zombie is just an enemy-team `CombatUnit`.

Invariants that were chosen deliberately (do not "fix" them):
- Defender units keep their **player-side 2 s/dex attack clock** (an enemy slot would
  halve it — same zombie, same strength on either side). Their full-team auras are
  pre-baked and `teamAuraStats` stripped (the sim's aura refresh walks players only);
  `abilities` are `[]` (nobody is home to tap them); Protect's damage reduction
  survives. Ids re-minted `d0..dN` so nothing downstream mistakes them for roster ids.
- The defense snapshot ignores raid locks (a zombie mid-raid elsewhere still stands on
  the farm being copied) and includes presentation names for both sides.
- The difficulty score is `Σ maxHp × sustained dps` over the built units
  (`armyScore`), so mutations, veterancy, auras and farmer heads all count and a
  token defense scores low whatever level its owner is. It is pinned at `/start`
  along with both reward tiers, so a payout can never be re-priced at finish.
- Boost grants ride the settlement batch (the trusted-subsystem path
  `server/src/inventory.ts` demands — there is deliberately no public grant).
- The verified transcript is **stored** on the session row (`inputs_json`, ≤32 KB) —
  the "watch attacks on your farm" viewer only needs a playback mode, not new data.

First playtests surfaced two GENERAL engagement bugs, fixed as **ruleset v40**
(see `src/raid/replay.ts`'s changelog): (a) a Garden zombie with no healing ability
now fights instead of stationing (`isGarden` is the support flag, not the body type);
(b) a line enemy with an empty melee ring strikes the front-most front-band zombie
standing at its slot. The v40(b) scoping limits (standing / front band / line enemies
only) are **measured** — the unconditional version cost +49% on ordinary Video Games
difficulty via the turned pixel zombie. Elite profiles did not move.

## Where everything lives

| Piece | File |
|---|---|
| Shared rules: switch, scores, tiers, defense conversion, synthetic RaidDef | `src/raid/pvp.ts` (+ `src/raid/pvp.test.ts`) |
| Server config builder (both armies from D1, offline-safe) | `server/src/raidVerifier.ts` `buildPinnedPvpRaid` |
| Server routes' logic: start / finish / history / collect | `server/src/v3/pvp.ts` |
| Route wiring, rate limits, `PVP_ENABLED` gate | `server/src/index.ts` (`/raid/pvp/*` — under `/raid/` so auth + writer fencing apply) |
| Session/result/transcript table | `pvp_sessions_v3` — migration `0055`, mirrored in `schema.sql` |
| Client API calls | `src/net/api.ts` (`pvpStart/pvpFinish/pvpHistory/pvpCollect`) |
| Launch + settlement flow | `src/main.ts` (`hud.onInvadeFriend` → `launchPvpBattle`) |
| Army picker, Invade button, invasions section | `src/hud.ts` (`openPvpArmy`, friend drawer, `renderPvp`) |
| Defender-rig rendering + mirrored facing + art-loader gate | `src/raid/RaidScene.ts` (the `zombieRig` test in `makeToken`) |
| End-to-end server tests | `server/test/integration/pvp.spec.ts` |

The audit that preceded the build (subsystem map, phase plan) is in the session
history of 2026-08-23; the phases below are its remainder.

## Verified behaviour (what the tests pin)

- Start gates: friendship, ruleset handshake, exactly-8 owned deployed units,
  `no_defense` for an empty farm, one live session, the daily pair cap.
- A finish with `finalTick 0, inputs []` settles by pure server simulation (the
  overrun path) — the integration spec wins a fight that way and checks the boost
  grant lands in inventory; idempotent replays return the same settlement.
- A retreat holds the defense; the defender's history row is claimable exactly once,
  only by the defender, only for a held defense.
- The pacing gate (`future_finish`) was tripped live by a time-compressed submission
  during verification — the anti-cheat works against real speed-ups.
- Sim-level: defense conversion preserves per-unit combat numbers; a
  defense-vs-attack fight is deterministic from an empty transcript and finishes
  inside the replay cap.

## Known rough edges (part of why it is parked)

- **The interface is minimal.** Invade lives in a friend-row drawer; the history +
  claim UI is a plain list block in the Friends panel; the result panel is the raid
  results panel with zeroed rows; the enemy team badge is an empty circle (no
  defender portrait).
- A fight whose last survivor is a **true healer** stalemates to the 4-minute cap
  and scores as a loss (the healer stations out of everyone's reach; same behaviour
  as normal raids — the cap handles it, but it reads poorly).
- No "you were invaded" notification — the defender discovers history only by
  opening the Friends panel.
- Reward tier thresholds (`PVP_TIER_THRESHOLDS`) are first guesses. Measured
  reference: a level-18 8-zombie attack ≈ 190k, its 10-zombie defense ≈ 268k →
  tier 3 of 5.
- Fights are semi-auto (concentration pinned): the attacker's inputs are ability
  taps and retreat only. Fine for v1, thin as a game.

## Design space for the rework (from the original audit + playtest)

- **Interface**: a dedicated invasion panel (pick a friend → see their defense and
  its difficulty score/tier BEFORE committing; attack history and defense claims in
  one place) instead of the friend-drawer + list blocks.
- **Defense authoring**: let the defender arrange their defense (order, who's in it),
  rather than auto-snapshotting the strongest 16.
- **Watch the replay**: transcripts + configs are already stored; needs a RaidScene
  playback mode (inject recorded inputs at their ticks, interaction off). Mind
  ruleset staleness — a stored v40 replay is only re-playable on a v40 client.
- **Attacker kit** (audit Phases 3–4): the purchasable/upgradable ability; upgradable
  projectiles including mini-zombie throws (all-new sim mechanic — projectiles are
  boss-only today; the alien summon machinery is the precedent for
  spawn-on-landing).
- **Reward loop**: preview the tier before attacking; defender reward notification;
  whether attacking should cost something (a ticket?) once rewards are tuned.
