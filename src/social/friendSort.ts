// ---------------------------------------------------------------------------
// Friends-list ordering
// ---------------------------------------------------------------------------
// Sorting is purely a display choice over the cached list — the server returns
// friends alphabetically and knows nothing about this. Kept out of the DOM code so
// the tie-breaking is testable: every mode falls back to name, then to id, so the
// order is total and a re-render never reshuffles equal rows.
import type { Friend } from "./friends";

export type FriendSort = "giftable" | "level" | "giftsReceived" | "name";

export const FRIEND_SORTS: { id: FriendSort; label: string }[] = [
  { id: "giftable", label: "Ready to gift" },
  { id: "level", label: "Level" },
  { id: "giftsReceived", label: "Gifts to you" },
  { id: "name", label: "Name" },
];

export const DEFAULT_FRIEND_SORT: FriendSort = "giftable";

export function isFriendSort(value: unknown): value is FriendSort {
  return FRIEND_SORTS.some((s) => s.id === value);
}

/** Case-insensitive name order; unnamed friends sink below named ones. */
function byName(a: Friend, b: Friend): number {
  const an = a.name?.trim() ?? "";
  const bn = b.name?.trim() ?? "";
  if (!an !== !bn) return an ? -1 : 1;
  return an.localeCompare(bn, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

/** Whether this friend can still receive a gift right now. Offline entries have no
 *  server cooldown, so the caller passes the locally-computed answer instead. */
type Giftable = (f: Friend) => boolean;

/** Order `friends` for display. Never mutates the input — the cache stays in the
 *  server's own order so a refresh can diff against it. */
export function sortFriends(
  friends: readonly Friend[],
  sort: FriendSort,
  giftable: Giftable
): Friend[] {
  const rows = [...friends];
  switch (sort) {
    case "level":
      // Unknown level sorts last rather than as level 0: "we don't know" is not
      // the same claim as "they're a beginner".
      return rows.sort((a, b) =>
        (b.level ?? -1) - (a.level ?? -1) || byName(a, b));
    case "giftsReceived":
      return rows.sort((a, b) =>
        (b.giftsReceived ?? 0) - (a.giftsReceived ?? 0) || byName(a, b));
    case "name":
      return rows.sort(byName);
    case "giftable":
    default:
      // The actionable ones first — this is the list you scan to decide who to gift.
      return rows.sort((a, b) =>
        Number(giftable(b)) - Number(giftable(a)) || byName(a, b));
  }
}
