// Local ids for placed farm objects.
//
// These are PRESENTATION ids. Online, a bought object is created locally under one of
// them (sent as `clientInstanceId`), and the reconcile in main.ts later renames it to the
// server's instance id, keeping an alias local id -> server id so the optimistic object
// and the authoritative one are understood to be the same thing.
//
// That rename is why minting has to be careful. A renamed object no longer looks like
// `o<N>`, so it contributes nothing to a "highest number in use" scan — and rebuilding
// the counter from such a scan handed the SAME id to the next purchase while the
// previous alias was still live. Two server objects then resolved to one local object
// and were both placed on its tile: a purchase, or whatever already stood there (a
// Zombie Pot, say), silently vanished from the farm even though the server still owned
// it. Both functions here exist to make that impossible.
export const OBJECT_ID_PREFIX = "o";

const NUMBERED = /^o(\d+)$/;

/** The numeric part of a minted id, or 0 for any id that was not minted here (a server
 *  instance id, a `reward-sale-*` claim id). */
export function objectIdNumber(id: string): number {
  const match = NUMBERED.exec(id);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Where the counter should sit after restoring `savedIds`.
 *
 * MONOTONIC BY CONTRACT: never below `floor`, whatever the restored ids look like. A
 * save whose objects all carry server instance ids scans to 0, and returning 1 from that
 * would re-issue ids the session has already handed out and aliased.
 */
export function objectIdFloor(floor: number, savedIds: Iterable<string>): number {
  let highest = 0;
  for (const id of savedIds) highest = Math.max(highest, objectIdNumber(id));
  return Math.max(floor, highest + 1);
}

/**
 * The next free id at or after `from`, skipping anything in `taken`.
 *
 * The counter alone cannot guarantee freedom: ids also arrive from saves and from the
 * server, so a bare increment can still land on one that is in use.
 */
export function mintObjectId(
  from: number,
  taken: { has(id: string): boolean }
): { id: string; next: number } {
  let n = Math.max(1, from);
  while (taken.has(`${OBJECT_ID_PREFIX}${n}`)) n++;
  return { id: `${OBJECT_ID_PREFIX}${n}`, next: n + 1 };
}
