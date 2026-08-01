/** Market crop order: permanent catalog first, holiday/seasonal catalog last;
 * unlock level orders entries within each group. Stable sort preserves authored
 * order for entries tied on both keys. */
export function compareCropMarketOrder(
  a: { seasonal?: boolean; level: number },
  b: { seasonal?: boolean; level: number }
): number {
  return Number(!!a.seasonal) - Number(!!b.seasonal) || a.level - b.level;
}

/** Market item order: permanent items first, seasonal/event items last; unlock
 * level orders entries within each group. */
export function compareItemMarketOrder(
  a: { seasonal?: boolean; level: number },
  b: { seasonal?: boolean; level: number }
): number {
  return Number(!!a.seasonal) - Number(!!b.seasonal) || a.level - b.level;
}
