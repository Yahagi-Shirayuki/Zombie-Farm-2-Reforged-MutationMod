// Player-facing preferences persisted in local storage.
// These are persisted to localStorage and read at the points that care about them.
//
// The sprite toggle is surfaced in Settings:
//
//   • Sprite set — "zf1" (original Zombie Farm art) vs "zf2" (the sequel's art
//     this reimplementation is built from). This is a PLACEHOLDER: the value is
//     persisted and exposed, but nothing swaps art on it yet. Wiring the ZF1 art
//     pack in is future work (see README "Current Gaps").

import { DEFAULT_FRIEND_SORT, isFriendSort, type FriendSort } from "./social/friendSort";
import { DEFAULT_ZOMBIE_SORT, isZombieSort, type ZombieSort } from "./zombie/rosterSort";

export type SpriteSet = "zf1" | "zf2";
// How lush the decorative foliage ringing the farm is. All three fill the whole
// camera view out to the max zoom-out edge; they differ only in tree density.
export type FarmBackground = "deep-forest" | "woodland" | "light-meadow";
export type DayNightMode = "auto" | "day" | "night";
export const DEFAULT_FARM_BACKGROUND: FarmBackground = "woodland";

export function isFarmBackground(value: unknown): value is FarmBackground {
  return value === "deep-forest" || value === "woodland" || value === "light-meadow";
}

/** How an owned zombie's body is tinted.
 *  • "inherited" — a Zombie Pot child keeps the mixed tint it was born with.
 *  • "species"   — every zombie wears its own species' colour, so a silver made
 *                  from two greens looks silver. */
export type ZombieBodyColorMode = "inherited" | "species";
export const DEFAULT_BODY_COLOR_MODE: ZombieBodyColorMode = "inherited";

/** One device's zombie-appearance choices, read wherever a zombie is drawn. */
export interface ZombieAppearancePrefs {
  bodyColor: ZombieBodyColorMode;
  showMutations: boolean;
}

const SPRITE_KEY = "zf2r.spriteSet";
const FARM_BG_KEY = "zf2r.farmBackground";
const DAY_NIGHT_KEY = "zf2r.dayNight";
const FRIEND_SORT_KEY = "zf2r.friendSort";
const ZOMBIE_SORT_KEY = "zf2r.zombieSort";
const HAZARD_TIP_KEY = "zf2r.seenHazardTip";
const RAID_TIP_KEY = "zf2r.seenRaidTip."; // + raid id
const BODY_COLOR_KEY = "zf2r.zombieBodyColor";
const SHOW_MUTATIONS_KEY = "zf2r.showZombieMutations";

/** localStorage.getItem that survives a browser with storage denied (private mode,
 *  blocked third-party context). Appearance prefs are read while DRAWING, so a throw
 *  here would take the frame with it. */
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference is optional */
  }
}

/** Which body tint a combined zombie shows. Defaults to the inherited mix (what the
 *  Zombie Pot has always produced); "species" makes every unit wear its own type's
 *  colour instead. */
export function getZombieBodyColorMode(): ZombieBodyColorMode {
  return readPref(BODY_COLOR_KEY) === "species" ? "species" : DEFAULT_BODY_COLOR_MODE;
}

export function setZombieBodyColorMode(mode: ZombieBodyColorMode): void {
  writePref(BODY_COLOR_KEY, mode);
}

/** Whether crop mutations are drawn on zombies at all. Defaults to on. */
export function getShowZombieMutations(): boolean {
  return readPref(SHOW_MUTATIONS_KEY) !== "0";
}

export function setShowZombieMutations(on: boolean): void {
  writePref(SHOW_MUTATIONS_KEY, on ? "1" : "0");
}

/** Both appearance choices at once, for the render sites that apply them. */
export function zombieAppearancePrefs(): ZombieAppearancePrefs {
  return { bodyColor: getZombieBodyColorMode(), showMutations: getShowZombieMutations() };
}

/** Which sprite pack to render with. Defaults to ZF2 (the only pack wired today). */
export function getSpriteSet(): SpriteSet {
  return localStorage.getItem(SPRITE_KEY) === "zf1" ? "zf1" : "zf2";
}

export function setSpriteSet(set: SpriteSet): void {
  localStorage.setItem(SPRITE_KEY, set);
}

// Foliage density per background, as a fraction of the base (Deep Forest) tree
// count. Light Meadow is ~1/10 as dense. Because the three share the same seeded
// layout, the sets nest (meadow ⊂ woodland ⊂ deep forest) — switching thins or
// thickens the same forest rather than reshuffling it.
export const FARM_BG_DENSITY: Record<FarmBackground, number> = {
  "deep-forest": 1,
  woodland: 0.45,
  "light-meadow": 0.1,
};

// Ordered options + display labels for the Settings picker.
export const FARM_BACKGROUNDS: { id: FarmBackground; label: string }[] = [
  { id: "deep-forest", label: "Deep Forest" },
  { id: "woodland", label: "Woodland" },
  { id: "light-meadow", label: "Light Meadow" },
];

/** How lush the farm's foliage ring is. Defaults to Woodland (the medium density). */
export function getFarmBackground(): FarmBackground {
  const v = localStorage.getItem(FARM_BG_KEY);
  return isFarmBackground(v) ? v : DEFAULT_FARM_BACKGROUND;
}

export function setFarmBackground(bg: FarmBackground): void {
  localStorage.setItem(FARM_BG_KEY, bg);
}

/** Player lighting preference. Auto follows the browser/device's local clock. */
export function getDayNightMode(): DayNightMode {
  const value = localStorage.getItem(DAY_NIGHT_KEY);
  return value === "day" || value === "night" ? value : "auto";
}

export function setDayNightMode(mode: DayNightMode): void {
  localStorage.setItem(DAY_NIGHT_KEY, mode);
}

/** How the friends list is ordered. Purely a display choice, so it lives here with
 *  the other view preferences rather than in the save. */
export function getFriendSort(): FriendSort {
  const value = localStorage.getItem(FRIEND_SORT_KEY);
  return isFriendSort(value) ? value : DEFAULT_FRIEND_SORT;
}

export function setFriendSort(sort: FriendSort): void {
  localStorage.setItem(FRIEND_SORT_KEY, sort);
}

/** How the "My Zombies" roster is ordered. Like the friends sort this is a view
 *  preference, not progression, so it stays device-local instead of in the save. */
export function getZombieSort(): ZombieSort {
  const value = localStorage.getItem(ZOMBIE_SORT_KEY);
  return isZombieSort(value) ? value : DEFAULT_ZOMBIE_SORT;
}

export function setZombieSort(sort: ZombieSort): void {
  localStorage.setItem(ZOMBIE_SORT_KEY, sort);
}

/** Whether the player has been shown the "tap/click hazards to damage them" tip,
 *  raised once before their first invasion that actually fields a hazard (the
 *  Circus trapeze, the beach crab, the Ninja/Robot wall). Kept device-local rather
 *  than in the save blob: hazards themselves are client-only, so this is a control
 *  hint about THIS device's input, not account progression. A browser that can't
 *  write storage simply sees the tip again — cheaper than failing the launch. */
export function hasSeenHazardTip(): boolean {
  try {
    return localStorage.getItem(HAZARD_TIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function markHazardTipSeen(): void {
  try {
    localStorage.setItem(HAZARD_TIP_KEY, "1");
  } catch {
    /* preference is optional */
  }
}

/** Whether Tim's one-off briefing for a particular invasion has been given yet. Some
 *  raids run on a rule the battlefield never states — the Pirates' Scallywag mirrors
 *  whatever attack speed you bring, so a fast army is answered by a fast enemy — and
 *  the game only ever admitted it in the DEFEAT text, after the lesson had already
 *  cost a fight. Stored per raid id, and device-local for the same reason as the
 *  hazard tip: it is a hint about how to play, not account progression, so a browser
 *  that cannot write storage simply hears Tim out again. */
export function hasSeenRaidTip(raidId: number): boolean {
  try {
    return localStorage.getItem(RAID_TIP_KEY + raidId) === "1";
  } catch {
    return false;
  }
}

export function markRaidTipSeen(raidId: number): void {
  try {
    localStorage.setItem(RAID_TIP_KEY + raidId, "1");
  } catch {
    /* preference is optional */
  }
}

/** Local-clock night window. This avoids requesting precise location permission:
 * 7pm through 6:59am in the device's own timezone. */
export function isLocalNight(at = new Date()): boolean {
  const hour = at.getHours();
  return hour >= 19 || hour < 7;
}
