export type InstaGrowTarget =
  | { kind: "crop"; oc: number; or: number }
  | { kind: "pot"; instanceId: string };

export const instaGrowTargetKey = (target: InstaGrowTarget): string => target.kind === "pot"
  ? `pot:${target.instanceId}`
  : `crop:${target.oc},${target.or}`;

/** Keep one use per crop/pot while preserving the order a drag first crosses them. */
export function appendInstaGrowTarget(
  target: InstaGrowTarget,
  targets: InstaGrowTarget[],
  seen: Set<string>,
): boolean {
  const key = instaGrowTargetKey(target);
  if (seen.has(key)) return false;
  seen.add(key);
  targets.push(target);
  return true;
}
