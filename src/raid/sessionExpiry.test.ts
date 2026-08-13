import { describe, expect, it } from "vitest";
import {
  EXPIRED_MID_FIGHT_MESSAGE,
  EXPIRY_WARNING_LEAD_MS,
  invasionExpiryMessage,
  invasionExpiryState,
} from "./sessionExpiry";

const TTL = 15 * 60 * 1000;
const START = 1_786_264_209_045; // alt0rion's Robot invasion
const EXPIRES = START + TTL;

describe("invasionExpiryState", () => {
  it("is quiet for the bulk of a session", () => {
    expect(invasionExpiryState(EXPIRES, START)).toBe("ok");
    expect(invasionExpiryState(EXPIRES, START + 11 * 60_000)).toBe("ok");
  });

  it("warns once inside the lead time", () => {
    expect(invasionExpiryState(EXPIRES, EXPIRES - EXPIRY_WARNING_LEAD_MS)).toBe("expiring");
    expect(invasionExpiryState(EXPIRES, EXPIRES - 1)).toBe("expiring");
  });

  it("reports expiry from the deadline onward", () => {
    expect(invasionExpiryState(EXPIRES, EXPIRES)).toBe("expired");
    // alt0rion returned to a frozen fight 21 minutes past the deadline and won it.
    expect(invasionExpiryState(EXPIRES, START + 36 * 60_000)).toBe("expired");
  });

  it("stays quiet with no deadline to enforce (offline, or an older Worker)", () => {
    expect(invasionExpiryState(null, START)).toBe("ok");
    // A settlement that left lastRaidAt undefined once produced NaN here; never warn
    // off a number that cannot be compared.
    expect(invasionExpiryState(NaN, START)).toBe("ok");
  });
});

describe("invasionExpiryMessage", () => {
  it("says nothing while the session is healthy", () => {
    expect(invasionExpiryMessage("ok", TTL)).toBeNull();
  });

  it("rounds the warning up to whole minutes, and never to zero", () => {
    expect(invasionExpiryMessage("expiring", 3 * 60_000)).toContain("about 3 minutes");
    expect(invasionExpiryMessage("expiring", 61_000)).toContain("about 2 minutes");
    expect(invasionExpiryMessage("expiring", 1_000)).toContain("about 1 minute,");
  });

  it("explains an expiry the player is already past", () => {
    expect(invasionExpiryMessage("expired", 0)).toBe(EXPIRED_MID_FIGHT_MESSAGE);
  });
});

describe("the contract main.ts's ticker check implements", () => {
  // The glue is six lines ? announce only when the state CHANGES ? but it runs on
  // every frame of a live fight, so the thing worth pinning down is that it speaks
  // exactly twice across a whole session and never repeats itself at 60 fps.
  const announcementsOver = (times: number[]): string[] => {
    const said: string[] = [];
    let announced = invasionExpiryState(EXPIRES, START);
    for (const now of times) {
      const state = invasionExpiryState(EXPIRES, now);
      if (state === announced) continue;
      announced = state;
      const message = invasionExpiryMessage(state, EXPIRES - now);
      if (message) said.push(message);
    }
    return said;
  };

  it("speaks once per transition, not once per frame", () => {
    // 60 fps for the whole 15 minutes would be 54,000 checks; sample the shape.
    const frames: number[] = [];
    for (let t = START; t <= START + 20 * 60_000; t += 250) frames.push(t);
    const said = announcementsOver(frames);
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("Finish this invasion soon");
    expect(said[1]).toBe(EXPIRED_MID_FIGHT_MESSAGE);
  });

  it("still reports expiry to a player who was away for the whole window", () => {
    // alt0rion's case: the tab was hidden, so NO frame ran between the launch and
    // the return. The warning is skipped (nothing could have shown it) but the
    // expiry itself must still land on the first frame back.
    expect(announcementsOver([START + 36 * 60_000])).toEqual([EXPIRED_MID_FIGHT_MESSAGE]);
  });

  it("says nothing at all when the fight finishes comfortably in time", () => {
    const frames: number[] = [];
    for (let t = START; t <= START + 90_000; t += 250) frames.push(t);
    expect(announcementsOver(frames)).toEqual([]);
  });
});
