// ---------------------------------------------------------------------------
// Per-zombie mutation visibility
// ---------------------------------------------------------------------------
// The Settings switch (prefs.showMutations) is all-or-nothing: either every zombie
// on the farm wears its vegetables or none of them do. This is the per-unit
// version, driven from the zombie's own card — a player who likes the Pumpking a
// combine gave them but not the celery arms it came home with can drop just the
// arms, on that one zombie.
//
// Hiding is PURELY COSMETIC. The unit's stored mask is never touched, so its
// stats, its slot occupancy in the Zombie Pot, the Black Market's mutation
// filters, and the server's raid verifier all still see every mutation it
// carries. Only the drawing changes — exactly like the two switches in
// appearance.ts, which this composes with (mutations off globally wins).
//
// Stored device-local, next to the roster sort and the other view preferences,
// rather than in the save: it is a choice about how THIS device draws the farm,
// not account progression, and the save's zombie field is server-owned.
import { maskHas, maskUnion, maskWithout } from "./mutationMask";

const HIDDEN_KEY = "zf2r.zombieHiddenMutations";

// The same browser can own several Local Farms and an Online Farm, while zombie
// ids are only unique inside one farm. main.ts replaces this fallback before any
// owned zombie is rendered; keeping a default makes isolated previews/tests safe.
let farmScope = "device";

function storageKey(): string {
  return `${HIDDEN_KEY}:${encodeURIComponent(farmScope)}`;
}

/** zombie id -> the mask of mutation bits hidden on it. Parsed once and kept, so a
 *  rig rebuild (which walks every unit) does not re-parse the whole map per zombie.
 *  `null` = not read yet. */
let cache: Record<string, number> | null = null;

/** Select the farm whose device-local drawing preferences are being used. */
export function configureMutationVisibilityScope(scope: string): void {
  const next = scope.trim() || "device";
  if (next === farmScope) return;
  farmScope = next;
  cache = null;
}

function read(): Record<string, number> {
  if (cache) return cache;
  cache = {};
  try {
    const key = storageKey();
    const scoped = localStorage.getItem(key);
    // Older builds had one device-wide map. Adopt it for the farm that is open
    // during the upgrade, then delete it so no other farm can inherit it later.
    const legacy = scoped === null ? localStorage.getItem(HIDDEN_KEY) : null;
    const raw = scoped ?? legacy;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [id, mask] of Object.entries(parsed as Record<string, unknown>)) {
        // A hand-edited or half-written entry must not take a rig down with it: a
        // mask that is not a usable non-negative integer simply means "nothing
        // hidden on this zombie".
        if (typeof mask === "number" && Number.isSafeInteger(mask) && mask > 0) {
          cache[id] = mask;
        }
      }
    }
    if (legacy !== null) {
      if (Object.keys(cache).length) localStorage.setItem(key, JSON.stringify(cache));
      localStorage.removeItem(HIDDEN_KEY);
    }
  } catch {
    /* storage denied or corrupt: everything is visible, which is the default */
  }
  return cache;
}

function write(map: Record<string, number>): void {
  cache = map;
  try {
    const key = storageKey();
    if (Object.keys(map).length) localStorage.setItem(key, JSON.stringify(map));
    else localStorage.removeItem(key);
  } catch {
    /* the preference is optional; the in-memory copy still applies this session */
  }
}

/** Drop the remembered state, so the next read comes from storage again. Tests
 *  only — the app has one storage area and one cache over it for its lifetime. */
export function resetMutationVisibilityCache(): void {
  cache = null;
}

/** Every mutation bit hidden on this zombie. 0 for a zombie with no card of its
 *  own (a catalog preview, an Almanac entry, another player's Market listing). */
export function hiddenMutations(id: string | undefined): number {
  return id ? read()[id] ?? 0 : 0;
}

/** Is this one mutation hidden on this zombie? `bit` is a single mutation bit. */
export function isMutationHidden(id: string | undefined, bit: number): boolean {
  return maskHas(hiddenMutations(id), bit);
}

/** Show or hide ONE mutation on ONE zombie. */
export function setMutationHidden(id: string, bit: number, hidden: boolean): void {
  const map = { ...read() };
  const before = map[id] ?? 0;
  const after = hidden ? maskUnion(before, bit) : maskWithout(before, bit);
  if (after === before) return;
  if (after > 0) map[id] = after;
  else delete map[id];
  write(map);
}

/** The mask to DRAW for this zombie: what it carries, minus what its card hides.
 *  Every rig and portrait that knows which owned unit it is drawing runs its mask
 *  through here before handing it to displayedAppearance. */
export function visibleMutations(id: string | undefined, mask: number): number {
  const hidden = hiddenMutations(id);
  return hidden ? maskWithout(mask, hidden) : mask;
}

/** Forget the entries for zombies that no longer exist.
 *
 *  Zombie ids are allocated as `z<n>` from the highest one in the roster, so
 *  selling the newest zombie frees its id for the next one grown — and without
 *  this the new zombie would inherit the sold one's hidden mutations. Called
 *  whenever the full owned roster is in hand (the Zombies panel builds it), which
 *  makes this self-healing rather than something every removal path must
 *  remember. */
export function pruneMutationVisibility(liveIds: Iterable<string>): void {
  const map = read();
  const ids = Object.keys(map);
  if (!ids.length) return;
  const live = new Set(liveIds);
  const kept: Record<string, number> = {};
  for (const id of ids) if (live.has(id)) kept[id] = map[id];
  if (Object.keys(kept).length !== ids.length) write(kept);
}
