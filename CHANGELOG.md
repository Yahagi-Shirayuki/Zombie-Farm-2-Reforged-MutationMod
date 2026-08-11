# Changelog

## Unreleased (working tree)

### Windows downloads
- New **launcher** package (`launcher/`): unzip, double-click `Play Zombie Farm.cmd`, and the offline build opens in the default browser with a Desktop shortcut. Zero install — Windows PowerShell and the in-box C# compiler are enough. Serves `game/` from a loopback-only socket on a pinned port (saves are per-origin, so the port cannot drift), replaces the shipped service worker with a self-unregistering one, and sends everything `no-store` so modded files show up on reload.
- New **desktop app** (`desktop/`): `ZombieFarm.exe`, the same offline build in a Tauri window — no browser, no console, no local server, no port. A custom URI scheme serves `game/` off disk so mods keep working instead of being compiled into the binary.
- The desktop app answers `/sw.js` with a self-unregistering worker. v0.2.1 shipped without this, and the shipped build's CacheFirst service worker silently hid modded art: a replaced PNG kept serving its old bytes across reloads. A 404 would not do, since that leaves an already-installed worker in charge.
- `.github/workflows/release-windows.yml` publishes both zips on a `v*` tag. Both jobs refuse to package a bundle that still references the live Worker, so a moddable local client can never reach production.
- The two packages keep separate saves (a native webview gets its own storage); the app's instructions cover Export/Import.

### Fixes (client)
- Production CSP now allows `data:` in `connect-src`. PixiJS probes for worker ImageBitmap support by fetching a 1x1 data-URL PNG; blocking it made the probe report "unsupported", which silently moved every texture fetch and decode onto the main thread (202 of them during boot) and logged two CSP errors per page load.

### Memorial Statue
- New buyable object (3,000g, unlimited copies, sellable/storable) that enshrines one perished zombie as a stone statue on its plinth.
- Server-owned graveyard: new `fallen_v3` table (migration 0047), written at raid settlement, cleared again if the zombie is bought back at the revival offer.
- New `memorial.enshrine` / `memorial.clear` gameplay commands; occupants render on friend visits from the authoritative projection.
- Casualty names are captured from the presentation blob at death, before the roster row disappears.
- Graveyard capped at 60 unenshrined zombies (enshrined ones are never dropped).

### Elite invasions (Brain Ticket)
- New 10,000g Brain Ticket boost: skips the invasion cooldown, quadruples brain and rare-zombie odds, and promotes the fight to ELITE.
- Per-raid elite profiles scale enemy str/con/dex, boss projectiles, boss specials and summoned walls; calibrated and regression-tested against the replay cap.
- Server pins elite at `/raid/start` (charges the ticket, refuses with `no_brain_ticket`); the client adopts the server's answer so the deterministic replay can't desync.
- Tim warns about elite difficulty once, the first time a ticket is actually spent.
- Raid cards now show elite odds alongside ordinary ones; Army screen gained a Brain Ticket toggle with a buy prompt.

### Combat
- Resurrect no longer refuses Small zombies — the old blanket rejection came from a misread binary note and stranded Smalls killed by ordinary enemies.
- A revived zombie comes back whole, one-use abilities included; `abilityRearms` sends it to the back of the activation queue so a second Explode spends a fresh carrier.
- Raid ruleset bumped 20 → 22.

### Balance
- Brain drop odds now ramp linearly past the reference level instead of clamping at 20 — invasions from the Pirates up no longer pay identical brains.
- New farm-size tier: 70x70 ("Colossal 'ol Farm"), 1,250,000g / 20 brains, level 41.
- Epic Boss event picker now lists bosses in unlock order (cheapest first) instead of catalog order.

### Zombie harvest capacity
- Capacity is now a count (`zombieHarvestRoom`) checked at enqueue, arrival, and immediately before the crop is consumed — queueing a swipe of ripe zombie crops can no longer exceed the army+Mausoleum cap or destroy a crop with nowhere to put the unit.
- Offline harvest now uses `spawnVerified`, so a full army with a free Mausoleum no longer silently deletes the zombie.

### Art & presentation
- Zombie Pot shows working-state art: lid clamped on while combining, finished zombie's arm out when ready (`busySprite` / `readySprite`).
- Flat ground tiles (roads, ponds, rocks, zombie patch) now hang off their authored cocos anchor instead of being bottom-centred, fixing visible seams between pieces; the placement ghost re-derives the offset on flip.
- Lunar theme reworked: crater-dominated prop mix, darker filler, regraded ground tiles, starfield in dark backdrops.
- Mutation labels are now species-aware everywhere (`mutationLabelFor`) — a Tier-4 Eyebiscus is no longer called a Carrot in the Pot, Black Market, and roster.
- Garden Tier-3 portraits refreshed; per-part scale support in the zombie model pipeline.

### Fixes
- `MAX_FARM_PLOTS` is now derived from the largest farm-size tier instead of the literal 225, which was the 60x60 maximum — a 70x70 farm's last 64 plots were rejected `farm_full` and rolled back.
- A Memorial Statue's occupant is no longer trimmed out of the online bootstrap: the graveyard cap counted enshrined and unenshrined zombies together, so a statue whose occupant died long ago hydrated as a bare plinth once 60 newer losses accumulated (and re-enshrining it was then refused server-side as `statue_occupied`).
- A zombie taken off a statue now rejoins the graveyard at the top instead of at its date of death — selling or shelving a statue could otherwise evict its occupant on the spot, which is the opposite of what the sell confirmation promises. New `releasedAt` field ranks the list (migration 0048); the plaque still shows the date of death, and the zombie still ages out behind the next 60 losses.
- The client's graveyard cap now breaks tied timestamps on id like the server's queries do — one settlement stamps every casualty with the same time, so a cap falling inside a tied group could otherwise keep different zombies on each side.

### Tooling
- `prep_upgrades.py` asserts the farm-size ladder's progression; `EXTRA_SIZE_TIERS` added to `reforge_economy.py`.
- `tools/memorial_statue.py` generates the statue plinth and its mount point.
- Backdrop/boost/placeable prep scripts updated for the new assets.
