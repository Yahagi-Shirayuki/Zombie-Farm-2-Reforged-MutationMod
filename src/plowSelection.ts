import { PLOT } from "./Field";

export interface PlowOrigin {
  oc: number;
  or: number;
}

/** Snap a freehand pointer target to the 4x4 plot lattice established where the
 * stroke began. This keeps neighbouring swipe-plowed plots edge-aligned instead
 * of producing overlapping origins for every individual ground tile crossed. */
export function snapPlowOrigin(anchor: PlowOrigin, current: PlowOrigin): PlowOrigin {
  return {
    oc: anchor.oc + Math.round((current.oc - anchor.oc) / PLOT) * PLOT,
    or: anchor.or + Math.round((current.or - anchor.or) / PLOT) * PLOT,
  };
}

/** Pick the plot origin a drag-plow stroke should lay under this pointer.
 *
 * The stroke still prefers the lattice established by its starting tile, but if
 * that square collides with existing soil, try nearby origins that still cover
 * the tile under the pointer. That keeps a swipe from leaving holes beside an
 * already-plowed row just because its original lattice was offset by one tile.
 */
export function choosePlowOrigin(
  anchor: PlowOrigin,
  col: number,
  row: number,
  pointerOrigin: PlowOrigin,
  fits: (origin: PlowOrigin) => boolean,
): PlowOrigin | null {
  const snapped = snapPlowOrigin(anchor, pointerOrigin);
  if (fits(snapped)) return snapped;
  let best: PlowOrigin | null = null;
  let bestDistance = Infinity;
  for (let oc = col - PLOT + 1; oc <= col; oc++) {
    for (let or = row - PLOT + 1; or <= row; or++) {
      const distance = Math.abs(oc - snapped.oc) + Math.abs(or - snapped.or);
      if (distance >= bestDistance || !fits({ oc, or })) continue;
      best = { oc, or };
      bestDistance = distance;
    }
  }
  return best;
}

/** Build an inclusive plot rectangle on the lattice established by the anchor. */
export function plowRectangle(anchor: PlowOrigin, current: PlowOrigin): PlowOrigin[] {
  const dc = Math.round((current.oc - anchor.oc) / PLOT);
  const dr = Math.round((current.or - anchor.or) / PLOT);
  const minC = Math.min(0, dc);
  const maxC = Math.max(0, dc);
  const minR = Math.min(0, dr);
  const maxR = Math.max(0, dr);
  const out: PlowOrigin[] = [];
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++)
      out.push({ oc: anchor.oc + c * PLOT, or: anchor.or + r * PLOT });
  return out;
}

/** Preserve selection order while ensuring one physical plot is queued at most once. */
export function uniquePlowOrigins<T extends PlowOrigin>(origins: readonly T[]): T[] {
  const seen = new Set<string>();
  return origins.filter(({ oc, or }) => {
    const key = `${oc},${or}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
