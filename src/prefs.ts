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

export type SpriteSet = "zf1" | "zf2";
// How lush the decorative foliage ringing the farm is. All three fill the whole
// camera view out to the max zoom-out edge; they differ only in tree density.
export type FarmBackground = "deep-forest" | "woodland" | "light-meadow";
export type DayNightMode = "auto" | "day" | "night";
export const DEFAULT_FARM_BACKGROUND: FarmBackground = "woodland";

export function isFarmBackground(value: unknown): value is FarmBackground {
  return value === "deep-forest" || value === "woodland" || value === "light-meadow";
}

const SPRITE_KEY = "zf2r.spriteSet";
const FARM_BG_KEY = "zf2r.farmBackground";
const DAY_NIGHT_KEY = "zf2r.dayNight";
const FRIEND_SORT_KEY = "zf2r.friendSort";
const HAZARD_TIP_KEY = "zf2r.seenHazardTip";

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

/** Local-clock night window. This avoids requesting precise location permission:
 * 7pm through 6:59am in the device's own timezone. */
export function isLocalNight(at = new Date()): boolean {
  const hour = at.getHours();
  return hour >= 19 || hour < 7;
}
