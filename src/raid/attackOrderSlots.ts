/**
 * The army picker's attack order is SLOTTED: the index of a zombie in the array is
 * its attack position, and removing one leaves its slot EMPTY rather than pulling
 * everyone behind it forward. The next card tapped drops into the lowest empty
 * slot, so swapping out the zombie that leads the charge is one tap out and one tap
 * in — it no longer means re-picking the whole line.
 *
 * A gap only exists while the picker is open: `compactOrder` closes them on launch,
 * so the raid itself always receives a continuous attack order.
 */
export type OrderSlots = (string | null)[];

/** Drop empty slots off the end: a trailing gap is indistinguishable from a shorter
 * order, and keeping it would make the array grow past the cap for no reason. */
function trimTrailing(slots: OrderSlots): OrderSlots {
  let end = slots.length;
  while (end > 0 && slots[end - 1] === null) end--;
  return end === slots.length ? slots : slots.slice(0, end);
}

/** How many zombies are actually picked (gaps don't count towards the cap or min). */
export function selectedCount(slots: OrderSlots): number {
  return slots.reduce<number>((n, id) => (id ? n + 1 : n), 0);
}

/** Tap a card: pick it into the lowest empty slot, or un-pick it and leave a gap. */
export function toggleSlot(slots: OrderSlots, id: string, cap: number): OrderSlots {
  const at = slots.indexOf(id);
  if (at >= 0) {
    const next = slots.slice();
    next[at] = null;
    return trimTrailing(next);
  }
  const gap = slots.indexOf(null);
  if (gap >= 0) {
    const next = slots.slice();
    next[gap] = id;
    return next;
  }
  if (slots.length >= Math.max(0, cap)) return slots;
  return [...slots, id];
}

/** The order the raid is launched with: gaps closed, positions otherwise kept. */
export function compactOrder(slots: OrderSlots): string[] {
  return slots.filter((id): id is string => !!id);
}

/** "Pick for me": keep every valid pick where it stands, then fill the gaps (and the
 * slots past the end) from the remembered order, then from anyone else eligible. */
export function fillSlots(
  slots: OrderSlots,
  preferredIds: string[],
  eligibleIds: string[],
  cap: number,
): OrderSlots {
  const limit = Math.max(0, cap);
  const eligible = new Set(eligibleIds);
  const next: OrderSlots = slots
    .slice(0, limit)
    .map((id) => (id && eligible.has(id) ? id : null));
  const taken = new Set(compactOrder(next));
  const queue: string[] = [];
  for (const id of [...preferredIds, ...eligibleIds]) {
    if (eligible.has(id) && !taken.has(id) && !queue.includes(id)) queue.push(id);
  }
  for (let i = 0; i < limit && queue.length; i++) {
    if (i >= next.length) next.push(null);
    if (next[i] === null) next[i] = queue.shift()!;
  }
  return trimTrailing(next);
}
