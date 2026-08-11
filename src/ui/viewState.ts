// Where the player had got to inside a panel: which tab it was showing, which page
// it was on, and how far each of its lists was scrolled.
//
// Every panel in the HUD rebuilds its DOM from scratch on each render, so all of
// that was thrown away constantly — reopening the Market dropped you back on page 1
// of Crops, and picking a zombie in the Zombie Pot (which re-renders the whole
// picker) bounced a long roster back to the top. This module is the single place
// that remembers those positions.
//
// Scope is the browser SESSION: held in memory, mirrored into sessionStorage so a
// reload or a reconnect in the same tab lands where it left off, while a brand new
// tab starts clean. None of it belongs in the save — it is a view position, not
// progression, and it must never be able to fail a write or a frame.

const STORE_KEY = "zf2r.viewState";
// Plenty for every panel the game has, and a ceiling in case a key ever gets built
// from something unbounded (an id, a search string) in future.
const MAX_ENTRIES = 400;
// A restored list is often still filling in — portraits load, a grid re-flows — so
// the first write can land short of where the player was. Re-apply a few times,
// backing off, and stop the moment they scroll themselves.
const RESTORE_RETRY_MS = [30, 120, 320];
const SAVE_DEBOUNCE_MS = 400;

/** The part of a scroll container this module touches (so tests need no DOM). */
export interface ScrollBox {
  scrollTop: number;
  isConnected?: boolean;
  addEventListener(type: "scroll", listener: () => void): void;
}

let memory: Map<string, string> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let flushBound = false;

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // storage denied (private mode, blocked third-party context)
  }
}

function store(): Map<string, string> {
  if (memory) return memory;
  memory = new Map();
  try {
    const raw = session()?.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string") memory.set(key, value);
      }
    }
  } catch {
    /* a corrupt or unreadable blob just means starting fresh */
  }
  return memory;
}

function flush(): void {
  const storage = session();
  if (!storage) return;
  try {
    storage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(store())));
  } catch {
    /* remembering the view is always optional */
  }
}

function persistSoon(): void {
  // Scrolling fires continuously; batch the writes rather than serialising the whole
  // map per event. A close/reload mid-debounce is caught by the pagehide flush.
  if (saveTimer !== undefined) return;
  saveTimer = setTimeout(() => { saveTimer = undefined; flush(); }, SAVE_DEBOUNCE_MS);
  if (flushBound || typeof window === "undefined") return;
  flushBound = true;
  window.addEventListener("pagehide", flush);
}

/** Remember one view position under `key`. */
export function remember(key: string, value: string | number): void {
  const map = store();
  map.set(key, String(value));
  if (map.size > MAX_ENTRIES) {
    // Map iterates in insertion order, so this drops the least recently added keys.
    const excess = map.size - MAX_ENTRIES;
    let dropped = 0;
    for (const old of map.keys()) {
      map.delete(old);
      if (++dropped >= excess) break;
    }
  }
  persistSoon();
}

export function recall(key: string): string | undefined {
  return store().get(key);
}

/** A remembered number (page index, scroll offset), or `fallback` if unseen. */
export function recallNumber(key: string, fallback = 0): number {
  const value = Number(store().get(key));
  return Number.isFinite(value) ? value : fallback;
}

/** A remembered choice, validated against what the panel actually offers today —
 *  a tab can be renamed or removed between sessions, and a stale one must not open
 *  the panel onto nothing. */
export function recallOneOf<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = store().get(key);
  return allowed.includes(value as T) ? (value as T) : fallback;
}

interface Tracked {
  key: string;
  /** The last scrollTop this module wrote, or the player's last real position. Used
   *  to tell our own restore's echoing scroll events apart from theirs. */
  at: number;
}

const tracked = new WeakMap<ScrollBox, Tracked>();

/** Restore `el`'s scroll position for `key`, and keep remembering it as the player
 *  scrolls. Call it right after (re)filling the container — including on a re-render
 *  of the same view, which is what keeps the Zombie Pot's picker still. Passing a
 *  different key for the same element switches views (Market tab, Storage tab). */
export function keepScroll(el: ScrollBox, key: string): void {
  let entry = tracked.get(el);
  if (!entry) {
    entry = { key, at: 0 };
    tracked.set(el, entry);
    const box = entry;
    el.addEventListener("scroll", () => {
      const now = el.scrollTop;
      if (now === box.at) return; // our own restore, echoed back
      box.at = now;
      remember(box.key, now);
    });
  }
  entry.key = key;
  restore(el, entry, Math.max(0, recallNumber(key, 0)));
}

function restore(el: ScrollBox, entry: Tracked, target: number): void {
  const key = entry.key;
  let written = -1;
  let done = false;
  const write = () => {
    if (done) return;
    // Abandon quietly if the panel closed, the view switched under us, or the player
    // has already scrolled somewhere of their own accord.
    if (el.isConnected === false || entry.key !== key || (written >= 0 && entry.at !== written)) {
      done = true;
      return;
    }
    el.scrollTop = target;
    // Read back: a container whose content is still short clamps the write, which is
    // the signal to try again once more of the list exists.
    written = el.scrollTop;
    entry.at = written;
    if (written >= target) done = true;
  };
  write();
  if (done) return;
  for (const delay of RESTORE_RETRY_MS) setTimeout(write, delay);
}

/** Drop every remembered position (used by tests; also safe on sign-out). */
export function forgetViewState(): void {
  memory = new Map();
  if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined; }
  try {
    session()?.removeItem(STORE_KEY);
  } catch {
    /* nothing to clean up */
  }
}
