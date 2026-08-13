// The dusk window has to straddle the moment the lights go down.
//
// The sunset backdrop and the night overlay are decided by two separate functions, and
// the only thing that makes them agree is that both are derived from NIGHT_START_HOUR.
// Write either window out as literal hours and they drift apart the first time the
// night boundary is retuned — leaving a sunset sky over a farm in broad daylight, or a
// blue afternoon horizon behind a farm that has already gone dark.
import { describe, expect, it } from "vitest";
import { DUSK_HOURS, isLocalDusk, isLocalNight, NIGHT_START_HOUR } from "./prefs";

/** A local-clock date at a given whole hour. */
const at = (hour: number) => new Date(2026, 7, 12, hour, 30, 0);

describe("dusk window", () => {
  it("opens before nightfall and closes after it", () => {
    expect(isLocalDusk(at(NIGHT_START_HOUR - DUSK_HOURS))).toBe(true);
    expect(isLocalDusk(at(NIGHT_START_HOUR - DUSK_HOURS - 1))).toBe(false);
    expect(isLocalDusk(at(NIGHT_START_HOUR + DUSK_HOURS - 1))).toBe(true);
    expect(isLocalDusk(at(NIGHT_START_HOUR + DUSK_HOURS))).toBe(false);
  });

  it("straddles nightfall — the whole point of it", () => {
    expect(isLocalDusk(at(NIGHT_START_HOUR - 1))).toBe(true);
    expect(isLocalNight(at(NIGHT_START_HOUR - 1))).toBe(false);
    expect(isLocalDusk(at(NIGHT_START_HOUR))).toBe(true);
    expect(isLocalNight(at(NIGHT_START_HOUR))).toBe(true);
  });

  it("leaves the middle of the day and the small hours alone", () => {
    for (const hour of [0, 3, 9, 12, 15, 23]) {
      expect(isLocalDusk(at(hour)), `${hour}:30`).toBe(false);
    }
  });
});
