import { describe, expect, it } from "vitest";
import { XP_THRESHOLDS } from "../src/levels";
import { refreshPeriodicForBootstrap } from "../src/v3/db";

function rowsAtLevel(level: number) {
  return {
    balance: { gold: 0, brains: 0, xp: XP_THRESHOLDS[level - 1] },
    periodic: { version: 0, current_json: JSON.stringify({ daily: null, weekly: null }) },
  };
}

describe("periodic quests during bootstrap", () => {
  it("materializes an eligible player's board before projecting bootstrap", async () => {
    const rows = rowsAtLevel(30);
    refreshPeriodicForBootstrap("account-bootstrap", rows as never, Date.UTC(2026, 7, 8, 12));

    const board = JSON.parse(rows.periodic.current_json);
    expect(board.daily.quests).toHaveLength(3);
    expect(board.weekly.quests).toHaveLength(2);
    expect(rows.periodic.version).toBe(1);
  });

  it("does not write a board below the unlock level", async () => {
    const rows = rowsAtLevel(3);
    refreshPeriodicForBootstrap("account-locked", rows as never, Date.UTC(2026, 7, 8, 12));
    expect(JSON.parse(rows.periodic.current_json)).toEqual({ daily: null, weekly: null });
    expect(rows.periodic.version).toBe(0);
  });
});
