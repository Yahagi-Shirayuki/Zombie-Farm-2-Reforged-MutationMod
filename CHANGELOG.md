# Changelog

## Unreleased (working tree)

### Player reports
- **Mini zombies no longer push to the front line and get killed.** Ruleset 23 brought over the binary's per-body standoff, in which the lightest body plants closest to the enemy — and this sim commits an enemy's entire output to the single front-most zombie, so that made every Mini in the army the designated casualty of every fight. A Mini now stands where a Regular stands (as do the Cupid Gardens that bucket with it); the Headless is still the one body that pushes forward, which is the whole point of a Headless. **Raid ruleset 23 -> 24**: an invasion in flight at deploy time settles as `stale_ruleset` and pays nothing.
- **Drag-plowing no longer skips plots.** The stroke laid every new plot on the lattice of wherever the finger went down, and dropped — silently — any square that collided with something. That lattice is not shared with the plots already on the farm, so a swipe running alongside an existing row failed for exactly the stretch beside it and worked at both ends: "3-4 pieces unplowed around the centre of my selection". Measured on a real save, the same swipe laid 12 plots or 5 depending only on which tile it started from, one row apart. A square that will not fit is now nudged to wherever it does fit *under the pointer*, so the run stays aligned where it can and never leaves a hole where there is room.
- **Queued farm work survives an outage instead of vanishing.** Online, `apply` refuses to mutate a plot while the command lane is paused — but the job was finished anyway, so every plot the farmer reached during a hiccup was quietly consumed. Jobs now wait and resume on their own, and the catch-up leaves early rather than grinding through the whole absence.
- **An invasion can be launched with a big plow/plant queue.** Plow and plant travel as bulk commands (`farm.plow_many` / `farm.plant_many`, up to a full 289-plot board each), folded together in the outbox. One command per plot could not fit through the Worker's 120-semantic-commands-per-minute budget, so a full-field pass left `settle()` — which every invasion launch waits on — draining behind 429s for minutes. Partial refusals are reported once with a plot count instead of one toast per plot.
- **Objects with writing in their art no longer rotate into gibberish.** "Rotate" is a horizontal mirror, which is a real quarter turn for isometric art but turns the Ice Cream Stand's sign into "MAERC ECI". The four objects with baked lettering (Ice Cream Stand, Ice Cream Truck, and both 2012 banners) refuse to turn and say why; a save that already stored one as turned comes back the right way round. Reviewed the whole object set — every raid banner is asymmetric and mirrors perfectly well, because its crest is a picture.
- **Mobile portrait zooms out much further.** The camera was forbidden from zooming past the point where the view is taller than the world, because above the backdrop there was nothing but green filler. That limit is slack in landscape and binding in portrait: a phone was pinned near 0.38 while the same farm reached 0.25 on a desktop. Each backdrop's sky is now continued upward with a flat band of its own top-row colour, so the limit has nothing left to protect and is gone. Landscape is unchanged (its width limit binds first).
- **The farmer's lantern can be switched off.** Tap him at night, or use Settings > Farmer's Lantern. Off puts the lamp away and leaves the farm lit only by whatever you have placed. Persisted per device.

### Windows downloads
- New **launcher** package (`launcher/`): unzip, double-click `Play Zombie Farm.cmd`, and the offline build opens in the default browser with a Desktop shortcut. Zero install — Windows PowerShell and the in-box C# compiler are enough. Serves `game/` from a loopback-only socket on a pinned port (saves are per-origin, so the port cannot drift), replaces the shipped service worker with a self-unregistering one, and sends everything `no-store` so modded files show up on reload.
- New **desktop app** (`desktop/`): `ZombieFarm.exe`, the same offline build in a Tauri window — no browser, no console, no local server, no port. A custom URI scheme serves `game/` off disk so mods keep working instead of being compiled into the binary.
- The desktop app answers `/sw.js` with a self-unregistering worker. v0.2.1 shipped without this, and the shipped build's CacheFirst service worker silently hid modded art: a replaced PNG kept serving its old bytes across reloads. A 404 would not do, since that leaves an already-installed worker in charge.
- Known limitation: that only protects a clean profile. WebView2 does not route service-worker script fetches through the custom protocol handler, so a profile that already ran v0.2.1 fails its `/sw.js` update check and keeps the stale worker; resetting it means deleting `%LOCALAPPDATA%\com.zombiefarmreforged.desktop`, which also deletes that farm. Documented in `HOW TO PLAY.txt` and `desktop/README.md`.
- `.github/workflows/release-windows.yml` publishes both zips on a `v*` tag. Both jobs refuse to package a bundle that still references the live Worker, so a moddable local client can never reach production.
- The two packages keep separate saves (a native webview gets its own storage); the app's instructions cover Export/Import.
- Both packages can now **check** for a newer release, and never install one. The shell writes `update.json` from the repository that built the zip, declares it to the game via `/__zfshell.js`, and Settings > Check for Updates asks that repository's releases. A player is asked before anything happens, and accepting only opens the download page — nothing on disk is touched, because overwriting `game/` would delete their mods. Nothing checks on launch or in the background: with no `update.json` the shell declares empty values, refuses `/__open-release`, and does not add `api.github.com` to `connect-src`, so a package without a channel cannot reach the network at all.
- Forks need no configuration for any of this: the update channel comes from `$GITHUB_REPOSITORY` at packaging time, so a fork's package offers the fork's own releases.

### Fixes (client)
- Production CSP now allows `data:` in `connect-src`. PixiJS probes for worker ImageBitmap support by fetching a 1x1 data-URL PNG; blocking it made the probe report "unsupported", which silently moved every texture fetch and decode onto the main thread (202 of them during boot) and logged two CSP errors per page load.
- A battle scene that fails to load no longer strands the player. Both launch paths put the farm into battle mode before awaiting `RaidScene.create`, and every path back out lived inside the scene's own `onFinish` — so a scene that never built left `raidActive` true forever: blank screen, farm queue paused, HUD in raid layout, and only a reload to escape. Both chains now restore the farm, say what happened, and release the online session's fence.
- An online Epic Boss result no longer stores the run's timestamps in the *server's* clock. The finish handler wrote the raw projection straight back, undoing the conversion `adoptEpicBossResult` had just applied; the event window, the encounter timeout, the retry gate and Boss Token drops are all judged against `Date.now()`, so a client whose clock differed from the server's read them all wrong until the next bootstrap repaired it.
- The Profiles panel builds the signed-in display name with `textContent` instead of `innerHTML`, matching the rule the friends list and nameplate already follow. Nothing was exploitable — the server's username allowlist excludes markup — but the safety lived in a regex three modules away rather than at the sink.
- A failed Local Farm write cleans up its own scratch copy, so a quota failure does not leave a whole save's worth of storage behind for the retry to trip over.

### Fixes (server)
- The item shed's capacity is authoritative again. The retired v2 route enforced it (`planStore` via `shedCapacity`); protocol v3's `storage.move` dropped the check, leaving the cap client-side only, so an edited client could file any number of items into a Shabby Shed. Rejects with `shed_full`, derived from the placed shed's tier exactly as the client derives its own cap.
- `object.upgrade`'s free-starter-shed adoption — the one upgrade path that *inserts* a client-named object — now applies the same instance-id fence as `object.buy` and `storage.claim`. It previously accepted any 128-character string into a document other players read on farm visits.
- `writer.release` no longer deadlocks behind an expired operation marker. `acquire` and `beginOperation` both treat a marker past its TTL as absent; `release` required `active_batch_id IS NULL` outright, so one orphaned marker left the holder permanently unable to hand its own lease back, and the next device had to wait out the full idle window instead of taking an immediate handoff.

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
