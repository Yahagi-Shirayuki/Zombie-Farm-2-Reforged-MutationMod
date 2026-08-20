// Client-side crash capture for beta testing.
//
// DELIBERATELY LOCAL-ONLY. Nothing here contacts the network. Local Farm promises
// (README + SECURITY.md) that it issues no account or gameplay-server request, and a
// silent crash beacon would break that guarantee. Instead we keep a small ring buffer
// in localStorage and let the player copy it into a bug report themselves — which also
// means it works identically in Local Farm, Online Farm, and offline.
//
// If a server-side reporting route is ever added, it must stay Online-Farm-only or be
// explicitly opt-in, and both docs must be updated in the same change.
import { BUILD_ID } from "./version";
import { storagePersistenceLine } from "./storagePersistence";
import { assetFailureLine } from "./assetFailures";
import { clearCrumbs, crumbTimeline, flushCrumbs, readCrumbs } from "./breadcrumbs";

const KEY = "zf2r.diagnostics.v1";
/** Keep the tail short: this shares the localStorage budget with the save itself, and
 *  the first error is usually the informative one — later entries are often cascades. */
const MAX_ENTRIES = 20;
/** Stacks are truncated per entry so one runaway frame can't crowd out the buffer. */
const MAX_STACK_CHARS = 1200;

export interface DiagnosticEntry {
  at: number;
  kind: "error" | "unhandledrejection";
  message: string;
  stack?: string;
  /** Page location minus query/hash — never carries save data or tokens. */
  where?: string;
}

function read(): DiagnosticEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as DiagnosticEntry[]) : [];
  } catch {
    return []; // unparseable or storage blocked (privacy mode) — start clean
  }
}

function write(entries: DiagnosticEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Storage full or blocked. Diagnostics must never break the game, and they are
    // strictly less important than the save that is probably competing for the quota.
  }
}

/** Record one failure. Exported for tests and for callers that catch an error
 *  themselves but still want it in the report. */
export function recordDiagnostic(entry: DiagnosticEntry): void {
  const trimmed: DiagnosticEntry = {
    ...entry,
    message: String(entry.message ?? "").slice(0, 500),
    stack: entry.stack ? String(entry.stack).slice(0, MAX_STACK_CHARS) : undefined,
  };
  write([...read(), trimmed]);
  // An error is exactly the moment the trail describing it must become durable: the
  // failure this pairs with hides the whole HUD, so the player cannot copy a report
  // until they have reloaded to escape. See breadcrumbs.ts.
  flushCrumbs();
}

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: `${reason.name}: ${reason.message}`, stack: reason.stack };
  // Rejections frequently carry a plain object or string rather than an Error.
  try { return { message: typeof reason === "string" ? reason : JSON.stringify(reason) }; }
  catch { return { message: String(reason) }; }
}

let installed = false;

/** Install the global handlers. Idempotent; safe to call before anything else boots. */
export function initDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // `error` on window catches uncaught throws AND (unlike onerror) lets other
  // listeners run. We never preventDefault, so the console still shows everything.
  window.addEventListener("error", (event: ErrorEvent) => {
    const from = event.error instanceof Error
      ? describe(event.error)
      : { message: event.message, stack: undefined };
    recordDiagnostic({
      at: Date.now(),
      kind: "error",
      message: from.message,
      stack: from.stack ?? (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined),
      where: location.pathname,
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const from = describe(event.reason);
    recordDiagnostic({
      at: Date.now(),
      kind: "unhandledrejection",
      message: from.message,
      stack: from.stack,
      where: location.pathname,
    });
  });
}

/** Everything a bug report needs, as pasteable plain text. Contains no save data,
 *  no account id, and no session token — only build/environment and captured errors. */
export function diagnosticsReport(extra?: Record<string, string | number | boolean>): string {
  const entries = read();
  // Environment lookups are guarded: a report is most valuable exactly when something
  // is broken, so this function must never be the thing that throws.
  const screen = typeof window === "undefined"
    ? "unknown"
    : `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio ?? 1}x`;
  const agent = typeof navigator === "undefined" ? "unknown" : navigator.userAgent;
  const head = [
    `Zombie Farm 2 Reforged — diagnostics`,
    `build:    ${BUILD_ID}`,
    `when:     ${new Date().toISOString()}`,
    `screen:   ${screen}`,
    `agent:    ${agent}`,
    // "best-effort (evictable)" here is the answer to "my settings reset when I come
    // back": the browser may throw this origin's whole storage bucket away, and does so
    // silently. See storagePersistence.ts.
    `storage:  ${storagePersistenceLine()}`,
    // Textures that would not load. Counted rather than crumbed one by one — see
    // assetFailures.ts. "none" here rules out a whole class of report in one glance.
    `assets:   ${assetFailureLine()}`,
    ...Object.entries(extra ?? {}).map(([k, v]) => `${(k + ":").padEnd(9)} ${String(v)}`),
    ``,
  ];
  // What the session was DOING, with the gap between steps. The error buffer below can
  // only see things that threw, and the reports that cost the most were the ones where
  // nothing did — a stall, not a crash. See breadcrumbs.ts.
  const trail = readCrumbs();
  const timeline = trail.length
    ? [`recent activity (${trail.length}, newest last):`, ...crumbTimeline(), ``]
    : [`activity: none recorded`, ``];
  const errorHeading =
    entries.length ? `errors (${entries.length}, newest last):` : `errors:   none recorded`;
  const body = entries.map((e, i) => {
    const when = new Date(e.at).toISOString();
    return [
      `--- ${i + 1}. ${e.kind} @ ${when}${e.where ? ` (${e.where})` : ""}`,
      e.message,
      e.stack ?? "(no stack)",
    ].join("\n");
  });
  return [...head, ...timeline, errorHeading, ...body].join("\n");
}

/** Number of captured errors — lets the UI show a count without formatting a report. */
export function diagnosticsCount(): number {
  return read().length;
}

/** Drop the buffer AND the activity trail (after a successful report, or from a reset).
 *  The two are read together, so clearing one and keeping the other would leave a report
 *  whose timeline no longer explains its errors. */
export function clearDiagnostics(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked — nothing to clear */ }
  clearCrumbs();
}
