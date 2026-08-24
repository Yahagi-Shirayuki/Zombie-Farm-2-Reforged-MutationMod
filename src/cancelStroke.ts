// Deselect-by-drag: a press that lands ON a queued action turns the drag into an
// eraser that un-queues every queued plow/plant/harvest/tree job it crosses. These
// helpers mirror harvestStroke.ts: pure target identity + first-crossed ordering,
// with JobSystem.cancelAtTile/cancelObject as the authoritative cancellation.

export type CancelTarget =
  | { kind: "plot"; jobKind: "till" | "plant" | "harvest" | "fence"; oc: number; or: number }
  | { kind: "object"; instanceId: string };

export const cancelTargetKey = (target: CancelTarget): string => target.kind === "object"
  ? `object:${target.instanceId}`
  : `plot:${target.oc},${target.or}`;

/** Append a queued-job target once while retaining the order the stroke first
 * crossed it. Cancellation itself is idempotent; the set keeps backtracking from
 * producing redundant previews/cancel calls. */
export function appendCancelTarget(
  target: CancelTarget,
  targets: CancelTarget[],
  seen: Set<string>,
): boolean {
  const key = cancelTargetKey(target);
  if (seen.has(key)) return false;
  seen.add(key);
  targets.push(target);
  return true;
}
