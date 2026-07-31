export type HarvestTarget =
  | { kind: "plot"; oc: number; or: number; isZombie: boolean }
  | { kind: "tree"; instanceId: string };

export interface StrokePoint {
  x: number;
  y: number;
}

export const harvestTargetKey = (target: HarvestTarget): string => target.kind === "plot"
  ? `plot:${target.oc},${target.or}`
  : `tree:${target.instanceId}`;

/** Append a harvest target once while retaining the order in which the stroke
 * first crossed it. JobSystem performs its own pending-job deduplication too;
 * this set keeps backtracking from producing redundant previews/enqueue calls. */
export function appendHarvestTarget(
  target: HarvestTarget,
  targets: HarvestTarget[],
  seen: Set<string>,
): boolean {
  const key = harvestTargetKey(target);
  if (seen.has(key)) return false;
  seen.add(key);
  targets.push(target);
  return true;
}

/** Pointer events may be much farther apart than a farm plot during a quick
 * swipe. Return intermediate points no farther than `maxStep` apart, excluding
 * the already-processed start and including the current pointer position. */
export function sampleStrokeSegment(
  start: StrokePoint,
  end: StrokePoint,
  maxStep = 8,
): StrokePoint[] {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (distance === 0) return [];
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, maxStep)));
  const points: StrokePoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
  }
  return points;
}
