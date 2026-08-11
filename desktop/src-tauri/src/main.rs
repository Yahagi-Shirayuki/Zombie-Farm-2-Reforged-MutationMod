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
    // itself. It is byte-different from the shipped one, so an install that
    // already has the old worker adopts this on its next launch and the old one
    // dies rather than lingering forever.
    if path == "/sw.js" {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Borrowed(KILL_SWITCH_WORKER.as_bytes()))
            .expect("static script response is always valid");
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
