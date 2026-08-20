import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordDiagnostic,
  diagnosticsReport,
  diagnosticsCount,
  clearDiagnostics,
} from "./diagnostics";
import { clearCrumbs, crumb, readCrumbs } from "./breadcrumbs";
import { noteAssetFailure, resetAssetFailures } from "./assetFailures";

const entry = (message: string, at = 1_700_000_000_000) =>
  ({ at, kind: "error" as const, message });

describe("diagnostics buffer", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  beforeEach(() => values.clear());

  it("records and counts entries", () => {
    expect(diagnosticsCount()).toBe(0);
    recordDiagnostic(entry("boom"));
    recordDiagnostic(entry("bang"));
    expect(diagnosticsCount()).toBe(2);
  });

  it("keeps only the newest 20 so it can't crowd out the save", () => {
    for (let i = 0; i < 30; i++) recordDiagnostic(entry(`err-${i}`));
    expect(diagnosticsCount()).toBe(20);
    const report = diagnosticsReport();
    // Oldest dropped, newest retained.
    expect(report).not.toContain("err-0");
    expect(report).toContain("err-29");
  });

  it("truncates oversized stacks", () => {
    recordDiagnostic({ ...entry("huge"), stack: "x".repeat(5000) });
    const report = diagnosticsReport();
    expect(report).toContain("huge");
    expect(report.length).toBeLessThan(3000);
  });

  it("reports build id and extra fields, and says so when empty", () => {
    const report = diagnosticsReport({ mode: "local" });
    expect(report).toContain("build:");
    expect(report).toContain("local");
    expect(report).toContain("none recorded");
  });

  it("survives unparseable stored data", () => {
    localStorage.setItem("zf2r.diagnostics.v1", "{not json");
    expect(diagnosticsCount()).toBe(0);
    recordDiagnostic(entry("after corruption"));
    expect(diagnosticsCount()).toBe(1);
  });

  it("clears the buffer", () => {
    recordDiagnostic(entry("boom"));
    clearDiagnostics();
    expect(diagnosticsCount()).toBe(0);
  });
});

// The reports that cost the most this beta both said "errors: none recorded" and were
// telling the truth — a stall and a silently-refused write, neither of which threw. So the
// report has to carry what the session was DOING and what would not load, not only what
// crashed. These pin both into the format so neither can quietly drop out of it again.
describe("a report says what the session was doing, not only what threw", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
    store.clear();
    clearCrumbs();
    resetAssetFailures();
  });

  it("carries the activity trail, with the gap that names a stall", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T14:37:16.302Z"));
    crumb("battle:launch", "Dr. Groundhog L1");
    vi.setSystemTime(new Date("2026-08-20T14:37:20.412Z"));
    crumb("battle:ready", "Dr. Groundhog");
    vi.useRealTimers();

    const report = diagnosticsReport();
    expect(report).toContain("recent activity (2, newest last):");
    expect(report).toContain("battle:launch");
    expect(report).toContain("+4110ms");
    // ...and still says plainly that nothing crashed, which is now informative rather
    // than the dead end it used to be.
    expect(report).toContain("errors:   none recorded");
  });

  it("carries unloadable textures, and says so when there are none", () => {
    expect(diagnosticsReport()).toContain("assets:   none");
    noteAssetFailure("/assets/raids/enemies/EpicBoss:dr-groundhog.png");
    expect(diagnosticsReport())
      .toContain("assets:   1 failed (first /assets/raids/enemies/EpicBoss:dr-groundhog.png)");
  });

  it("says so when there is no activity either", () => {
    expect(diagnosticsReport()).toContain("activity: none recorded");
  });

  it("clears the trail with the errors, so a report's timeline always explains it", () => {
    crumb("battle:launch", "Dr. Groundhog");
    recordDiagnostic(entry("boom"));
    clearDiagnostics();
    expect(diagnosticsCount()).toBe(0);
    expect(readCrumbs()).toHaveLength(0);
  });
});
