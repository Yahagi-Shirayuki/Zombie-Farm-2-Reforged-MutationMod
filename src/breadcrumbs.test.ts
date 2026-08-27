// The trail exists because the error buffer could only ever see things that THREW, and
// the two most expensive reports of this beta both arrived saying "errors: none recorded"
// while being entirely accurate. What these pin is the part that makes a trail readable:
// it survives the reload the player had to do to escape, it cannot be flooded out by one
// noisy source, and it reports the GAP between steps — which is what names a stall.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCrumbs, crumb, crumbTimeline, flushCrumbs, readCrumbs } from "./breadcrumbs";

function stubStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

describe("activity trail", () => {
  beforeEach(() => {
    stubStorage();
    clearCrumbs();
    vi.useRealTimers();
  });

  it("records a step with its tag and detail", () => {
    crumb("battle:launch", "Dr. Groundhog L1");
    crumb("battle:ready", "Dr. Groundhog");
    expect(readCrumbs().map((c) => [c.tag, c.detail])).toEqual([
      ["battle:launch", "Dr. Groundhog L1"],
      ["battle:ready", "Dr. Groundhog"],
    ]);
  });

  it("keeps only the most recent steps", () => {
    for (let i = 0; i < 60; i++) crumb("step", String(i));
    const trail = readCrumbs();
    expect(trail).toHaveLength(40);
    // The TAIL is what explains a failure, so the oldest are the ones dropped.
    expect(trail[trail.length - 1].detail).toBe("59");
    expect(trail[0].detail).toBe("20");
  });

  it("truncates a detail rather than letting one crowd the ring", () => {
    crumb("noisy", "x".repeat(500));
    expect(readCrumbs()[0].detail).toHaveLength(120);
  });

  it("reports the GAP between steps, which is what names a stall", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T14:37:16.302Z"));
    crumb("battle:launch", "Dr. Groundhog");
    vi.setSystemTime(new Date("2026-08-20T14:37:20.412Z"));
    crumb("battle:ready", "Dr. Groundhog");
    const lines = crumbTimeline();
    expect(lines[0]).toContain("14:37:16.302");
    expect(lines[0]).toContain("battle:launch");
    // The line that would have found the Epic Boss bug on sight.
    expect(lines[1]).toContain("+4110ms");
    expect(lines[1]).toContain("battle:ready");
  });

  it("survives the reload the player had to do to escape", async () => {
    // The failure this was built for hides the whole HUD, so a report cannot be copied
    // until after a reload. An in-memory-only trail would be gone by then — which is why
    // this re-imports the module rather than just reading the key back: a fresh module
    // instance with an empty in-memory ring is exactly what a reload produces.
    const values = stubStorage();
    clearCrumbs();
    crumb("battle:launch", "Dr. Groundhog");
    crumb("battle:failed", "Dr. Groundhog");
    flushCrumbs();

    vi.resetModules();
    stubStorage(Object.fromEntries(values));
    const reloaded = await import("./breadcrumbs");
    expect(reloaded.readCrumbs().map((c) => c.tag))
      .toEqual(["battle:launch", "battle:failed"]);
    // ...and the new session appends to it rather than replacing it.
    reloaded.crumb("boot", "local");
    expect(reloaded.readCrumbs()).toHaveLength(3);
  });

  it("collapses a repeating step instead of filling the ring with it", () => {
    // Retry loops are the normal shape of a failure worth reporting: a rejected command
    // batch resends on a backoff, a broken connection fails a texture per asset. Forty
    // copies of one step would push out the steps that explain it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T14:00:00.000Z"));
    crumb("queue:paused", "state_conflict");
    for (let i = 1; i <= 19; i++) {
      vi.setSystemTime(new Date(`2026-08-20T14:00:${String(i).padStart(2, "0")}.000Z`));
      crumb("queue:retry", "409 state_conflict");
    }
    vi.useRealTimers();

    const trail = readCrumbs();
    expect(trail).toHaveLength(2);
    expect(trail[1].repeat).toBe(19);
    // Both ends of the run are kept — "it has been failing for eighteen seconds" is made
    // of the first time and the last.
    const line = crumbTimeline()[1];
    expect(line).toContain("(x19 over 18s)");
  });

  it("measures the next gap from when the repeating stopped, not when it started", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T14:00:00.000Z"));
    crumb("queue:retry", "409");
    vi.setSystemTime(new Date("2026-08-20T14:00:30.000Z"));
    crumb("queue:retry", "409");
    vi.setSystemTime(new Date("2026-08-20T14:00:31.000Z"));
    crumb("queue:resumed", "after state_conflict");
    vi.useRealTimers();
    // Not +31000ms: the retrying ran until :30, and the resume came a second after it.
    expect(crumbTimeline()[1]).toContain("+1000ms");
  });

  it("does not collapse two different steps that happen to share a tag", () => {
    crumb("queue:paused", "state_conflict");
    crumb("queue:paused", "writer_replaced");
    expect(readCrumbs()).toHaveLength(2);
  });

  it("never throws when storage is denied outright", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("denied", "SecurityError"); },
      setItem: () => { throw new DOMException("denied", "SecurityError"); },
      removeItem: () => { throw new DOMException("denied", "SecurityError"); },
    });
    // A breadcrumb must never be the thing that breaks the step it is describing.
    expect(() => crumb("battle:launch", "Dr. Groundhog")).not.toThrow();
    expect(() => flushCrumbs()).not.toThrow();
    expect(() => crumbTimeline()).not.toThrow();
    expect(() => clearCrumbs()).not.toThrow();
  });
});
