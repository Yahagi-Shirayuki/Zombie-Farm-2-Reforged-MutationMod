import { describe, expect, it } from "vitest";
import { epicBossRunToClient, serverTimestampToClient } from "./clock";

const run = {
  runId: "run-1", bossId: "boss-1", level: 2, maxHp: 100, currentHp: 40,
  tokenCount: 1, attackOrder: ["a", "b"],
  activatedAt: 1_000, expiresAt: 5_000, encounterStartedAt: 0,
  retryReadyAt: 3_000, completedAt: 0,
};

describe("serverTimestampToClient", () => {
  it("shifts an authoritative epoch by the observed clock offset", () => {
    // Server said 3_000 at a moment the browser called 4_200: it runs 1_200ms ahead.
    expect(serverTimestampToClient(3_000, 3_000, 4_200)).toBe(4_200);
    expect(serverTimestampToClient(9_000, 3_000, 4_200)).toBe(10_200);
  });

  it("leaves the unset sentinel alone so 'never' cannot drift into a real time", () => {
    expect(serverTimestampToClient(0, 3_000, 4_200)).toBe(0);
    expect(serverTimestampToClient(-1, 3_000, 4_200)).toBe(-1);
  });
});

describe("epicBossRunToClient", () => {
  it("moves every run epoch into the browser clock domain", () => {
    const translated = epicBossRunToClient(run, 2_000, 2_500)!;

    expect(translated.activatedAt).toBe(1_500);
    expect(translated.expiresAt).toBe(5_500);
    expect(translated.retryReadyAt).toBe(3_500);
    // 0 means "not started" / "not completed"; it must not become a real timestamp.
    expect(translated.encounterStartedAt).toBe(0);
    expect(translated.completedAt).toBe(0);
  });

  it("carries the non-temporal projection through untouched", () => {
    const translated = epicBossRunToClient(run, 2_000, 2_500)!;

    expect(translated).toMatchObject({
      runId: "run-1", bossId: "boss-1", level: 2, maxHp: 100, currentHp: 40,
      tokenCount: 1, attackOrder: ["a", "b"],
    });
    expect(run.expiresAt).toBe(5_000); // the source projection is not mutated
  });

  it("maps an absent run to null", () => {
    expect(epicBossRunToClient(null, 2_000, 2_500)).toBeNull();
    expect(epicBossRunToClient(undefined, 2_000, 2_500)).toBeNull();
  });
});
