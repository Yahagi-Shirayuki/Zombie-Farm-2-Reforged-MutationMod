# Windows launcher

The zero-install way to play a local build: unzip, double-click, play. Aimed at
players who don't have (and shouldn't need) Node, a terminal, or admin rights —
mostly people who want to run somebody's modded build.

Players never see this folder. They get a zip whose contents are
[`package/`](package) with the built game dropped into `game/`:

```
Zombie Farm Reforged/
  Play Zombie Farm.cmd     <- double-click this
  HOW TO PLAY.txt
  game/                    <- the built client (mods replace files in here)
  launcher/
    launcher.ps1
    zombiefarm.ico
```

## How it works

`Play Zombie Farm.cmd` starts [`package/launcher/launcher.ps1`](package/launcher/launcher.ps1)
with Windows PowerShell (hidden window, `-ExecutionPolicy Bypass` so a downloaded
script isn't blocked). The script:

1. finds `game/`, then compiles a small static HTTP server — embedded C#, built
   in memory with `Add-Type` — and binds it to `127.0.0.1:8722`;
2. opens the default browser at `http://127.0.0.1:8722/`;
3. creates a Desktop shortcut, once, on the first successful launch;
4. shows a small window with **Open game** / **Stop game**. Closing it stops the
   server.

Nothing is installed, and only the loopback interface is bound, so Windows
Firewall never prompts and nothing is reachable from the network.

### Why a web server and not just index.html

The built client is an ES-module bundle that `fetch`es its catalogs and art.
Browsers refuse both module scripts and `fetch` over `file://`, so double-clicking
`game/index.html` gets you a blank screen. A local HTTP origin is the smallest
thing that makes the real build run unmodified.

### Why PowerShell and embedded C#

It has to work on a stock Windows box with nothing installed. PowerShell 5.1 and
the in-box C# compiler are always there. Pure PowerShell was too slow for the
opening burst of a few hundred asset requests; `HttpListener` would have been
less code but needs an admin-registered URL ACL, which is exactly the kind of
prompt this is trying to avoid. So it speaks HTTP over a plain loopback socket.

### Things that look like bugs but aren't

- **Fixed port 8722.** Saves live in `localStorage`, which is keyed by origin —
  *including the port*. A different port is a different, empty farm. The port
  list is tried in a fixed order, and the launcher says so on screen when it has
  to fall back.
- **`/sw.js` is replaced.** The shipped build registers a service worker that
  cache-firsts art and audio. Locally that hides modded files, so the launcher
  serves a worker that clears the caches and unregisters itself instead.
- **Everything is `Cache-Control: no-store`.** Same reason: swap a file, press
  F5, see the change. Reading from local disk, caching buys nothing.
- **Second double-click doesn't start a second server.** It finds the first one
  via `/__zflauncher` and just reopens the browser.

## Packaging

CI does it: [`.github/workflows/release-windows.yml`](../.github/workflows/release-windows.yml),
on a `v*` tag or manual dispatch. It builds the **offline** variant, refuses to
continue if the live Worker origin is still in the bundle, and attaches
`ZombieFarmReforged-Windows.zip` to the release.

Locally — the path a mod author takes:

```powershell
powershell -ExecutionPolicy Bypass -File launcher\build-package.ps1
```

or, to wrap a mod's own build:

```powershell
powershell -ExecutionPolicy Bypass -File launcher\build-package.ps1 -SkipBuild -GameFolder C:\my-mod\dist
```

Output lands in `launcher/out/`.

### It ships the offline build on purpose

The package is always built with `VITE_API_URL` empty. A local client is a
modifiable client: pointing one at the live Worker would be a cheating vector,
and the browser blocks the calls with CORS errors from a `127.0.0.1` origin
anyway. Both the workflow and `build-package.ps1` fail if the Worker origin
survives into the bundle.

## Testing a change to the launcher

`launcher.ps1` runs straight from a source checkout — with no `game/` folder it
falls back to the repo's `dist/`, so build once and run the script:

```powershell
Set-Content .env.production.local "VITE_API_URL=`nVITE_GOOGLE_CLIENT_ID="
npm run build
Remove-Item .env.production.local
```

The env file matters: a plain `npm run build` bakes in the live Worker, and the
served page then logs CORS failures and offers the online chooser instead of
going straight into Local Farm. Fine for testing the launcher itself, misleading
for anything else.

These switches exist for automation:

- `-NoBrowser` — serve without opening a browser tab.
- `-SelfTestSeconds N` — close on its own after N seconds.
- `-DesktopPath <dir>` — put the shortcut (and its once-only marker) somewhere
  scratch instead of the real Desktop. Without this, a test run consumes the
  real once-only marker and the next genuine launch skips the shortcut.
- `-SelfTestShot <file.png>` — save a capture of the status window, for
  eyeballing a UI change.

```powershell
powershell -ExecutionPolicy Bypass -STA -File launcher\package\launcher\launcher.ps1 -NoBrowser -SelfTestSeconds 20
```

Diagnostics are appended to `%LOCALAPPDATA%\ZombieFarmReforged\launcher-log.txt`.
