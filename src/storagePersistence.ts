// Ask the browser to stop evicting this origin's storage, and report what it said.
//
// WHY THIS EXISTS. Reported as "settings don't save when I exit the browser and come
// back, and I never cleared any site data". Every setting the game keeps is a plain
// `localStorage` write that succeeds at the time — the value is demonstrably there on a
// reload — so nothing in the writing code can explain a value that is gone at the next
// cold start.
//
// What CAN explain it is eviction. Browser storage defaults to "best effort": under
// storage pressure the quota manager evicts a whole origin at once, and Cache Storage,
// localStorage and IndexedDB all go together. This game is an unusually strong candidate
// for that — the service worker runtime-caches roughly 88 MB of artwork CacheFirst — and
// an ONLINE player would see exactly what was reported and nothing else, because the
// farm itself comes back from the server. Only the device-local half (preferences, audio
// settings) lives in the bucket that was thrown away.
//
// `navigator.storage.persist()` moves the origin to "persistent", which is exempt from
// that sweep. Chromium grants it silently on the engagement/installation signals a game
// played repeatedly will already have; Firefox prompts; Safari grants on its own rules.
// A refusal is not an error — it is the browser saying storage may still be reclaimed —
// so this never blocks or retries, it only records what happened for the diagnostics
// report, which is what makes the next report of this decidable rather than a guess.
//
// Deliberately no UI: a permission prompt at boot for something the player has not asked
// about is worse than the risk it hedges, and the Local Farm save has always had its own
// Export button for the case that actually loses data.

/** What the browser said about keeping this origin's data. */
export interface StoragePersistence {
  /** true = exempt from eviction, false = best-effort, null = the browser can't say. */
  persisted: boolean | null;
  /** Bytes this origin is using, per `StorageManager.estimate` (null = unavailable). */
  usage: number | null;
  /** Bytes this origin may use before the browser pushes back (null = unavailable). */
  quota: number | null;
}

let last: StoragePersistence = { persisted: null, usage: null, quota: null };

/** The most recent answer, for the diagnostics report. Never throws, never awaits — a
 *  report is most useful exactly when something is broken. */
export function storagePersistence(): StoragePersistence {
  return last;
}

/** One line for the diagnostics report. */
export function storagePersistenceLine(): string {
  const { persisted, usage, quota } = last;
  const mb = (n: number | null) => (n === null ? "?" : `${Math.round(n / 1_000_000)}MB`);
  const state = persisted === null ? "unknown" : persisted ? "persistent" : "best-effort (evictable)";
  return `${state}, ${mb(usage)} of ${mb(quota)}`;
}

/** Request persistent storage and record the outcome. Call once at boot; safe to call
 *  where the API doesn't exist. Fire-and-forget — nothing waits on the answer. */
export async function requestPersistentStorage(): Promise<StoragePersistence> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage) return last;

  let persisted: boolean | null = null;
  try {
    // `persisted()` first: where the grant already stands there is nothing to ask for,
    // and re-asking is what turns a silent grant into a repeat prompt on Firefox.
    persisted = typeof storage.persisted === "function" ? await storage.persisted() : null;
    if (persisted === false && typeof storage.persist === "function") {
      persisted = await storage.persist();
    }
  } catch {
    persisted = null; // denied by policy, or unimplemented behind a live property
  }

  let usage: number | null = null;
  let quota: number | null = null;
  try {
    if (typeof storage.estimate === "function") {
      const estimate = await storage.estimate();
      usage = typeof estimate.usage === "number" ? estimate.usage : null;
      quota = typeof estimate.quota === "number" ? estimate.quota : null;
    }
  } catch {
    /* an estimate is a nicety; its absence must not colour the persisted answer */
  }

  last = { persisted, usage, quota };
  return last;
}
