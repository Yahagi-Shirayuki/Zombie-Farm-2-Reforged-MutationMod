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

## Local Farm quicktest tools

This fork intentionally allows Local Farm players to speed through waits and test
resources. These tools are offline-only: they do not run on Online Farm, and they
do not grant anything through the server.

Open the hidden **Local Farm Tools** menu by clicking the invisible hotspot just
left of the top nameplate. It includes resource grants, one-hour/day time skips,
night lighting, exact Level/Gold/Brains overrides, and raid ability unlock helpers.

Keyboard shortcuts also work while playing Local Farm, as long as a text field is
not focused:

| Key | Action |
|---|---|
| `G` | Grant 10,000 gold |
| `H` | Grant 25 brains |
| `L` | Grant 200 XP |
| `J` | Skip Local Farm timers ahead 1 hour |
| `K` | Skip Local Farm timers ahead 1 day |

The browser console also exposes `ZF.skipTime(minutes)` on Local Farm.


### Or download it for Windows

For playing offline, or for running someone's modded build, there are two zips.
Neither needs Node, a terminal, or admin rights — unzip and double-click:

| Download | What you get |
| **[App](https://github.com/actualdoctornerd-ai/Zombie-Farm-2-Reforged/releases/latest/download/ZombieFarmReforged-Windows-App.zip)** | `ZombieFarm.exe` — the game in its own window, no browser ([desktop/README.md](desktop/README.md)) |
| **[Launcher](https://github.com/actualdoctornerd-ai/Zombie-Farm-2-Reforged/releases/latest/download/ZombieFarmReforged-Windows.zip)** | `Play Zombie Farm.cmd` — opens the game in your default browser ([launcher/README.md](launcher/README.md)) |

Both run the same offline build and take mods the same way: drop files into the
`game` folder. They keep **separate saves** — a native app window gets its own
storage — so to move a farm across use Settings → Local Save → **Export**, then
**Import** in the other one.
## Quick start (run it yourself)

You need [Node.js](https://nodejs.org) 18 or newer, and nothing else. Every game
asset is committed, so a clone is self-contained — no extraction step, no Python,
no database, no account, no server.

```bash
git clone https://github.com/Yahagi-Shirayuki/Zombie-Farm-2-Reforged-MutationMod.git
cd Zombie-Farm-2-Reforged-MutationMod
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
| [README.md](README.md) | This file — what the game is, how to run it, what's missing |
| [docs/FEATURES.md](docs/FEATURES.md) | The exhaustive feature inventory behind this file's summary |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to set up, test, and open a pull request |
| [SECURITY.md](SECURITY.md) | Anti-cheat posture, threat model, release gates |
| [PROVENANCE.md](PROVENANCE.md) | What this is derived from, and what it is not |
| [launcher/README.md](launcher/README.md) | The double-click Windows package: how it works, how to build one |
| [desktop/README.md](desktop/README.md) | `ZombieFarm.exe`, the Tauri window build (and why the game isn't embedded in it) |
| [server/README.md](server/README.md) | API surface, local Worker setup, ops notes |
| [server/RUNBOOK.md](server/RUNBOOK.md) | Incident response and operational procedures |
| [docs/](docs/) | Per-system deep dives — see the split below |

`docs/` holds two kinds of file, and the difference matters when you're deciding whether to
trust one:

- **Current behaviour**, kept in step with the code: `FEATURES.md`, `EPIC_BOSS_MECHANICS.md`,
  `PROTOCOL_V3_ROLLOUT.md`, `SPECIAL_ZOMBIE_ACQUISITION.md`, `EPIC_BOSS_ASSET_AUDIT.md`,
  `FRIEND_INVASIONS.md` (a built-and-parked feature: what exists, the switches, and the
  redesign's open questions), and
  everything under `docs/mechanics/` (behaviour recovered from the original binary, with the
  derivation — these win over intuition, see CONTRIBUTING; `mechanics/README.md` indexes them).
- **Historical design plans** for features that have since shipped:
  `BLACK_MARKET_IMPLEMENTATION_PLAN.md`, `DECOR_RESTORATION_PLAN.md`. Kept for the *why*, not
  as a description of how the code works now. Each opens with a status banner saying so; where
  the shipped form diverged from the plan, the banner is the correction.

Some **source-extraction** references (the disassembly notes, the raw mechanics
audit, and the phased roadmap) live outside this repo under `../ZF2R_extracted/`,
because they are bound up with the extracted commercial game bundle and are not
redistributable. You do **not** need them to contribute — anything load-bearing that
comes out of them gets written up in `docs/mechanics/` here. If you hit a gameplay
question that only those notes can answer, open an issue and ask; the answer will be
copied into the repo rather than left external.

## Documentation Rule

When changing gameplay behavior, generated asset coverage, menus, save schema, the
online/social layer, or deployment, update the docs **in the same change** —
[docs/FEATURES.md](docs/FEATURES.md) for what now exists, and this README only if the
change is big enough to move the summary above. If a change adds or removes a known gap,
update the "Current Gaps" section below so nobody works from stale assumptions.
Security-relevant changes to the server or raid path must also update
[SECURITY.md](SECURITY.md) and [server/README.md](server/README.md).

Two habits keep this from rotting, both learned from docs that did:

- **Anchor a claim to a symbol.** "`ALIEN_MAX_ACTIVE` in `src/raid/alienStage.ts`" breaks
  visibly when the symbol moves; "this is fixed" rots in silence.
- **Don't quote a number that drifts.** Test counts and file sizes go stale the next time
  anyone touches the suite. Version numbers that *are* load-bearing are pinned by
  `src/docsVersionSync.test.ts`, which fails the build when a doc quotes a stale one.

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
- **Black Market**: server-authoritative buy/sell-zombie orders with brain/zombie escrow, caps of 10 open orders and 50 per day, price bounds, and atomic fulfillment. Buy orders can demand **specific mutations** (every requested anatomical slot must match; extras are allowed). Delivery is gated on the recipient — special zombies need player level 20, while Blue/Red/Silver classes unlock at their gravestone's level (1/15/25) without requiring the gravestone itself. Tapping a listing opens the full inspect card for that zombie, rendered through the *viewing* player's own unlocked abilities and farmer bonuses; level-locked listings stay inspectable. Filling a buy order asks which of your matching zombies to hand over rather than picking one for you. A settled trade is **collected**, not dropped on you: the zombie waits on the order until the recipient has room for it, and a sale's brains are held by the market until the seller collects them (their balance shows the held total beside their own).
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
- Music, sound effects, and farm ambience are enabled by default and can be toggled independently in Settings. An optional **Mute When Unfocused** setting silences all channels while the game tab or window is in the background. The mandatory first-run tutorial uses real farm actions: plow, plant a zombie, buy and use Insta-Grow, harvest, then raid. Local Farm tools (a separate menu opened by an invisible hotspot beside the nameplate) support offline resource grants, time skips, and testing.
- The right-side **Farmer's Guide** is a responsive, chapter-based in-game knowledge base covering Local and Online saves, core farming and combat mechanics, social/community help, the open-source repository, and contributor acknowledgements.
- **Farm background** setting: foliage density choices (Deep Forest / Woodland / Light Meadow) persisted in `src/prefs.ts`. This changes the density of decorative surrounding foliage — distinct from ground/climate skins, which change the farm's tile terrain.
- **Zombie appearance** settings (`src/prefs.ts`, applied by `displayedAppearance` in `src/zombie/appearance.ts`): **Zombie Colour** picks between the inherited skin a Zombie Pot child was born with and its own species' colour, and **Show Mutations** hides crop mutation art. Both are device-local display choices — the unit keeps its mask, tint, and stat bonuses — and both apply everywhere a zombie is drawn: the farm, invasions, portraits, cards, the Mausoleum and the Black Market.
- A **ZF2 Sprites** setting is persisted in `src/prefs.ts`, but art swapping is not yet wired.

### Saving and testing
- Versioned, isolated persistence: complete Local Farm saves with a last-known-good backup and JSON export/import; server-authoritative Online Farm state with a per-account read-only snapshot, presentation cache, and durable command outbox.
- Automated Vitest suites exist for both client (`npm test`) and server (economy, loot, combat stats/prediction, mutations, Zombie Pot, ability unlocking, raid catalog/ordering, friend logic, and the server-side friend-visit save projection). Coverage is incomplete; the GitHub Pages deploy is gated by the client suite, and the Worker deploy is gated by migration validation, the server suite, and typechecking.

Development builds expose full `window.ZF` debug handles including app, world, field,
farmer, zombies, state, HUD, jobs, audio, save manager, quests, quest bus, raids, and
helper functions such as `ZF.runRaid`. All Local Farm builds expose `ZF.skipTime(minutes)`.

The short version, by area. The exhaustive list — every system, with its rules and the
source files that own it — is [docs/FEATURES.md](docs/FEATURES.md); what's *missing* is
[Current Gaps](#current-gaps) below.

- **Farm** — 30x30 to 70x70 isometric field, free-placed 4x4 plots, plow/plant/harvest with
  offline timers, drag-select plowing, placeable objects and fruit trees, storage, eight
  ground/climate skins (Sakura brings the game's first weather), and a per-skin scenery ring
  and horizon.
- **Economy** — gold, brains, XP and a 45-level curve; source-derived crop, zombie, decor,
  boost and pet catalogs with level and currency gates; Market with search and paging.
- **Zombies** — owned roster with per-type rigs, mutations (Zombie Pot combination with
  per-slot bitmask inheritance), veterancy, abilities, teams, a discovery Almanac, and a
  Memorial Statue for the fallen.
- **Quests** — 122 records: 106 recovered from the original `Quests.plist` plus 16
  Reforged-original achievements, on top of a generated daily/weekly objective board.
- **Raids** — 11 invasions with live battle scenes, recovered enemy rigs and attack
  timelines, permanent casualties with a one-time revival offer, boosts, loot, and elite
  invasions via the Brain Ticket. Eight Epic Boss events run as repeatable 14-day ladders.
- **Online (Reforged)** — an explicit Local/Online farm choice that never merges the two;
  Google sign-in, server-authoritative state behind a single-writer lease, deterministic
  server-verified raids, friends and gifting, the Black Market, and read-only farm visits.
- **Platform** — one responsive build for phone and desktop, an installable PWA, a Windows
  launcher and a Tauri desktop app, local-only diagnostics, and an in-game Farmer's Guide.

In **dev builds only** (`import.meta.env.DEV`), `window.ZF` exposes debug handles including app,
world, field, farmer, zombies, state, HUD, jobs, audio, save manager, quests, quest bus, periodic
quests, raids, and helper functions (e.g. `ZF.runRaid`, which uses the retained headless resolver).
It does not exist in a production bundle, so it is not a route into the deployed site.

## Current Gaps

Qualifiers: *implemented*, *partially implemented*, *placeholder*, *disabled*, *missing*, *Reforged-only*, *fidelity approximation*.

- **Raids (partially implemented / fidelity approximation):** the ladder, live combat, boosts, and permanent casualties ship, but combat still needs status/focus polish and per-raid balance tuning. Boss **summon** reinforcements, the faithful **carrotWall/junkWall** blockers, the Circus **trapeze carried-grab**, and the **Beach crab** carry-off are wired — the crab and trapeze are client-only tap-to-rescue minigames the server does not simulate (see the concession note under Online and social). The **Lawyers cars** grab has no shipped sprite and is not wired. Note that a ground-crossing obstacle/grab hazard previously listed here as "disabled pending visual work" was **not a base-game mechanic** — it was fabricated during development and has now been removed from the code entirely.
- **Market/upgrades (partially implemented):** Farm Size and ground/climate skins work; authored **TMX map loading is missing**.
- **Quests (partially implemented):** the farm loop, raids/invasions, Zombie Pot, and every Epic Boss emit live events. Recovered Epic quest chains are selected for the active boss; some late bosses have incomplete or missing shipped quest data. Social, photo/camera, and seasonal quest classes remain dormant. Currency and item rewards are granted authoritatively. A quest whose reward is a **zombie** is not paid by the quest engine, but nothing is lost to that: all sixteen are Epic Boss prize quests, and the boss's own settlement (`epicQuestZombieReward`) puts the unit in the authoritative roster — or in Received when the army is full. No other quest in either catalog has a zombie reward, so there is no case where completing one online leaves the unit ungranted.
- **Epic Bosses (eight recovered bosses):** Market → Epic Boss offers eight repeatable 14-day runs, listed and gated in unlock order — **Dr. Groundhog 24, Bully Frog 28, Rocky Rhino 30, General Larvaelus 32, Mystical Mamba 34, Foul Owl 38, Skunkarella 40, Loco Locust 42** — ordered by how strong each one's prize zombies are (Groundhog's Omega first, Loco Locust's Vagabond last) and server-enforced. Activation **ramps 3–5 brains** along the same ladder. Every event is a **10-rung** ladder carrying exactly the HP it always did (645x `baseHp`; each rung merges two of ZF2's authored multipliers), fought in **60-second** manual-focus attempts. `baseHp` ramps ±25% with the unlock ladder, and boss damage **compounds 5% per rung climbed** so the deep rungs demand a real front-line tank rather than more attempts — HP only ever buys attempts, since the fight is capped and damage carries over. Plus permanent casualties, retained damage, crop-harvested fight tokens (or 1 brain per attempt), rolled brain/gold victory rewards, namespaced loot, pets, and deterministic online replay. All eight now animate: five play exact authored combat strips, and Rocky Rhino, General Larvaelus and Mystical Mamba (`reconstructed: true`) play strips cut from their atlases by geometry with hand-authored frame ordering, because those sheets shipped with no metadata. See `docs/EPIC_BOSS_MECHANICS.md`.
- **Settings toggle — Sprites (placeholder):** the **ZF2 Sprites** switch persists a preference (`src/prefs.ts`) but does nothing yet. It needs a ZF1 art pack and a runtime swap keyed off `getSpriteSet()`.
- **QoL/UI (partially implemented):** Storage's Received tab now renders reward cards and can place or claim from them; fuller settings controls are still missing. The Farmer's Guide and the Almanac's field notes provide the in-game help pages, with more detailed topics still to come.
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

### Online against the deployed STAGING server (no local Worker needed)

The deployed staging stack (`zombiefarm-server-staging` — see "Staging environment"
in `server/README.md`) accepts local clients, so you can exercise the online layer
on real Cloudflare infrastructure without running `wrangler dev` at all. In
`.env.local`:

```
VITE_API_URL=https://zombiefarm-server-staging.zombiefarm.workers.dev
VITE_GOOGLE_CLIENT_ID=
```

Then `npm run dev` and open **`http://localhost:5173` exactly** — the Worker's CORS
allowlist is exact-match on `http://localhost:5173` and `http://localhost:4173`, so
`127.0.0.1` or any other port is rejected. (If 5173 is taken, run
`npm run dev -- --port 4173 --strictPort`; the `zombiefarm-staging-client` launch
config does exactly that.)

In the browser console:

```js
localStorage.setItem("zf2r.play-mode.v1", "online")   // then reload — no UI for this
await window.zfDevSignIn("you@test.local", "YourName") // then reload, pick a name
```

Each distinct `devSub` string is its own disposable staging account. Real Google
sign-in does NOT work from localhost (not an authorized origin on the OAuth
client) — the dev bypass is the intended staging path.

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

### Windows launcher package

The offline build above is what ships to players who don't want a toolchain —
wrapped with a double-click launcher that serves it on `127.0.0.1` and opens a
browser, since an ES-module build can't run from `file://`:

```powershell
powershell -ExecutionPolicy Bypass -File launcher\build-package.ps1
```

That writes `launcher/out/ZombieFarmReforged-Windows.zip`. Releases publish the
same zip from [`.github/workflows/release-windows.yml`](.github/workflows/release-windows.yml)
on a `v*` tag. Both refuse to package a bundle that still points at the live
Worker. Details, including why the launcher pins port 8722 and disables the
service worker, are in [launcher/README.md](launcher/README.md).

### Desktop app (`ZombieFarm.exe`)

The same offline build in a Tauri window instead of a browser — one process, no
local web server, no port. It deliberately does **not** embed the frontend in the
binary: a custom URI scheme serves `game/` off disk so mods still work. Needs
Rust 1.77.2+ and the MSVC C++ build tools locally; the `desktop` job in the
release workflow builds it on a Windows runner. It compiled clean on its first CI
run and has since been driven through the published artifact — see
[desktop/README.md](desktop/README.md) for what is verified, and for why a stale
service worker in an existing install cannot be fixed from inside the app.

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
npm test                            # client suite
npm run build                       # tsc typecheck + vite build

cd server
npm test                            # server unit suite
npm run test:integration            # route-level integration (boots a real Worker)
npm run typecheck                   # tsc --noEmit
npm run migrations:check            # validate migration ordering/numbering
```

The integration suite boots a real `wrangler dev` Worker with local D1 and drives it
over HTTP (it can't use `@cloudflare/vitest-pool-workers` — that pool breaks on paths
containing a space). It is slower than the unit suites and runs single-threaded,
since every spec shares one Worker and database.

`vitest.integration.config.ts` runs **every** `test/integration/**/*.spec.ts` and names
the exceptions explicitly: `api`, `inventory`, `raidLoot` and `raidRewards` are excluded
because they drive protocol-v2 routes that now answer `410`. It used to work the other way
round — an allowlist of two files, which silently retired nineteen specs while CI reported
the suite green — so opting a spec *out* is now the thing that has to be spelled out.

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
and the configured API origin in `connect-src`. `connect-src` also allows `data:` — PixiJS
probes for worker ImageBitmap support by fetching a 1x1 data-URL PNG, and blocking it
silently demotes every texture load to the main thread. There is no `unsafe-inline`, which is why
`public/boot.js` is an external file and `src/pwa.ts` registers the service worker manually.
**Write UI code accordingly: no inline `<script>`, no inline `onclick` handlers** — build
elements with `addEventListener` and `element.style`. The CSP is applied on build only, so a
violation will pass `npm run dev` and fail in production.

The Worker is deployed separately by `.github/workflows/deploy-server.yml`, which is
**manual (`workflow_dispatch`) only** — pushing to `main` does not ship server changes.

## Asset Provenance

Most of the art and audio under `public/assets/` are extracted/derived from the
commercial game **Zombie Farm 2** and are used here for a personal,
non-commercial reimplementation. They are **not** covered by any license in this
repo and are not authorized for redistribution or commercial use. If you fork or
publish this, replace or remove those assets, or keep the repo private.

The exception is **contributed art** — assets drawn for this project rather than
extracted. Their sources live in `tools/art/`. Catalog items go through
`tools/contributed_art.py`, which builds them into the catalog and names their
artist in a `credit` field the Market shows on the item's info parchment:
currently the three sakura trees, by **LennyFaze**. Backdrops have no catalog row
and so no credit — the autumn sunset horizon, and the tree-less base
`tools/prep_backgrounds.py` derives five skins from (Lunar, Dead, Urban, Sakura and
Snowy — see `NO_TREE_TERRAINS`). See `PROVENANCE.md`.

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
python tools/prep_backgrounds.py
```

`tools/prep_backgrounds.py` is the odd one out: it takes no source-app input. It
recolours the hand-made `public/assets/farm_background.png` into one horizon per
ground skin (`farm_background_<terrain>.png`), so a beach farm doesn't sit in front
of temperate green hills, and sprinkles a deterministic starfield into the skies
dark enough to show one. It prints each backdrop's mid-hill colour, which must be
pasted into that theme's `filler` in `src/surroundings.ts` — the viewport beyond
the backdrop is cleared to that colour, and the two have to match.

The Lunar terrain tiles are regraded (darker, near-neutral, grainy) inside
`prep_assets.py`'s `slice_ground`, and are pitched to sit just under that theme's
hills. Retune one and check the other.

`tools/extract_zf1_ipa.py` extracts the **original Zombie Farm 1** app bundle — decoding Apple
CgBI "crushed" PNGs to portable PNGs and bucketing plists and art by category. It writes to an
external `ZF1_extracted` tree, not into `public/`, and is groundwork toward the ZF1 art pack the
**ZF2 Sprites** setting needs; nothing at runtime reads its output yet.

`tools/rig_studio.html` (built by `tools/build_rig_studio.py`) is the bench for
everything the raid screen draws, in five tabs. It supersedes the old
`sprite_assembler.html`, whose rig editor it contains whole — same localStorage key, so
rig edits made there are still there.

* **Rig** — the drag/rotate/pivot editor for the paper-doll rigs (zombie
  `models.json` and `raids/enemies/models.json`); its export round-trips the same schema
  the runtime reads.
* **Animation** — runs and EDITS the procedural animations that pose those rigs. Every
  rig arrives with the clips the game actually gives it, rebuilt from
  `src/raid/EnemyActor.ts` and `src/raid/RaidActor.ts`: idle, move, one clip per named
  attack, and — for a boss — its throw and its special. Where a rig has a hand-authored
  ZFAttackAnims timeline (the Crazed Worker's wind-through, the Ninja's stab, BroBot's
  arm spins) that timeline is transcribed key-for-key and marked `authored`; everything
  else gets the generic chop/jab/slam envelope. A clip is a list of TRACKS, each posing
  one part group on one channel (rotation in degrees, translation in rig px, scale) with
  its own keys and its own pivot — which is what lets the arm chop about the shoulder
  while the body holds still. **Click a part on the stage** to select it: the right-hand
  panel names its target, prints its rotation at the playhead as an editable number, and
  says which joint it swings about; a green handle appears on that joint to drag the
  rotation, and dragging the part itself keys a move. The rig's own pivots are listed
  beneath and can be dragged on the stage (turn on *Rig pivots*) — moving a shoulder
  while the attack plays is the fastest way to fix an arm that reads wrong, and it writes
  through the same store the Rig tab uses. Clips save to the browser and download as JSON.
  *Place* puts the rig where an invasion would: `auto` perches a boss on the structure its
  stage authors (occluded by the building, as the game layers it) and stands a wave enemy
  in the doorway it holds at, and the individual lane marks are selectable one at a time.
* **Epic Bosses** — the eight bosses are drawn from authored frame STRIPS rather than
  rigs (see `src/raid/epicBossAnimation.ts`), so they get a strip player: play each
  animation off its cell grid, retime it, re-sequence it, nudge frames, against the
  parallax stage the boss brings with it. Exports a `catalog.json` `animations` patch.
* **Effects** — the ability visuals at real stage scale: heal, group heal, the
  resurrection pillar, the Explode fireball, the bash-family smash, both lasers, the
  Mini Buddy mount, the death poof. Ports of `src/raid/Particles.ts` and the
  `RaidScene` effect code, with the constants exposed so a change can be tried before it
  is moved into the source.
* **Tiles** — `tools/tile_lab.html` itself, hosted in a frame. One copy of that tool.

The side columns scroll, so a short window hides nothing: panels keep their height and
the section headings stick to the top of the column.

Everything a rig or a boss stands on is a real raid stage, laid out the way `RaidScene`
does it: the source 480x320 cocos design space, contain-fit, ground line at 0.9 of the
stage height, units fitted to their role height. (The Epic Boss stages' `isScrolling` /
`isMoving` layers are a preview of the SOURCE data — the game draws every level asset
statically — so that toggle is off by default.)

The clip schema, its evaluator and the built-in clips live in `tools/rigClips.js`, which
has exactly one copy: `build_rig_studio.py` inlines it into the studio, and
`src/rigClips.test.ts` drives that same file against the real `EnemyActor` and
`RaidActor` over a whole attack cycle, asserting every part lands where the engine puts
it. That is the same arrangement `tools/tileAnchorGeometry.js` has with `Field`, and for
the same reason — a bench that animates a rig differently from the game teaches you a
wrong animation, and the mistake ships looking measured. It has already earned its keep:
it is what caught every authored attack dismembering its own arm (see the changelog).

**An edited clip runs in the game.** Download the Animation tab's `enemy-clips.json` and
`zombie-clips.json`, drop them in as `public/assets/raids/enemies/clips.json` and
`public/assets/zombie/clips.json`, and `EnemyActor` / `RaidActor` pose themselves from
your clip instead of computing the pose. A rig you have not edited is untouched —
it runs exactly the code it always ran — which is what makes this safe to ship: the
substitution is a no-op until the clip itself differs, and `src/rigClips.test.ts` pins
that both ways (installing the BUILT-IN clip changes nothing; an edited one moves the
rig). `src/raid/clipRuntime.ts` is the seam.

Two known gaps: the named "special" zombies are composed at runtime by
`mergeSpecialZombieModel` and so are not in the rig list, and the ABILITY clips are still
reference material — a zombie's heal/smash/wind-up and a perched boss's throw/ability are
driven by a progress value rather than a clock, and the transcription does not record
that mapping yet, so those keep the procedural pose.

`tools/tile_lab.html` (built by `tools/build_tile_lab.py`) is the same idea for the art
that has to meet edge to edge — both road sets, the pond pieces, rocks, the zombie patch.
A flat tile does not sit bottom-centred on its footprint: it hangs off an authored cocos
pivot (`flat_tile_fields`, `Field.flatTileOffset`), and those pivots are hand-rounded 2dp
numbers that sometimes do not lay a piece where its neighbours are, so the correction has
to be measured. Lay pieces on the farm's own lattice, Alt-drag one until its kerb lines up
with the piece it continues, and copy out an `ANCHOR_OVERRIDES` block to paste into
`tools/prep_placeables.py`. An anchor belongs to the ART, so editing one moves every copy
on the bench that draws the same tile — including a road bend's four corners, which are
four separate sprites. Tint mode washes each piece a different hue, which is how you see
whether two overlap, butt, or leave a gap. `--all` also bundles the standing objects
(~6.5 MB) for checking what a road runs past. The anchor rule itself is inlined from
`tools/tileAnchorGeometry.js`, which `src/tileLabGeometry.test.ts` drives against Field's
own — a tool that draws a piece 3px from where the game draws it teaches you a 3px-wrong
anchor, so the two are pinned together rather than kept in step by hand.

**Zombie Review** (`npm run dev`, then <http://localhost:5173/zombie-review.html>) is the
companion viewer: every assembled zombie in one place, with mutations to add and remove and
the basic animations to play. Where the assembler reimplements the rig so it can be
double-clicked offline, this page imports the game's own `loadAssets()`, `RaidActor`,
mutation catalog and display prefs — so what it draws is by construction what the game
draws. Single view inspects one rig (idle / walk / bite / scratch / wind-up / heal / smash /
death, plus the focus pose and either facing); the contact sheet renders the whole roster at
one scale. Mutation legality is the game's: one per slot, and the headless family refuses
every head mutation but Pumpking. Sizing switches between the farm's `zombieFarmScale`, the
raid's contain-fit, and the raw rig. It is a dev page only — `vite build` ships `index.html`
alone, so it never reaches the bundle. `zfReview.capture(name)` in the console writes a tight
shot of the current rig to `tmp/review-shots/` through a dev-server-only `/__capture` endpoint
(see `captureEndpointPlugin` in `vite.config.ts`), which is how an art pass diffs before and
after without a download dialog per shot; the Export PNG button downloads normally.

## Layout

| Path | Role |
|---|---|
| `src/main.ts` | App boot, auth gate, game wiring, input, debug hooks |
| `src/hud.ts` | DOM HUD shell: menus, market, Black Market, raids, zombie/quest/social panels. Still the largest file (~6.3k lines); an in-progress refactor is moving panels out into `src/ui/`, but new systems have been landing faster than old ones move |
| `src/ui/` | Extracted HUD pieces: `hud.css`, `Modal.ts`, `hudTypes.ts`, `uiAsset.ts`, `toolWheel.ts`, `viewState.ts`, and `panels/` (dialogs, settings, storage, zombies, teams, memorial, periodicQuests, farmersGuide, fullscreenPrompt) |
| `src/Field.ts` | Terrain, plots, crops, objects, climate skins, occupancy, persistence |
| `src/GameState.ts` | Currencies, XP/level, storage, boosts, raid progress, friends |
| `src/JobSystem.ts` | Growth/harvest timers, offline catch-up, fertilize |
| `src/assets.ts` | Runtime asset catalog and loader paths |
| `src/net/` | Online layer: auth, sign-in gate, server API client, friend visits |
| `src/save/` | Save schema and local/server save manager |
| `src/zombie/` | Owned zombies, rendering, traits, mutations, Zombie Pot |
| `src/raid/` | Raid catalog, live battle sim/scene, deterministic replay, rewards |
| `src/epicBoss/` | Epic Boss runs: catalog, fight flow, rewards (see `docs/EPIC_BOSS_MECHANICS.md`) |
| `src/quest/` | Quest bus and data-driven quest engine; `periodic/` holds the generated daily/weekly objective board |
| `src/tutorial/` | First-run tutorial controller, beats, and DOM overlay |
| `src/social/` | Local friend-list fallback + gifting helpers |
| `src/devtools/` | Dev-only pages served by `vite dev` and excluded from the build (`zombieReview.ts` ↔ `zombie-review.html`) |
| `src/audio.ts` | Opt-in BGM/SFX |
| `src/platform.ts`, `src/touchInput.ts` | Phone/desktop capability detection, pinch-zoom and pan, tap/hold gesture rules |
| `src/plowSelection.ts` | Drag-select plow rectangle geometry |
| `src/pwa.ts` | Service-worker registration and update/offline toasts |
| `src/blackMarketRules.ts` | Client-side Black Market gating and mutation matching |
| `src/prefs.ts` | Persisted user preferences (audio, foliage, sprite set, edition) |
| `src/base.ts` | `BASE_URL` prefixing for all runtime asset URLs — never hardcode `/assets/...` |
| `src/iso.ts`, `src/depthSort.ts`, `src/lighting.ts`, `src/cropTop.ts` | Isometric projection, draw-order toposort, night lighting, crop overhang fix |
| `src/surroundings.ts` | Per-ground-skin scenery ring, horizon backdrop, and viewport filler |
| `src/economy.ts`, `src/farmRewards.ts` | Prices, payouts, and reward math |
| `server/` | Cloudflare Worker + D1 backend: saves, friends, gifting, visits, raid verification |
| `tools/` | Source extraction and public asset/data generation |
| `public/assets/` | Runtime-ready generated assets |
