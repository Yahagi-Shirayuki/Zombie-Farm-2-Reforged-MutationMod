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

/** Where a drag-plow stroke should actually lay a plot for a pointer on (col,row).
 *
 *  First choice is `snapPlowOrigin`, which keeps a swipe's plots edge-to-edge instead of a
 *  smeared overlap per tile crossed. But that lattice comes from wherever the finger
 *  happened to go down, and it is NOT shared with the plots already on the farm — so
 *  taking it as the only answer meant a swipe running alongside an existing row failed for
 *  exactly the stretch beside it and worked at both ends. That is the reported "it leaves
 *  3-4 pieces unplowed around the centre of my selection": measured on a real save, the
 *  SAME swipe laid 12 plots or 5 depending only on which tile it started from, one row
 *  apart.
 *
 *  So when the lattice square will not fit, nudge instead of dropping the plot: consider
 *  every origin whose 4x4 still covers the tile under the pointer — the player asked for
 *  soil HERE — and take whichever fits and sits closest to the lattice. The plot stays
 *  under the finger, the run stays as aligned as the ground allows, and it relaxes back
 *  onto the lattice the moment the obstruction is past.
 *
 *  `fits` answers whether a 4x4 at that origin can be laid right now — free ground, and
 *  not already claimed earlier in this same stroke. Returns null when nothing fits, which
 *  is the honest answer for a pointer over ground that is genuinely full.
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
