// Update checking for the downloadable Windows packages.
//
// The web build updates itself: a deploy lands, the service worker notices, and
// the player gets a Reload toast. The launcher and the desktop app can't use any
// of that — they deliberately disable the service worker so a modded file is
// never masked by a cache — so without this their Settings row can only ever say
// "update checks aren't available in this build".
//
// So the shell that serves the game (launcher.ps1, or the Tauri handler) injects
// a tiny script declaring what it is and where it came from, and this module asks
// that repository's releases for the newest tag. Three things are deliberate:
//
//   * NOTHING happens unless the player presses the button. These packages exist
//     to be played entirely offline; a background call home on every launch would
//     quietly break that promise.
//   * We never download or replace anything. Overwriting `game/` would delete the
//     player's mods, which is the whole reason the packages exist — so a "yes"
//     opens the download page and the player decides what to do.
//   * The repository comes from the shell, not from a constant here, so a fork's
//     package checks the fork's own releases.

/** Injected by the shell as `/__zfshell.js`; absent in a browser build. */
export interface ShellInfo {
  /** "launcher" (browser + local server) or "app" (Tauri window). */
  kind: string;
  /** "owner/name" of the repository whose releases this package came from. */
  repo: string;
  /** Release tag this package was built from, e.g. "v0.2.2". */
  version: string;
}

export type ShellUpdateStatus = "update-available" | "up-to-date" | "unconfigured" | "offline";

export interface ShellUpdateResult {
  status: ShellUpdateStatus;
  /** Newest release tag, when one was read. */
  latest?: string;
  /** The tag this package was built from. */
  current?: string;
  /** Human-readable release name, when the API gave one. */
  name?: string;
}

export function shellInfo(): ShellInfo | null {
  const raw = (globalThis as { __ZF_SHELL__?: Partial<ShellInfo> }).__ZF_SHELL__;
  if (!raw || typeof raw.repo !== "string" || typeof raw.version !== "string") return null;
  // A shell that couldn't determine its own origin ships empty strings rather than
  // guessing at this repository's name; treat that as "no update channel".
  if (!raw.repo || !raw.version) return null;
  return { kind: typeof raw.kind === "string" ? raw.kind : "unknown", repo: raw.repo, version: raw.version };
}

/** Numeric-aware comparison of two release tags: -1, 0 or 1.
 *
 *  Tags are compared field by field on their numbers, so v0.2.10 is correctly
 *  newer than v0.2.9 (a string compare would say otherwise). Anything
 *  unparseable falls back to "different means newer", which errs toward telling
 *  the player something exists rather than hiding it. */
export function compareVersions(a: string, b: string): number {
  const parts = (raw: string) => {
    const cleaned = raw.trim().replace(/^v/i, "");
    const numbers = cleaned.split(/[.+-]/).map((piece) => Number.parseInt(piece, 10));
    return numbers.map((n) => (Number.isFinite(n) ? n : 0));
  };
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

/** The releases page a player is sent to when they accept an update. */
export function releasesUrl(info: ShellInfo): string {
  return `https://github.com/${info.repo}/releases/latest`;
}

/** Ask the shell's repository for its newest release.
 *
 *  Never throws: a player with no internet is the normal case here, and it must
 *  read as "couldn't reach", not as a broken button. */
export async function checkShellUpdate(
  info: ShellInfo | null = shellInfo(),
  fetchImpl: typeof fetch = fetch,
): Promise<ShellUpdateResult> {
  if (!info) return { status: "unconfigured" };
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${info.repo}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" },
    );
    if (!response.ok) return { status: "offline" };
    const body = (await response.json()) as { tag_name?: unknown; name?: unknown };
    const latest = typeof body.tag_name === "string" ? body.tag_name : "";
    if (!latest) return { status: "offline" };
    const name = typeof body.name === "string" ? body.name : undefined;
    return compareVersions(latest, info.version) > 0
      ? { status: "update-available", latest, current: info.version, name }
      : { status: "up-to-date", latest, current: info.version, name };
  } catch {
    return { status: "offline" };
  }
}

/** Hand the player off to the download page.
 *
 *  The desktop app has no browser to open a link with, so its shell exposes
 *  `/__open-release` and builds the URL itself from its own configuration —
 *  nothing here can steer it somewhere else. The launcher runs in a real browser,
 *  where a new tab is enough, and falls back to that if the endpoint is missing. */
export async function openReleasePage(
  info: ShellInfo,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl("/__open-release", { method: "POST" });
    if (response.ok) return true;
  } catch {
    // fall through to the browser path
  }
  try {
    return globalThis.open?.(releasesUrl(info), "_blank", "noopener") != null;
  } catch {
    return false;
  }
}

/** Settings row text for a completed check. */
export function shellUpdateMessage(result: ShellUpdateResult): string {
  switch (result.status) {
    case "update-available":
      return `${result.latest} is available — you have ${result.current}.`;
    case "up-to-date":
      return `You have the latest version (${result.current}).`;
    case "offline":
      return "Couldn't reach the update server — check your connection.";
    case "unconfigured":
      return "Update checks aren't available in this build.";
  }
}
