import { FIELD_W, type SimUnit } from "./BattleSim";

export type RaidExitDirection = -1 | 1;

// mapX leaves a 10% inset on each side of the authored stage. These thresholds
// carry the actor origin beyond that inset plus a full zombie-width margin, so
// the result panel cannot arrive while part of the army is still visible.
export const RAID_EXIT_LEFT_X = -160;
export const RAID_EXIT_RIGHT_X = FIELD_W + 160;

export function advanceRaidArmy(
  units: readonly SimUnit[],
  direction: RaidExitDirection,
  speed: number,
  dtMs: number,
): void {
  const dx = direction * speed * Math.max(0, dtMs) / 1000;
  for (const unit of units) {
    if (unit.team === "player" && unit.alive && !unit.taken) unit.x += dx;
  }
}

export function raidArmyHasExited(
  units: readonly SimUnit[],
  direction: RaidExitDirection,
): boolean {
  return units.every((unit) => {
    if (unit.team !== "player" || !unit.alive || unit.taken || unit.buddyCarrierId) return true;
    return direction < 0 ? unit.x <= RAID_EXIT_LEFT_X : unit.x >= RAID_EXIT_RIGHT_X;
  });
}
