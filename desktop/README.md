# Desktop shell (Tauri)

`ZombieFarm.exe` — the same web build as everywhere else, in its own window. No
browser chrome, no console, no local web server, nothing installed.

> **Status: not yet run.** This was written on a machine with no Rust toolchain,
> so it has never been compiled or launched. The first real proof is a CI build
> and someone opening the artifact. Everything in [What is already
> verified](#what-is-already-verified) below *was* checked; everything else is
> waiting on that first run. See [If the first build
> fails](#if-the-first-build-fails).

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
npm run build                                                    # produces dist/
cargo build --release --manifest-path desktop\src-tauri\Cargo.toml
```

`cargo build` is enough — there is no Tauri CLI dependency. `build.rs` calls
`tauri_build::build()`, which reads `tauri.conf.json`, embeds the icon, and
generates what `tauri::generate_context!()` expands to. The CLI is only needed
for `tauri dev` and for building installers, and this ships a portable folder
rather than an installer.

Running from a source checkout: with no `game/` folder beside the binary, the
handler falls back to the repo's `dist-offline/` then `dist/`, so a plain
`cargo run --release` after `npm run build` works.

**`Cargo.lock` is not committed** — there was no toolchain here to generate one.
The CI job uploads the lock file it produces as an artifact; commit it after the
first green build so later releases pin the same transitive crate versions.

## What is already verified

Checked against a real offline build served on a `.localhost` origin, before any
of this Rust was written:

- `isSecureContext` is `true`, and `crypto.randomUUID()`, `crypto.subtle` and
  `localStorage` all work there.
- The game boots on that origin: canvas up at 1280×720, 56 requests, 0 failures,
  `[save] fresh farm`, `field 30x30 ready`.
- Relative asset paths resolve (the build uses `base: "./"`).
- `Create Desktop Shortcut.cmd` refuses politely with no exe present, and writes
  a shortcut with the right target and working directory when it is.

## If the first build fails

Most likely spots, roughly in order:

1. **`register_uri_scheme_protocol` signature.** Written against tauri 2.11.5,
   where the handler is `Fn(UriSchemeContext<'_, R>, Request<Vec<u8>>) ->
   Response<T>`. Older 2.x took `(&AppHandle, Request)`; if the runner resolves
   an older minor, that's the mismatch.
2. **The window URL.** `http://zfgame.localhost/index.html` assumes Windows'
   scheme mapping. If the window opens on the placeholder page instead of the
   game, this is why — check `app.windows[0].url`.
3. **`mainBinaryName` vs the Cargo `[[bin]]` name.** Both say `ZombieFarm`; they
   have to agree.

A white or blank window with no error usually means the WebView2 Runtime is
missing, not that the app is broken.
