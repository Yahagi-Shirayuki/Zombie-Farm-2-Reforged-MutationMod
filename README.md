# Zombie Farm Reforged

A browser-based reimplementation of **Zombie Farm 2**, built from the mechanics,
data, and assets organized in `../ZF2R_extracted/`. When online services are
configured, the title screen offers two deliberately independent farms:

- **Local Farm** — fully client-side, saved only in this browser, with no account
  or gameplay server required.
- **Online Farm** — Google-authenticated and server-authoritative, with cloud
  saves, friends, gifting, the Black Market, and friend-farm visits.

The farms never merge, overwrite, or silently fall back to one another. A build
without online configuration opens Local Farm directly.

The project blends original-game fidelity work (recovered mechanics, art, and
combat numbers) with new "Reforged" additions (the online/social layer).

## Play it

**Nothing to install — the game is live at <https://zombiefarmreforged.com>.**
Choose **Local Farm** on the title screen to play without an account.

## Quick start (run it yourself)

You need [Node.js](https://nodejs.org) 18 or newer, and nothing else. Every game
asset is committed, so a clone is self-contained — no extraction step, no Python,
no database, no account, no server.

```bash
git clone https://github.com/actualdoctornerd-ai/Zombie-Farm-2-Reforged.git
cd Zombie-Farm-2-Reforged
npm install
npm run dev
```

Open <http://localhost:5173>. You'll land straight in **Local Farm**, saving to
`localStorage`. A first-run tutorial walks you through plow → plant → harvest → raid.

The clone is ~90 MB of art and audio, so expect it to take a minute. Full details,
including the online layer, are in [Run It Locally](#run-it-locally); if something
goes wrong, see [Troubleshooting](#troubleshooting).

## License

The original source code and documentation in this repository are available
under the [MIT License](LICENSE). The third-party game assets described under
[Asset Provenance](#asset-provenance) are excluded and remain subject to their
owners' rights.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the
checks to run, and what makes a change easy to review. Open an issue before starting
anything large. The [Current Gaps](#current-gaps) list is the best place to find
already-scoped work. Security bugs go through private disclosure, not public issues
([SECURITY.md](SECURITY.md)).

## Status

A broad playable prototype: farming, placed objects, storage, owned zombies,
mutations, quests, live invasions, Epic Bosses, cloud saves, friends, gifting,
the Black Market, and read-only farm visits all exist. It is **not**
content-complete or fully faithful to every original system. The biggest
remaining work is raid fidelity polish, missing QoL menus, and broader asset
integration.

### Where the docs live

Everything a contributor needs is in this repo:

| Doc | Covers |
|---|---|
| [README.md](README.md) | This file — what's implemented, gaps, how to run it |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to set up, test, and open a pull request |
| [SECURITY.md](SECURITY.md) | Anti-cheat posture, threat model, release gates |
| [PROVENANCE.md](PROVENANCE.md) | What this is derived from, and what it is not |
| [server/README.md](server/README.md) | API surface, local Worker setup, ops notes |
| [server/RUNBOOK.md](server/RUNBOOK.md) | Incident response and operational procedures |
| [docs/](docs/) | Per-system deep dives (Epic Bosses, Black Market, protocol rollout, recovered mechanics) |

Some **source-extraction** references (the disassembly notes, the raw mechanics
audit, and the phased roadmap) live outside this repo under `../ZF2R_extracted/`,
because they are bound up with the extracted commercial game bundle and are not
redistributable. You do **not** need them to contribute — anything load-bearing that
comes out of them gets written up in `docs/mechanics/` here. If you hit a gameplay
question that only those notes can answer, open an issue and ask; the answer will be
copied into the repo rather than left external.

## Documentation Rule

When changing gameplay behavior, generated asset coverage, menus, save schema, the
online/social layer, or deployment, update this README **in the same change**. If a
change adds or removes a known gap, update the "Current Gaps" section below so nobody
works from stale assumptions. Security-relevant changes to the server or raid path
must also update [SECURITY.md](SECURITY.md) and [server/README.md](server/README.md).

## Implemented

### Farming and economy
- 30x30 isometric farm rendered from generated field data with camera pan/zoom.
- Modular farmer, walk/work animation, click-to-walk, pathing around placed objects.
- Free-placed 4x4 plots with plow, plant, harvest, zombie-hole, and offline timers.
- **Multi-plot plow selection**: drag to preview a rectangle of 4x4 plots (invalid plots stay visible in red and are skipped) and commit them as one batch of plow jobs. On touch the preview can be repositioned and resized with edge handles before a confirming tap.
- Queued farm jobs keep advancing while the browser tab is hidden, and jobs replayed from elapsed offline time are stamped at their real completion moment, so growth timers stay accurate across backgrounding.
- Local and Online Farms persist unfinished farmer jobs across close/reopen and replay them from elapsed wall time; Online Farm revalidates restored intentions against authoritative state.
- Mobile crop-dragging previews every queued planting tile immediately, and a background/blur transition commits the completed stroke before suspending it.
- Objects placed against the farm's south/east edge (notably fruit trees) are harvestable — their walk-to point is clamped onto the grid, and a job with an unreachable destination cancels instead of jamming the queue.
- Fruit trees expose their live regrowth countdown in the same desktop hover card used by crops, switching to “Ready to harvest” when the timer expires.
- Farm purchases and harvests show their gold/brain and XP feedback as sequential floating rewards, matching the original game's cadence.
- Source-derived crop and zombie catalogs with level/currency/grave gates.
- Local gold, brains, XP, level curve, item economy, and level-up unlock popup. A new farm starts with 400 gold and **1 brain** (the tutorial spends it on Insta-Grow).
- **Selling always pays gold.** Gold-bought placeables refund 20% of cost; gold zombies return half their cost (minimum 1). Anything bought with brains — placeables or zombies — pays **1,000 gold per brain** of its original cost, so a 5-brain special zombie sells for 5,000 gold. Nothing refunds brains.
- Buying with brains grants derived XP (`cost × 100` for decor and trees, `cost × 80` for functional items); gold purchases still grant the authored Market XP.
- Persistent placeable objects, fruit trees, storage sheds, Mausoleum, graves, monoliths, Zombie Patch, and Zombie Pot.
- A placed Plowing Monolith makes plowing free, removes the normal plow XP reward, and adds +1 XP to crop and zombie harvests. Fruit trees do not grant harvest XP.
- The five functional Monoliths share one source texture and are distinguished by their authentic per-item Market color, carried in the placeable catalog and applied as a multiplicative tint to the Market card, the placement ghost, and the placed object.
- **Functional items are limited to one owned copy** (the Zombie Pot allows three), counting placed and stored copies together; a maxed item disappears from the Market list. Functional items are also permanent — they can be moved, rotated, and stored, but never sold.
- The Remove tool confirms before selling a placed object or clearing a planted plot (which forfeits the growing crop).
- Market with Crops, Items, Upgrade, Boosts, Farmer, Pets, and Epic Boss tabs, plus a name-search box and a themed pager on the card lists (pages fit the visible grid so it doesn't scroll on desktop/tablet). On desktop the mouse wheel turns pages, requiring a deliberate accumulated gesture so a trackpad's small events don't skip several at once.
- Farm Size upgrades (40/50/60 tiers grow the field + adjust backdrop/foliage/camera).
- Whole-farm ground/climate skins: owned terrains are stored in `GameState`, purchased in the Market Upgrade tab, repaint every tile via `Field.setClimate`, and can be re-applied for free later. The current climate is saved.
- Storage UI with Items, the owned-pet collection, Boosts, and Received tabs.
- **Earned zombies are never destroyed by a full farm.** An Epic Boss reward, rare raid drop, or (on a Local Farm) quest zombie that can't be deployed is filed in Received and claimed from there into a free Mausoleum slot, so it waits instead of overflowing storage. A copy waiting in Received still counts as owned for the one-per-farm unique limits. Black Market deliveries deliberately keep the old overflow, since the recipient may be offline and unable to make room.

### Zombies and mutation
- Owned zombies with per-type models/portraits, wandering, roster, detail cards, storage/deploy, selling (with confirmation), veterancy, mutations, and ability display. The Zombies list carries the same Locate/Deploy/Store/Sell actions as the inspect card, so the roster can be managed without hunting for each unit on the farm. Signed in, Sell offers a choice between immediate gold and posting the zombie to the Black Market.
- Dynamically rendered mutation portraits are checked for visible pixels before replacing the catalog fallback, avoiding transparent profile cards after a failed GPU extraction.
- Zombie stat breakdowns show each mutation, passive ability, and veterancy bonus as the actual displayed-stat increase for that zombie rather than as a generic percentage.
- Tapping a still-growing crop or zombie opens an info popup with its type, a live countdown to harvest, and an Insta-Grow button that spends one boost use to ripen it on the spot.
- Mutation/combination system (Zombie Pot): **slot 1 sets the output species** and slot 2 contributes only mutations (per-anatomical-slot bitmask inheritance, higher-tier bit wins a conflict). Named specials fit slot 1 only and are always inherited; at level 25+ a pair of the same species breeds up to that body type's silver (tier-4), and any eligible pair has a 10% chance to promote to slot 1's tier-5 special instead. Plus timers, mixed-color combined zombies, and field rendering. See [docs/SPECIAL_ZOMBIE_ACQUISITION.md](docs/SPECIAL_ZOMBIE_ACQUISITION.md).
- Farm zombies render at authored per-family scales (`src/zombie/displayScale.ts`) — Regular/Large/Headless 0.9, Female/Girl 0.8, Garden 0.7, Small 0.6 — with four tier-5 transformations keeping their smaller size. In raids, actors are contain-fit to a target height using *measured* native rig heights, so ordinary Headless bodies stay short while the near-full-height tier-5 Skull Head isn't shrunk.
- Headless zombies can't wear head or hair/eye mutations — with one exception that runs the other way: **Pumpking** (the level-23 crop) is the head they never had (+3 attack), and the only head mutation they can hold. It is also the only mutation whose *acquisition* is restricted rather than its wearability: **only a headless zombie can grow one**, and every other zombie gets one solely by inheriting it in the **Zombie Pot**, where as the highest head bit it wins the slot outright. Client and server enforce the same split — crop adjacency gates growing (`bitGrowable`), while every mask that lands on a unit gates wearing (`applyBodyTypeRestriction` / `legalMutation`).
- Kindlehead, Flamehead, and Party Zombie draw their missing heads as live procedural FX — a colored flame aura with rising motes, and looping confetti — on the farm and in raids. Large-group zombies get black eye disks with a small authored eyeball inset; head-replacing mutations now hide the base head on the farm, in raids, and in portraits.
- Deployed zombies show a thought bubble when an invasion is ready, a green cloud while fertilizing, and blend between walk and idle arm poses.

### Quests
- Quest engine loading all 105 shipped quest records (71 farm/raid + 34 Epic Boss), activating each when its prerequisite and level gate are met.
- Live quest events cover the farm loop (soil plowing, crop plant/harvest, zombie harvest, item purchase), raids/invasions (successful invasion, perfect invasion, raid loot), and the Zombie Pot combiner (combine + harvest).
- The quest detail popup shows the quest's reward (icon + amount) before you complete it.
- Completing a quest shows a celebratory "QUEST COMPLETE!" popup (quest icon + reward), styled like the level-up popup; multiple completions queue and show one at a time. Raid-driven completions are held until the player returns to the farm, so they never pop over the battle result screen.
- Open quest-detail and full quest-log panels rerender optimistic progress in place while farm actions are being queued and completed.

### Raids and combat
- Raid select, army select, **live battle scene** (there is no player-facing quick/instant resolve — the game always plays the fight out), result panel, cooldown, voucher, loot, and XP/gold/brain rewards, including first-clear XP and ability tier unlocks.
- Army-selection boost frontend: a **Concentration** toggle (bypasses the focus minigame) and a **Golden Dice** stepper (raises loot tier), both inventory-aware, consumed at raid start.
- Zombies that die in an invasion are culled from the roster + save, unless revived from the one-time post-battle **revival offer** (one brain per casualty, restored from a server-owned snapshot online); casualties not revived are permanently lost.
- Each invasion fights **one** stage, never a sequence of waves, and its enemies emerge one at a time by design. Old McDonnell's Farm ships a 7-stage difficulty ladder that steps one stage harder per player level past its recommended level (`fightStage`); the other ten raids ship a single authored wave, fought the same at every level, rather than an extrapolated ladder.
- Old McDonnell's boss throw cadence is eased over a new player's first two clears (2× the authored interval before the first win, 1.5× after it, authored cadence from the third). The pinned server config carries `priorWins` so the replay agrees.
- Rare raid zombies use an independent roll, separate from the ordinary weighted loot roll: Old McDonnell's Farm has a **1% chance to drop Old McZombie**, while Summer Break (the beach/Spring Break invasion), Tree World, and Valentine's Day each have a **0.8% chance** to drop Diver Zombie, Forest Zombie, and Teddy Zombie respectively. Online the roll is server-owned, and the unit is filed in Received when the active army is full.
- Side-view enemy actor art for all 11 raids. Ten use bone rigs from `public/assets/raids/enemies/models.json` (32 rigs); Video Games' five actors play real per-frame idle/attack animations. Eleven named enemy attacks (Circus, Lawyers, Pirate, Ninja, Robot) play **authored timelines recovered from `ZFAttackAnims`**, rotated so the source contact frame lands on the simulated hit; unmapped enemies fall back to a procedural lunge. Ninja/Pirate/City rigs are decoded from the iOS binary (their atlases have no TexturePacker plist — see `docs/mechanics/RAID_TIMING_AND_HAZARDS.md`). Raid particle FX (impact dust, victory confetti, heal).
- Zombies fight with two recovered basic attacks — bite (anim 8) and scratch (anim 9) — alternating per swing from a per-unit seed so the horde is staggered, each with its own strike SFX. Zombies also narrow their eyes while their deployment bar fills.
- Raid audio: per-stage battle BGM (farm/pirate/ninja/robot/alien themes, with `fightBGM` covering the other six raids) plus attack-keyed strike SFX (bite/poke/swipe/flail/punch) in both raids and Epic Boss fights.
- Winning any invasion replaces the battle loop with the recovered `winBGM` victory theme; remaining hazards disappear and release held zombies, thinking poses stop, and the surviving army marches fully off the right edge before results appear. Retreating zombies likewise march fully off the left edge.

### Online and social (Reforged)
- **Explicit Local/Online choice** — Local Farm and Online Farm use isolated storage and carry a persistent in-game mode badge. Settings returns to the chooser without moving progress between them.
- Leveling up resets the invasion cooldown in both Local and Online Farm; online resets are committed atomically with the XP award by the Worker.
- **Google account authentication** — Online Farm is gated behind Sign in with Google (`src/net/gate.ts`). The gate covers Online Farm *only*: the mode is chosen before auth is touched (`src/main.ts`), so Local Farm makes no account or gameplay-server call even when the browser still holds a valid session. A build with no online config never shows the chooser and opens Local Farm directly.
- **Local Farm profiles** — Local Farm supports multiple named save slots (create, rename, delete, switch). Switching flushes and suspends the outgoing save before reloading, so autosave can't write into the incoming profile. Online Farm has no profile picker; the account is the slot.
- **Offline view** — if the Online Farm bootstrap fails, the game can render from the last server-confirmed snapshot and says so ("Offline view; changes may be waiting to sync"). It never silently falls back to Local Farm; the recovery dialog offers a *separate* local farm as an explicit choice.
- **Player-chosen usernames** picked on first login.
- **Online state** across devices: the Cloudflare Worker owns protocol-v3 gameplay state, with an exclusive single-writer lease (token-hashed, account-version CAS), account-version conflict handling, an offline command outbox, and a local per-account cache.
- **Account activity tracking** records sign-in immediately and refreshes `last_online_at` from the active Online Farm writer heartbeat at most once per minute.
- **Server-verified raids**: `/raid/finish` replays the pinned combat from the submitted input transcript and derives the outcome server-side. Because the Beach crab and Circus trapeze hazards are client-only, the server replays the *un-harassed* fight and the client concedes the difference — concessions are merged one-way, so a client can only make its own result worse, never claim a win the replay didn't produce. All mutation routes are serialized through the writer lease. See `SECURITY.md` for the current anti-cheat posture and residual limits.
- **Friends**: friend codes, server-backed friend lists, **daily gifting** (sending awards 5 XP; the first two sends each day are free and later ones cost 100 gold each, with no ceiling on how many friends you can reach — each *friend* can receive one gift a day, and none at all while they still have an unopened one from you), and a **gift inbox** with claiming. A gift's contents are rolled by the server the moment it is *sent* and stored on it — nothing the recipient does can re-roll them — and stay hidden until it is opened: 10% a brain, otherwise 150 / 300 / 500 / 1000 gold (25/25/25/15%). The **first gift each player opens each UTC day is always a brain**, whatever it was rolled as. **Gift all** and **Open all** run the same per-gift path in a loop (still charged and fenced individually server-side); Gift all confirms the exact gold cost first and explains anyone it can't reach. Friend rows show level, how many gifts that friend has sent you, and a coarse last-seen bucket (`today` / `week` / `away` — the raw timestamp never leaves the server), and the list sorts by any of those.
- **Black Market**: server-authoritative buy/sell-zombie orders with brain/zombie escrow, caps of 10 open orders and 50 per day, price bounds, and atomic fulfillment. Buy orders can demand **specific mutations** (every requested anatomical slot must match; extras are allowed). Delivery is gated on the recipient — special zombies need player level 20, while Blue/Red/Silver classes unlock at their gravestone's level (1/15/25) without requiring the gravestone itself. Tapping a listing opens the full inspect card for that zombie, rendered through the *viewing* player's own unlocked abilities and farmer bonuses; level-locked listings stay inspectable. Filling a buy order asks which of your matching zombies to hand over rather than picking one for you.
- **Read-only friend-farm visits**: the client reloads into visit mode and the server returns an allowlisted projection of the friend's save (farm, objects, zombies, Zombie Pot only — currencies zeroed; progression, quests, raids, storage, and social data omitted). Autosave is disabled and editing controls are hidden while visiting.

### Platform and interface
- The Market's **Farmer** section supports independently equipping every owned source head and body. Unpriced parts start unlocked; priced heads use authoritative online purchases, and their listed harvesting, zombie growth/stat, and invasion-cooldown effects apply while equipped.
- The source-derived **Pets** catalog includes all 40 variants with their animations and post-brainflation prices (mostly 5 brains). The eight epic-boss pets are excluded from the store and remain obtainable only as boss loot. Purchases award XP equal to 100 times the final brain price. Pet purchase/selection is server-authoritative online; one selected cosmetic companion follows the farmer and has no gameplay effects.
- One responsive build for phone and desktop: capability autodetection (`src/platform.ts`), a compact touch HUD that collapses after you pick a tool, pinch-to-zoom/pan, `env(safe-area-inset-*)` padding, short-viewport and phone-landscape breakpoints, and Android Back handling.
- Touch input model (`src/touchInput.ts`): select taps resolve to the plot under *initial contact* (finger wobble across an isometric edge can't misfire), zombies need a 450 ms hold rather than a tap so an overlapping unit can't steal a plot tap, and pointer capture plus a native-pointerup fallback keep releases from being retargeted when the HUD collapses under the finger.
- **Drag-select plowing** (`src/plowSelection.ts`): tapping soil drops a 4x4 anchor preview; dragging repositions it and the corner/edge handles grow it into a rectangle; a second tap inside the preview commits every valid plot at once. Commit is deferred to pointer-up so one tap can never plow twice.
- **Installable PWA**: a web app manifest (`public/manifest.webmanifest`), maskable/Apple icons, and a `vite-plugin-pwa` service worker. The app shell, boot script, and title art are precached; `/assets` art and audio are cached `CacheFirst` on first fetch, while release-sensitive JSON catalogs use `NetworkFirst` with an offline fallback. Local Farm warms up progressively rather than downloading ~88 MB at install. Readiness copy distinguishes Local Farm's progressively cached assets from Online Farm's connectivity requirement. Update prompts immediately show installation progress and reload only after the new service worker confirms it has taken control, preventing a slow iOS activation from reopening the old cached build. The service worker is build-only; there is none in `npm run dev`.
- A one-time **"Play Fullscreen?"** offer on mobile after the boot overlay is dismissed (`src/ui/panels/fullscreenPrompt.ts`), skipped when already fullscreen or running installed/standalone. Settings also has a Fullscreen row and an `F` hotkey.
- **Diagnostics** (`src/diagnostics.ts`): uncaught errors and unhandled rejections are captured into a 20-entry ring buffer in `localStorage`, and Settings → Diagnostics copies a pasteable report (build id, browser, farm mode, captured stacks) for bug reports. It is **local-only and sends nothing anywhere** — deliberately, so Local Farm's no-network guarantee holds. Builds carry their commit SHA (`BUILD_ID`) and ship sourcemaps so those stacks are readable.
- Music, sound effects, and farm ambience are enabled by default and can be toggled independently in Settings. An optional **Mute When Unfocused** setting silences all channels while the game tab or window is in the background. The mandatory first-run tutorial uses real farm actions: plow, plant a zombie, buy and use Insta-Grow, harvest, then raid. Developer controls (a separate menu opened by an invisible hotspot beside the nameplate) support testing.
- The right-side **Farmer's Guide** is a responsive, chapter-based in-game knowledge base covering Local and Online saves, core farming and combat mechanics, social/community help, the open-source repository, and contributor acknowledgements.
- **Farm background** setting: foliage density choices (Deep Forest / Woodland / Light Meadow) persisted in `src/prefs.ts`. This changes the density of decorative surrounding foliage — distinct from ground/climate skins, which change the farm's tile terrain.
- A **ZF2 Sprites** setting is persisted in `src/prefs.ts`, but art swapping is not yet wired.

### Saving and testing
- Versioned, isolated persistence: complete Local Farm saves with a last-known-good backup and JSON export/import; server-authoritative Online Farm state with a per-account read-only snapshot, presentation cache, and durable command outbox.
- Automated Vitest suites exist for both client (`npm test`) and server (economy, loot, combat stats/prediction, mutations, Zombie Pot, ability unlocking, raid catalog/ordering, friend logic, and the server-side friend-visit save projection). Coverage is incomplete; the GitHub Pages deploy is gated by the client suite, and the Worker deploy is gated by migration validation, the server suite, and typechecking.

`window.ZF` exposes debug handles including app, world, field, farmer, zombies, state, HUD,
jobs, audio, save manager, quests, quest bus, raids, and helper functions (e.g. `ZF.runRaid`, which uses the retained headless resolver).

## Current Gaps

Qualifiers: *implemented*, *partially implemented*, *placeholder*, *disabled*, *missing*, *Reforged-only*, *fidelity approximation*.

- **Raids (partially implemented / fidelity approximation):** the ladder, live combat, boosts, and permanent casualties ship, but combat still needs status/focus polish and per-raid balance tuning. Boss **summon** reinforcements, the faithful **carrotWall/junkWall** blockers, the Circus **trapeze carried-grab**, and the **Beach crab** carry-off are wired — the crab and trapeze are client-only tap-to-rescue minigames the server does not simulate (see the concession note under Online and social). The **Lawyers cars** grab has no shipped sprite and is not wired. Note that a ground-crossing obstacle/grab hazard previously listed here as "disabled pending visual work" was **not a base-game mechanic** — it was fabricated during development and has now been removed from the code entirely.
- **Market/upgrades (partially implemented):** Farm Size and ground/climate skins work; authored **TMX map loading is missing**.
- **Quests (partially implemented):** the farm loop, raids/invasions, Zombie Pot, and every Epic Boss emit live events. Recovered Epic quest chains are selected for the active boss; some late bosses have incomplete or missing shipped quest data. Social, photo/camera, and seasonal quest classes remain dormant. A quest whose reward is a **zombie** is still deferred server-side (`completeQuest` records the completion but grants no unit), so those rewards only actually land on a Local Farm; currency and item rewards are granted authoritatively.
- **Epic Bosses (eight recovered bosses):** Market → Epic Boss offers Dr. Groundhog, Loco Locust, Bully Frog, Foul Owl, Skunkarella, Rocky Rhino, General Larvaelus, and Mystical Mamba as repeatable 14-day runs. Dr. Groundhog costs 5 brains and unlocks at **player level 24**; the other seven cost 10 brains and unlock at **level 32** (server-enforced). All use 30-second manual-focus fights, permanent casualties, retained damage, crop-harvested fight tokens (or 1 brain per attempt), scaling brain/gold victory rewards, namespaced loot, pets, and deterministic online replay. The first five use exact authored combat strips; EPB 8-10 use static recovered art until their missing atlas metadata can be reconstructed. See `docs/EPIC_BOSS_MECHANICS.md`.
- **Settings toggle — Sprites (placeholder):** the **ZF2 Sprites** switch persists a preference (`src/prefs.ts`) but does nothing yet. It needs a ZF1 art pack and a runtime swap keyed off `getSpriteSet()`.
- **QoL/UI (missing):** Received item cards/reveal/use flow and fuller settings controls are missing. The Farmer's Guide now provides the first in-game help pages, with more detailed topics still to come.
- **Assets (partially wired):** raid particle FX and raid/combat audio (per-stage BGM + attack-keyed strike SFX) are wired, but most other particles/VFX, title/loading/news/social promo art, most localization/fonts, many terrain tiles, and many stage assets are extracted but not wired. Specific unwired audio: `enrageBGM`, `locolocustbanjo`, `rockyrhinogong`, `taiko`, `resurrect`, `parrot`, `rain`.
- **Tests/CI (partially implemented):** Vitest suites exist for client and server; pull requests are gated by `.github/workflows/ci.yml` (client tests + build, server tests + integration + typecheck + migration check), and both deployment workflows are test-gated. Coverage remains incomplete — notably the HUD/DOM layer, which is largely untested.

## Run It Locally

The four commands are in [Quick start](#quick-start-run-it-yourself) above; this section
is the detail behind them. Requires [Node.js](https://nodejs.org) 18+ (CI runs 20). Python
is only needed to regenerate assets, and the server only if you're changing the online layer.

### Local Farm (no account, no server)

`npm run dev` serves on <http://localhost:5173> and saves to `localStorage`, never
contacting a server.

Vite loads `.env.local` in development but **not** `.env.production`, and `.env.local` is
gitignored — so a fresh clone has no online config at all. `isConfigured()` is false, the
Local/Online chooser never appears, and you go straight to Local Farm. Add a `.env.local`
(next section) only when you actually want the online layer.

### Online development build

To exercise the online layer (sign-in, cloud saves, friends), you also need the
server running and the client pointed at it via `.env.local`:

- `VITE_API_URL` — base URL of your local Worker (`wrangler dev` serves `http://127.0.0.1:8787`).
- `VITE_GOOGLE_CLIENT_ID` — a Google OAuth web client id. Leave blank to use the
  dev sign-in bypass (`window.zfDevSignIn`), which the Worker only honors while
  `DEV_AUTH=1` — the real Google popup can't be automated.

Run the server (from `server/`):

```bash
cd server
npm install
npm run db:apply:local   # create the local D1 schema
npm run dev              # wrangler dev on :8787
```

Then `npm run dev` in the repo root as above. See `.env.example` for all client
config; both online values are public (safe to commit).

### Production build

```bash
npm run build      # tsc + vite build → dist/
npm run preview    # serve the built dist/ locally
```

⚠️ **`npm run build` is not offline.** Unlike `npm run dev`, a production build reads the
committed `.env.production`, so the bundle points at the **live** Worker and the real Google
client id. Local Farm still works in that bundle, but choosing Online Farm will talk to
production, and sign-in will fail anyway because `localhost` isn't an authorized origin on
that OAuth client.

To build a bundle with the online layer compiled out entirely, create a file named
`.env.production.local` in the repo root (it's gitignored) containing exactly:

```
VITE_API_URL=
VITE_GOOGLE_CLIENT_ID=
```

Then `npm run build` as usual. With no API URL, `isConfigured()` is false: the chooser
never appears and the build opens Local Farm directly. `npm run preview` then serves it
on <http://localhost:4173>.

### Troubleshooting

**Cryptic errors during `npm install` or `npm run dev`.** Check your Node version with
`node -v` — it must be 18 or newer. There is no `engines` field in `package.json`, so npm
will *not* warn you on an old version; you'll just get confusing failures from Vite.

**Port already in use.** Both servers take a `PORT` override: `PORT=3000 npm run dev`
(dev defaults to 5173, `npm run preview` to 4173). On Windows PowerShell that's
`$env:PORT=3000; npm run dev`.

**The title screen asks me to sign in.** That means the build has online config. `npm run dev`
in a fresh clone should not — check whether a `.env.local` exists in the repo root and remove
it, or pick **Local Farm** at the chooser. If you built with `npm run build`, see the warning
above.

**Blank screen or missing art.** Assets load from `public/assets` relative to the page, so
open the URL the dev server prints rather than a `file://` path. If art is missing after a
`git clone`, confirm the clone finished — it pulls ~90 MB and a partial checkout is the usual
cause.

**Starting over.** Local Farm lives entirely in `localStorage`. Settings → Local Save → Reset
clears it in-game; the same panel has Export/Import if you'd rather keep a JSON backup first.

**Commands assume a POSIX shell.** `npm` commands work anywhere, but shell syntax in this file
(`printf`, `VAR=x cmd`) is bash. On Windows, use Git Bash or WSL, or translate to PowerShell.

## Tests

```bash
npm test                            # client suite — 71 files, 464 tests
npm run build                       # tsc typecheck + vite build

cd server
npm test                            # server unit suite — 22 files, 275 tests
npm run test:integration            # route-level integration — 2 files, 35 tests
npm run typecheck                   # tsc --noEmit
npm run migrations:check            # validate migration ordering/numbering
```

The integration suite boots a real `wrangler dev` Worker with local D1 and drives it
over HTTP (it can't use `@cloudflare/vitest-pool-workers` — that pool breaks on paths
containing a space). It is slower than the unit suites and runs single-threaded,
since every spec shares one Worker and database.

Note that `vitest.integration.config.ts` **allowlists** which specs run — currently
`v3.spec.ts` and `blackMarket.spec.ts`. The other files in `test/integration/` are
retired protocol-v2 specs that are not executed; don't assume a green run covered
them.

CI runs all of these on every pull request (`.github/workflows/ci.yml`). Run them
locally before opening one — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Deployment (GitHub Pages)

The GitHub Actions workflow (`.github/workflows/deploy.yml`) **triggers on a successful
CI run** (`workflow_run` on the CI workflow, `main` branch only) and checks out the exact
SHA CI validated. It does not run on push, and `workflow_dispatch` was removed — the old
push trigger raced CI and could publish a commit whose server suite was red. The job
installs dependencies, runs the client Vitest suite, builds `dist/`, and then
**force-pushes the output to the `gh-pages` branch**. A test or build failure leaves the
currently deployed site unchanged. The production online config (`VITE_API_URL`,
`VITE_GOOGLE_CLIENT_ID`) is committed in `.env.production` — both values are public, so
nothing is injected at build time.

Before publishing, the workflow queries the **live Worker's** `GET /` and refuses to deploy
a client whose `RAID_RULESET_VERSION` the deployed Worker doesn't serve yet. Because
`/raid/start` rejects a version mismatch with `426 stale_ruleset`, shipping the client first
would break every invasion until the Worker caught up — and the Worker deploy is manual. The
gate is skipped (with a warning, not a failure) if the Worker is unreachable, so a health blip
can't block an art or docs deploy. **When a ruleset bump is in the commit, deploy the Worker
first** — apply any pending D1 migrations, run *Deploy server (Cloudflare Worker)*, then re-run
this deploy.

Production is served from the custom domain **`zombiefarmreforged.com`**, set by
`public/CNAME` (Vite copies `public/` into `dist/`, so the CNAME rides each publish).
The Worker's `ALLOWED_ORIGIN` (`server/wrangler.toml`) is a **single value** and must
match that domain — the old `github.io` URL is no longer an allowed API origin, so
changing one without the other breaks every online request with a CORS failure.

To serve it yourself:

1. Push this project to a GitHub repo (the `main` branch) so CI, and then the deploy,
   runs.
2. In the repo, go to **Settings → Pages → Build and deployment**, set **Source**
   to **Deploy from a branch**, and choose branch **`gh-pages`** / folder **`/ (root)`**.
3. For a custom domain, set it under **Settings → Pages → Custom domain**, point your
   DNS at GitHub Pages, and edit `public/CNAME` to match. To use the default
   `https://<your-username>.github.io/<repo-name>/` instead, delete `public/CNAME`.
4. Update `ALLOWED_ORIGIN` in `server/wrangler.toml` to whichever origin you land on and
   redeploy the Worker.

The build uses a relative base (`base:"./"` in `vite.config.ts`), so it works
whether it's served from a domain root or a Pages project subpath. All runtime
asset URLs go through `import.meta.env.BASE_URL` (see `src/base.ts`); do not
reintroduce hardcoded `/assets/...` paths or subpath hosting will 404.

The build also injects a strict Content-Security-Policy `<meta>` tag (`vite.config.ts`),
allowlisting `script-src 'self'` plus the Google Sign-In origins, `worker-src 'self' blob:`,
and the configured API origin in `connect-src`. There is no `unsafe-inline`, which is why
`public/boot.js` is an external file and `src/pwa.ts` registers the service worker manually.
**Write UI code accordingly: no inline `<script>`, no inline `onclick` handlers** — build
elements with `addEventListener` and `element.style`. The CSP is applied on build only, so a
violation will pass `npm run dev` and fail in production.

The Worker is deployed separately by `.github/workflows/deploy-server.yml`, which is
**manual (`workflow_dispatch`) only** — pushing to `main` does not ship server changes.

## Asset Provenance

The art and audio under `public/assets/` are extracted/derived from the
commercial game **Zombie Farm 2** and are used here for a personal,
non-commercial reimplementation. They are **not** covered by any license in this
repo and are not authorized for redistribution or commercial use. If you fork or
publish this, replace or remove those assets, or keep the repo private.

## Regenerate Assets

Art/data under `public/assets/` is produced from `../ZF2R_extracted/raw/ios-1.0/1.0/Payload/ZF2R.app/`.

Common prep scripts:

```bash
python tools/prep_assets.py
python tools/prep_farmer.py
python tools/prep_market.py
python tools/prep_placeables.py
python tools/prep_zombie_models.py
python tools/prep_zombie_detail.py
python tools/prep_boosts.py
python tools/prep_quests.py
python tools/prep_raids.py
python tools/prep_drops.py
python tools/prep_pets.py
python tools/prep_enemies.py
python tools/prep_upgrades.py
python tools/prep_epic_bosses.py
```

`tools/extract_zf1_ipa.py` extracts the **original Zombie Farm 1** app bundle — decoding Apple
CgBI "crushed" PNGs to portable PNGs and bucketing plists and art by category. It writes to an
external `ZF1_extracted` tree, not into `public/`, and is groundwork toward the ZF1 art pack the
**ZF2 Sprites** setting needs; nothing at runtime reads its output yet.

`tools/sprite_assembler.html` (built by `tools/build_sprite_assembler.py`) is a
hands-on drag/rotate/pivot editor for hand-authoring zombie `models.json`; its
export round-trips the same schema the runtime reads.

## Layout

| Path | Role |
|---|---|
| `src/main.ts` | App boot, auth gate, game wiring, input, debug hooks |
| `src/hud.ts` | DOM HUD shell: menus, market, Black Market, raids, zombie/quest/social panels. Still the largest file (~4.4k lines); an in-progress refactor is moving panels out into `src/ui/` |
| `src/ui/` | Extracted HUD pieces: `hud.css`, `Modal.ts`, `hudTypes.ts`, `uiAsset.ts`, and `panels/` (dialogs, settings, storage, fullscreenPrompt) |
| `src/Field.ts` | Terrain, plots, crops, objects, climate skins, occupancy, persistence |
| `src/GameState.ts` | Currencies, XP/level, storage, boosts, raid progress, friends |
| `src/JobSystem.ts` | Growth/harvest timers, offline catch-up, fertilize |
| `src/assets.ts` | Runtime asset catalog and loader paths |
| `src/net/` | Online layer: auth, sign-in gate, server API client, friend visits |
| `src/save/` | Save schema and local/server save manager |
| `src/zombie/` | Owned zombies, rendering, traits, mutations, Zombie Pot |
| `src/raid/` | Raid catalog, live battle sim/scene, deterministic replay, rewards |
| `src/epicBoss/` | Epic Boss runs: catalog, fight flow, rewards (see `docs/EPIC_BOSS_MECHANICS.md`) |
| `src/quest/` | Quest bus and data-driven quest engine |
| `src/tutorial/` | First-run tutorial controller, beats, and DOM overlay |
| `src/social/` | Local friend-list fallback + gifting helpers |
| `src/audio.ts` | Opt-in BGM/SFX |
| `src/platform.ts`, `src/touchInput.ts` | Phone/desktop capability detection, pinch-zoom and pan, tap/hold gesture rules |
| `src/plowSelection.ts` | Drag-select plow rectangle geometry |
| `src/pwa.ts` | Service-worker registration and update/offline toasts |
| `src/blackMarketRules.ts` | Client-side Black Market gating and mutation matching |
| `src/prefs.ts` | Persisted user preferences (audio, foliage, sprite set, edition) |
| `src/base.ts` | `BASE_URL` prefixing for all runtime asset URLs — never hardcode `/assets/...` |
| `src/iso.ts`, `src/depthSort.ts`, `src/lighting.ts`, `src/cropTop.ts` | Isometric projection, draw-order toposort, night lighting, crop overhang fix |
| `src/economy.ts`, `src/farmRewards.ts` | Prices, payouts, and reward math |
| `server/` | Cloudflare Worker + D1 backend: saves, friends, gifting, visits, raid verification |
| `tools/` | Source extraction and public asset/data generation |
| `public/assets/` | Runtime-ready generated assets |
