import { describe, it, expect } from "vitest";
import { DAY_MS, dayEndsAt, dayIndex, weekEndsAt, weekIndex } from "./periods";

const utc = (iso: string) => Date.parse(iso);

describe("periodic quest clocks", () => {
  it("indexes UTC days, changing exactly at midnight", () => {
    expect(dayIndex(utc("2026-08-08T23:59:59.999Z")))
      .toBe(dayIndex(utc("2026-08-08T00:00:00.000Z")));
    expect(dayIndex(utc("2026-08-09T00:00:00.000Z")))
      .toBe(dayIndex(utc("2026-08-08T00:00:00.000Z")) + 1);
  });

  it("ends the day at the next UTC midnight", () => {
    expect(dayEndsAt(utc("2026-08-08T13:20:00.000Z"))).toBe(utc("2026-08-09T00:00:00.000Z"));
  });

  // Epoch day 0 was a Thursday, so the +3 shift in weekIndex is the whole trick —
  // get it wrong and the "week" silently resets on a Thursday.
  it("starts the week on Monday, not on the epoch's Thursday", () => {
    const sunday = utc("2026-08-09T23:00:00.000Z"); // Sunday
    const monday = utc("2026-08-10T01:00:00.000Z"); // Monday
    const laterMonday = utc("2026-08-10T23:00:00.000Z");
    expect(new Date(sunday).getUTCDay()).toBe(0);
    expect(new Date(monday).getUTCDay()).toBe(1);
    expect(weekIndex(monday)).toBe(weekIndex(sunday) + 1);
    expect(weekIndex(laterMonday)).toBe(weekIndex(monday));
  });

  it("ends the week at the next Monday midnight UTC", () => {
    const end = weekEndsAt(utc("2026-08-05T12:00:00.000Z")); // a Wednesday
    expect(end).toBe(utc("2026-08-10T00:00:00.000Z"));
    expect(new Date(end).getUTCDay()).toBe(1);
  });

  it("holds one week index for exactly seven days", () => {
    const monday = utc("2026-08-10T00:00:00.000Z");
    for (let day = 0; day < 7; day++) {
      expect(weekIndex(monday + day * DAY_MS)).toBe(weekIndex(monday));
    }
    expect(weekIndex(monday + 7 * DAY_MS)).toBe(weekIndex(monday) + 1);
  });
});
