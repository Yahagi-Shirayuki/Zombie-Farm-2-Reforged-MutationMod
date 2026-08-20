// A short trail of what the player was DOING, carried into the diagnostics report.
//
// WHY THIS EXISTS. The error buffer next door (diagnostics.ts) can only see things that
// THREW. Two of the hardest reports of this beta both arrived saying `errors: none
// recorded`, and in both cases that was accurate:
//
//   * the Epic Boss "green screen" was a TIMING — a three-second stall inside a `catch`
//     that returns null, behaving exactly as written. No exception-based capture could
//     ever have seen it. A trail would have handed it over in one line:
//     `battle:launch` → `battle:ready +4110ms`.
//   * "my settings don't save" never failed loudly either, and is still open.
//
// So the report needs to say what the session was doing, not only what broke. The DELTA
// between crumbs is the part that earns its place: a step that takes four seconds when it
// should take one is invisible in a log of events and obvious in a log of gaps.
//
// SAME LOCAL-ONLY CONTRACT AS diagnostics.ts. Nothing here contacts the network, and
// nothing may carry save data, an account id, a session token, or anything a player typed:
// a crumb is a fixed `tag` plus a short structural `detail` (a catalog name, an asset path,
// a count). Local Farm promises it issues no request at all, and this must not become the
// exception.
//
// It SURVIVES A RELOAD on purpose. The failure this was built for hides the whole HUD, so
// the player cannot open Settings to copy a report until they have reloaded to escape —
// by which point an in-memory trail would be gone, along with the only evidence.

const KEY = "zf2r.crumbs.v1";
/** Long enough to hold a battle launch and its aftermath, short enough that it shares the
 *  localStorage budget with the save without argument (~40 x 80 bytes). */
const MAX_ENTRIES = 40;
/** A detail is a label, not a payload. Truncated so one long value cannot crowd the ring. */
const MAX_DETAIL_CHARS = 120;
/** Crumbs arrive in bursts (a battle launch fires several in a frame); batch the writes
 *  rather than serialising the whole ring per crumb. A close mid-debounce is caught by the
 *  pagehide flush, and an error flushes immediately — see diagnostics.recordDiagnostic. */
const SAVE_DEBOUNCE_MS = 1000;

export interface Crumb {
  /** When this step FIRST happened. A repeated step keeps its first time; see `last`. */
  at: number;
  /** Stable, greppable category — `battle:launch`, `assets`, `save`. */
  tag: string;
  /** Short structural detail. Never free text from the player. */
  detail?: string;
  /** How many times in a row this exact step happened (absent = once). */
  repeat?: number;
  /** When the last of a repeated run happened (absent unless `repeat` > 1). */
  last?: number;
}

let trail: Crumb[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let flushBound = false;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // storage denied (private mode, blocked third-party context)
  }
}

function ring(): Crumb[] {
  if (trail) return trail;
  trail = [];
  try {
    const raw = storage()?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      for (const entry of parsed as Crumb[]) {
        if (entry && typeof entry.at === "number" && typeof entry.tag === "string") {
          trail.push({
            at: entry.at,
            tag: entry.tag,
            detail: typeof entry.detail === "string" ? entry.detail : undefined,
            repeat: typeof entry.repeat === "number" ? entry.repeat : undefined,
            last: typeof entry.last === "number" ? entry.last : undefined,
          });
        }
      }
    }
  } catch {
    /* a corrupt or unreadable trail just means starting fresh */
  }
  return trail;
}

/** Write the ring out now. Exported for the pagehide hook, for tests, and for
 *  `recordDiagnostic` — an error is exactly the moment the trail must become durable. */
export function flushCrumbs(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  const target = storage();
  if (!target || !trail) return;
  try {
    target.setItem(KEY, JSON.stringify(trail));
  } catch {
    // A trail is always optional and is competing with the save for the quota. Silent by
    // design here: prefs.ts already raises the one "this device won't keep things" notice,
    // and a second toast for a debugging aid would be noise on top of a real problem.
  }
}

function persistSoon(): void {
  if (saveTimer === undefined) {
    saveTimer = setTimeout(() => { saveTimer = undefined; flushCrumbs(); }, SAVE_DEBOUNCE_MS);
  }
  if (flushBound || typeof window === "undefined") return;
  flushBound = true;
  window.addEventListener("pagehide", flushCrumbs);
}

/**
 * Record one step. Never throws and never awaits — this is called from battle launches
 * and asset loaders, so it has to be safe from anywhere, including a render path.
 *
 * Keep `tag` stable and `detail` short and structural: the report is read by eye and
 * grepped, and it is pasted into a public bug report by the player.
 */
export function crumb(tag: string, detail?: string): void {
  try {
    const entries = ring();
    const now = Date.now();
    const text = detail === undefined ? undefined : String(detail).slice(0, MAX_DETAIL_CHARS);
    // A step that repeats COLLAPSES rather than filling the ring. Retry loops are the
    // normal shape of the failures worth reporting — a rejected command batch resends on
    // a backoff, a broken connection fails a texture per asset — and forty copies of one
    // step would push out the steps that explain it. The first time and the last are both
    // kept, which is what "it has been failing for four minutes" is made of.
    const previous = entries[entries.length - 1];
    if (previous && previous.tag === tag && previous.detail === text) {
      previous.repeat = (previous.repeat ?? 1) + 1;
      previous.last = now;
    } else {
      entries.push({ at: now, tag, detail: text });
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    }
    persistSoon();
  } catch {
    /* a breadcrumb must never be the thing that breaks the step it is describing */
  }
}

/** The trail, oldest first. */
export function readCrumbs(): Crumb[] {
  return ring().slice();
}

/**
 * The trail as report lines: wall-clock time, the gap since the previous step, then the
 * step itself. The gap column is the one that finds stalls — it is what would have named
 * the Epic Boss bug on sight.
 */
export function crumbTimeline(): string[] {
  const entries = ring();
  let previous = 0;
  return entries.map((entry, index) => {
    const when = new Date(entry.at).toISOString().slice(11, 23); // HH:MM:SS.mmm, UTC
    const gap = index === 0 ? "" : `+${entry.at - previous}ms`;
    // A repeated step advances the clock to its LAST occurrence, so the next step's gap
    // is measured from when the repeating actually stopped rather than when it began.
    previous = entry.last ?? entry.at;
    const repeated = entry.repeat && entry.repeat > 1
      ? ` (x${entry.repeat} over ${Math.round(((entry.last ?? entry.at) - entry.at) / 1000)}s)`
      : "";
    return `  ${when}  ${gap.padStart(9)}  ${entry.tag.padEnd(16)}${entry.detail ?? ""}${repeated}`
      .trimEnd();
  });
}

/** Drop the trail (alongside the error buffer, from a report or a reset). */
export function clearCrumbs(): void {
  trail = [];
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* nothing to clean up */
  }
}
