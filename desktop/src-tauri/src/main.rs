// Zombie Farm Reforged - desktop shell.
//
// The game is the same web build that runs at zombiefarmreforged.com; this only
// gives it a native window. The one interesting decision is how the files reach
// the webview.
//
// We do NOT embed the frontend in the binary (Tauri's default). Players install
// mods by dropping files into `game/`, so `game/` has to stay a plain folder
// next to the .exe. Instead we register a custom URI scheme and read from disk
// on demand, which means:
//
//   * mods work, and a reload picks them up - nothing is cached in the binary;
//   * there is no HTTP server and no port to collide with, so the origin can
//     never shift. That matters more than it sounds: saves live in localStorage,
//     which is keyed by origin, so a shifting origin silently means a lost farm.
//
// On Windows the scheme is served as `http://zfgame.localhost/...`. Chromium
// treats any `*.localhost` host as a secure context, so `crypto.randomUUID()`
// (used on the offline save path) and localStorage both work - verified against
// a real build before this shell was written.

// Release builds are a GUI app: no console window behind the game.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::http::{header, Request, Response, StatusCode};

/// Folder served to the webview: `game/` beside the executable.
///
/// The `dist` fallbacks let `cargo run --release` work straight from a source
/// checkout (target/release/ is four levels below the repo root) without
/// packaging first. A shipped build finds `game/` and never reaches them.
fn game_dir() -> &'static Option<PathBuf> {
    static GAME_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    GAME_DIR.get_or_init(|| {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("game"));
                // target/release/ -> repo root, for `cargo tauri dev`.
                candidates.push(dir.join("../../../../dist-offline"));
                candidates.push(dir.join("../../../../dist"));
            }
        }
        candidates
            .into_iter()
            .find(|dir| dir.join("index.html").is_file())
            .and_then(|dir| fs::canonicalize(dir).ok())
    })
}

/// Update channel for this package: the repository it was built from and the tag
/// it was built at, read from `update.json` beside the executable.
///
/// Written at packaging time from the building repository, so a fork's package
/// asks the FORK's releases. Missing or malformed means no channel at all: the
/// game's Settings row then says update checks aren't available, and nothing here
/// ever touches the network. That matters — these packages are for playing
/// entirely offline, so reaching out has to be something the player asks for.
fn update_channel() -> &'static Option<(String, String)> {
    static CHANNEL: OnceLock<Option<(String, String)>> = OnceLock::new();
    CHANNEL.get_or_init(|| {
        let exe = std::env::current_exe().ok()?;
        let text = fs::read_to_string(exe.parent()?.join("update.json")).ok()?;
        let repo = json_string_field(&text, "repo")?;
        let version = json_string_field(&text, "version")?;
        // Constrained rather than trusted: `repo` is pasted into a URL that gets
        // handed to the shell, and `version` into a script the page evaluates.
        let repo_ok = !repo.is_empty()
            && repo.matches('/').count() == 1
            && repo.split('/').all(|part| {
                !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
            });
        let version_ok = !version.is_empty()
            && version.len() <= 40
            && version.chars().all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c));
        (repo_ok && version_ok).then_some((repo, version))
    })
}

/// Pull one `"key": "value"` string out of flat JSON without taking a parser
/// dependency. The file is written by our own packaging step, so it is a known
/// two-field object rather than arbitrary input.
fn json_string_field(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let after_key = text.find(&needle)? + needle.len();
    let rest = &text[after_key..];
    let colon = rest.find(':')? + 1;
    let rest = &rest[colon..];
    let open = rest.find('"')? + 1;
    let rest = &rest[open..];
    let close = rest.find('"')?;
    Some(rest[..close].to_string())
}

/// Percent-decode a URL path (`%20` and friends) without pulling in a crate.
/// Invalid escapes are left as-is rather than dropped, so a filename with a
/// stray `%` still resolves.
fn percent_decode(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Map a request path to a file inside the game folder, or `None` if it would
/// escape it. Containment is checked after canonicalisation, so `..` segments
/// and symlinks can't walk out.
fn resolve(root: &Path, request_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(request_path);
    let trimmed = decoded.trim_start_matches('/');
    let relative = if trimmed.is_empty() { "index.html" } else { trimmed };

    let mut candidate = root.to_path_buf();
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            candidate.pop();
            continue;
        }
        candidate.push(segment);
    }

    let resolved = fs::canonicalize(&candidate).ok()?;
    if !resolved.starts_with(root) {
        return None;
    }
    if resolved.is_dir() {
        let index = resolved.join("index.html");
        return index.is_file().then_some(index);
    }
    Some(resolved)
}

fn mime_for(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "mp3" => "audio/mpeg",
        "ogg" | "oga" => "audio/ogg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// Parse a single `bytes=` range against a known body length.
/// Multi-range requests return `None`, so the caller sends the whole file.
fn parse_range(value: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let spec = value.strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None;
    }
    let (from, to) = spec.split_once('-')?;
    let (from, to) = (from.trim(), to.trim());

    if from.is_empty() {
        // "bytes=-500": the final 500 bytes.
        let last: u64 = to.parse().ok()?;
        if last == 0 {
            return None;
        }
        return Some((length.saturating_sub(last), length - 1));
    }

    let start: u64 = from.parse().ok()?;
    if start >= length {
        return None;
    }
    let end = if to.is_empty() {
        length - 1
    } else {
        to.parse::<u64>().ok()?.min(length - 1)
    };
    (end >= start).then_some((start, end))
}

fn error_page(status: StatusCode, title: &str, body: &str) -> Response<Cow<'static, [u8]>> {
    let html = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title>\
         <body style=\"font:15px/1.6 system-ui,sans-serif;background:#33502b;color:#f3ecd2;padding:48px\">\
         <h1 style=\"font:700 22px/1.3 system-ui,sans-serif\">{title}</h1>{body}"
    );
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Cow::Owned(html.into_bytes()))
        // A builder with a valid status and one header cannot fail.
        .expect("static error response is always valid")
}

fn serve(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let Some(root) = game_dir() else {
        return error_page(
            StatusCode::NOT_FOUND,
            "Game files are missing",
            "<p>This app expects a <code>game</code> folder next to it, containing \
             <code>index.html</code>.</p><p>If you unzipped the download, make sure you \
             extracted the whole zip and kept the folder together.</p>",
        );
    };

    let path = request.uri().path().to_string();

    // The shipped build registers a PWA service worker that cache-firsts art and
    // audio. In a browser that's a feature. Here it is pure harm: everything is
    // already on local disk, and the cache silently outlives a modded file -
    // measured, before this existed, as a replaced PNG still serving its old
    // 1399 bytes after a reload while 1585 sat on disk.
    //
    // So answer /sw.js with a worker that empties the caches and unregisters
    // itself. On a first run this registers instead of the real worker and the
    // problem never starts.
    //
    // It does NOT rescue a profile that already ran a build without this:
    // WebView2 doesn't route service-worker script fetches through the custom
    // protocol handler, so the browser's update check for /sw.js fails outright
    // ("An unknown error occurred when fetching the script") and the old worker
    // stays active forever. Measured against v0.2.1 -> v0.2.2 over one profile.
    // The only cure there is deleting %LOCALAPPDATA%\com.zombiefarmreforged.desktop,
    // which also deletes that farm, so it is a documented last resort rather
    // than something the app does behind the player's back.
    if path == "/sw.js" {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Borrowed(KILL_SWITCH_WORKER.as_bytes()))
            .expect("static script response is always valid");
    }

    // Tells the game it is packaged, and which repository to ask about updates.
    // Served as a file rather than inlined because the build's CSP has no
    // 'unsafe-inline' for scripts.
    if path == "/__zfshell.js" {
        let (repo, version) = match update_channel() {
            Some((repo, version)) => (repo.as_str(), version.as_str()),
            None => ("", ""),
        };
        let script = format!(
            "window.__ZF_SHELL__ = {{\"kind\":\"app\",\"repo\":\"{repo}\",\"version\":\"{version}\"}};\n"
        );
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Owned(script.into_bytes()))
            .expect("static script response is always valid");
    }

    // The player said yes to an update. There is no browser in this window, so the
    // shell opens one. The URL is built HERE from the packaged configuration - the
    // page never supplies one, so nothing it could be tricked into saying can send
    // the player somewhere else.
    if path == "/__open-release" {
        let opened = match update_channel() {
            Some((repo, _)) => open_in_browser(&format!("https://github.com/{repo}/releases/latest")),
            None => false,
        };
        let (status, body) = if opened {
            (StatusCode::OK, "{\"opened\":true}")
        } else {
            (StatusCode::SERVICE_UNAVAILABLE, "{\"opened\":false}")
        };
        return Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Cow::Borrowed(body.as_bytes()))
            .expect("static json response is always valid");
    }

    let Some(file) = resolve(root, &path) else {
        return error_page(
            StatusCode::NOT_FOUND,
            "File not found",
            &format!(
                "<p>The game asked for <code>{}</code> and it isn't in the game folder.</p>\
                 <p>If you installed a mod, one of its files may be missing or misplaced.</p>",
                html_escape(&path)
            ),
        );
    };

    // index.html is rewritten on the way out: the shell declaration is added, and
    // api.github.com is allowed in connect-src ONLY when an update channel exists,
    // so a package without one keeps exactly the policy the web build ships.
    if file.file_name().and_then(|n| n.to_str()) == Some("index.html") {
        if let Ok(html) = fs::read_to_string(&file) {
            let mut html = if html.contains("__zfshell.js") {
                html
            } else {
                // A classic script still runs before the deferred module bundle, so
                // the flag is set before the game reads it.
                match html.find("</head>") {
                    Some(at) => {
                        let mut out = String::with_capacity(html.len() + 48);
                        out.push_str(&html[..at]);
                        out.push_str("    <script src=\"/__zfshell.js\"></script>\n  ");
                        out.push_str(&html[at..]);
                        out
                    }
                    None => format!("<script src=\"/__zfshell.js\"></script>{html}"),
                }
            };
            if update_channel().is_some() {
                html = html.replace("connect-src 'self'", "connect-src 'self' https://api.github.com");
            }
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .header(header::CACHE_CONTROL, "no-store")
                .body(Cow::Owned(html.into_bytes()))
                .expect("html response is always valid");
        }
    }

    let Ok(bytes) = fs::read(&file) else {
        return error_page(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Couldn't read a game file",
            "<p>A file in the game folder exists but could not be read. Antivirus software \
             or file permissions are the usual cause.</p>",
        );
    };

    let mime = mime_for(&file);
    let length = bytes.len() as u64;
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, length));

    // Range support is for <audio>: media elements ask for byte ranges, and a
    // server that ignores them breaks seeking.
    if let Some((start, end)) = range {
        let slice = bytes[start as usize..=end as usize].to_vec();
        return Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{length}"))
            .body(Cow::Owned(slice))
            .expect("partial-content response is always valid");
    }

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        // Modded files must show up on reload, and this reads from local disk.
        .header(header::CACHE_CONTROL, "no-store")
        .body(Cow::Owned(bytes))
        .expect("ok response is always valid")
}

/// Served in place of the build's real service worker. Deliberately not a 404:
/// a 404 leaves an already-installed worker in charge, still serving stale art.
const KILL_SWITCH_WORKER: &str = r#"// Replaced by the Zombie Farm Reforged desktop app.
// The shipped service worker caches art forever, which hides modded files.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
  })());
});
"#;

/// Hand a URL to the shell so it opens in the player's real browser.
///
/// `cmd /C start` rather than a Tauri plugin: it needs no extra dependency and no
/// capability, and this only ever receives a URL this process built itself. The
/// empty "" is the title argument `start` would otherwise take the URL as.
fn open_in_browser(url: &str) -> bool {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .is_ok()
}

fn html_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn main() {
    tauri::Builder::default()
        // Asynchronous, not the plain `register_uri_scheme_protocol`: that runs
        // the handler on the UI thread, and the game asks for a few hundred
        // assets during boot - some of them megabytes. Reading those inline
        // would stall the window while it loads. One short-lived thread per
        // request is enough here; the webview only has a handful in flight at a
        // time, and each does a single file read.
        .register_asynchronous_uri_scheme_protocol("zfgame", |_context, request, responder| {
            std::thread::spawn(move || responder.respond(serve(request)));
        })
        .run(tauri::generate_context!())
        .expect("failed to start Zombie Farm Reforged");
}
