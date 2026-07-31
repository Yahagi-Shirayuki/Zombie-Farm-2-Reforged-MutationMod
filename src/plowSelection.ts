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
