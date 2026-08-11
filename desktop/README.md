# Desktop shell (Tauri)

`ZombieFarm.exe` — the same web build as everywhere else, in its own window. No
browser chrome, no console, no local web server, nothing installed.

> **Status: built and verified.** Compiled clean on the first CI run (v0.2.1)
> and was then driven through the published artifact — see [What is
> verified](#what-is-verified).

What players get:

```
Zombie Farm Reforged/
  ZombieFarm.exe
  Create Desktop Shortcut.cmd
  HOW TO PLAY.txt
  game/                      <- the built client; mods replace files in here
```

## How it works

One idea carries the whole design: **the game is not embedded in the binary.**

Tauri's default is to compile the frontend into the executable. That would break
modding, which is the reason a local build exists at all. So instead
[`src/main.rs`](src-tauri/src/main.rs) registers a custom URI scheme, `zfgame`,
and serves files from the `game/` folder next to the .exe, read fresh from disk
on every request.

Two things follow, both of which matter more than they look:

- **Mods work.** Drop a file into `game/assets`, reopen the app, see it. Nothing
  is baked into the binary and nothing is cached (`Cache-Control: no-store`).
  `/sw.js` is answered with a self-unregistering worker for the same reason: the
  shipped build's service worker cache-firsts art, and v0.2.1 shipped without
  this — a replaced PNG kept serving its old bytes across reloads. A 404 would
  not have been enough, because that leaves an already-installed worker running.

  **This only protects a clean profile.** WebView2 does not route service-worker
  script fetches through the custom protocol handler, so on a profile that
  already registered the real worker the browser's update check fails outright
  (`An unknown error occurred when fetching the script`) and the old worker stays
  active — measured across a v0.2.1 → v0.2.2 upgrade on one profile: still 1
  registration and 4 caches after 90 s and repeated launches. The page can't fix
  it either, since the stale worker serves `index.html` from its own precache, so
  nothing injected into that file ever runs. The cure is deleting
  `%LOCALAPPDATA%\com.zombiefarmreforged.desktop` — **which deletes that farm
  too**, so export first.
- **The origin can never move.** There is no HTTP server and no port to collide
  with. Saves live in `localStorage`, which is keyed by origin, so a shifting
  origin would silently mean a lost farm — the exact trap the browser launcher
  has to work around by pinning port 8722. Here it cannot happen.

On Windows a custom scheme is served as `http://zfgame.localhost/…`. Chromium
treats any `*.localhost` host as a *secure context*, which the game needs:
`crypto.randomUUID()` is on the offline save path and throws without it.

The handler also does the boring-but-necessary parts: MIME types by extension,
`Range` requests (media elements ask for byte ranges; ignoring them breaks audio
seeking), percent-decoding, and containment — paths are canonicalised and checked
against the game root, so `..` can't escape the folder.

## Saves do not carry over from the browser

A native webview gets its own storage partition. A farm played in Chrome, or via
the `Play Zombie Farm.cmd` launcher, is **not** visible here — it isn't lost,
it's just somewhere else. Moving one across is Settings → Local Save → **Export**
in the old one, then **Import** here. `HOW TO PLAY.txt` walks players through it.

Import is a plain `<input type="file">`, which WebView2 handles natively. Export
uses a blob URL and an `<a download>` click ([main.ts:125](../src/main.ts:125));
that path is **unverified in a webview** and is the first thing to check on the
first run.

## Building

CI does it: the `desktop` job in
[`.github/workflows/release-windows.yml`](../.github/workflows/release-windows.yml),
on a `v*` tag or manual dispatch. It builds the offline client, refuses to
continue if the live Worker origin is in the bundle, compiles the exe, and
attaches `ZombieFarmReforged-Windows-App.zip` to the release.

Locally you need Rust 1.77.2+ and the MSVC C++ build tools (Rust's Windows
toolchain links with them). Then:

```powershell
Set-Content .env.production.local "VITE_API_URL=`nVITE_GOOGLE_CLIENT_ID="
npm run build
Remove-Item .env.production.local
cargo build --release --manifest-path desktop\src-tauri\Cargo.toml
```

**Do not skip the env file.** A plain `npm run build` reads the committed
`.env.production` and points the bundle at the live Worker; from the app's
`zfgame.localhost` origin every call to it is refused by CORS, and you get a
title screen stuck on the service probe rather than the game. It looks like the
shell is broken when it isn't. `.env.production.local` is gitignored and
outranks `.env.production`, which is why it's the switch.

`cargo build` is enough — there is no Tauri CLI dependency. `build.rs` calls
`tauri_build::build()`, which reads `tauri.conf.json`, embeds the icon, and
generates what `tauri::generate_context!()` expands to. The CLI is only needed
for `tauri dev` and for building installers, and this ships a portable folder
rather than an installer.

Running from a source checkout: with no `game/` folder beside the binary, the
handler falls back to the repo's `dist-offline/` and then `dist/`, so
`cargo run --release` picks up whichever you built. `dist-offline/` is nothing
special — it's just `npx vite build --outDir dist-offline` with the env file
above, useful when you want an offline bundle without overwriting the `dist/`
you use for the live site.

**`Cargo.lock` is not committed** — there was no toolchain here to generate one.
The CI job uploads the lock file it produces as an artifact; commit it after the
first green build so later releases pin the same transitive crate versions.

## What is verified

Driven through the **published release artifact** — downloaded, unzipped and run
like a player would — with WebView2 remote debugging attached over CDP
(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`, the only way
in, since Tauri enables devtools for debug builds only):

- Window opens titled *Zombie Farm Reforged*, 13 WebView2 helper processes,
  stable at ~19.5 MB; still running at 120 s.
- Page URL is `http://zfgame.localhost/index.html`, `isSecureContext` is `true`.
- **The game fully boots**: canvas 1600×1000, 59 requests, **0 failures**, and
  the boot bar reaches *Click to Start*.
- **Mods take effect** (v0.2.2, clean profile): `button_plow.png` swapped on disk
  for a 1585-byte file served 1585 bytes immediately and after a reload, with
  `registrations: 0` and no caches. The same test against v0.2.1 kept serving the
  cached 1399 bytes — that is the bug the `/sw.js` kill switch fixes.
- **Audio decodes**: a 285 KB mp3 arrives byte-intact (291,717 bytes,
  `audio/mpeg`) and `decodeAudioData` yields 15.36 s stereo at 48 kHz.
- Missing files return 404; `/../../ZombieFarm.exe` returns 404, so the
  containment check holds.
- `Create Desktop Shortcut.cmd` refuses politely with no exe present, and writes
  a shortcut with the right target and working directory when it is.

Checked earlier, against the same build served on a `.localhost` origin in a
browser, before any of this Rust existed: `crypto.randomUUID()`, `crypto.subtle`
and `localStorage` all work there, and relative asset paths resolve.

### Known gaps

- **`Range` requests come back 200, not 206.** The handler implements 206
  correctly, but a `Range` header set on `fetch` never reached it — the webview
  does not appear to forward it for custom schemes. Harmless today: the game's
  music and one-shots both go through Web Audio, which fetches whole files and
  decodes them (verified above). It would matter only if something switched to
  `<audio>` seeking.
- **Export (Settings → Local Save) is unverified in the app.** It builds a blob
  URL and clicks `<a download>` ([main.ts:125](../src/main.ts:125)); WebView2
  download handling was not exercised. Import — a plain file input — is native
  and fine.

## If a future build fails

A white or blank window with no error usually means the WebView2 Runtime is
missing, not that the app is broken. If the window opens on the placeholder page
instead of the game, `app.windows[0].url` no longer matches the scheme mapping.
`mainBinaryName` and the Cargo `[[bin]]` name both say `ZombieFarm` and have to
stay in step.
