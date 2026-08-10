import { describe, expect, it } from "vitest";
import {
  EXPIRED_INVASION_NOTICE,
  EXPIRED_INVASION_TOAST,
  invasionSettlementNotice,
  isUnsettledInvasion,
  UNSETTLED_INVASION_NOTICE,
  UNSETTLED_INVASION_TOAST,
} from "./settlementNotice";

describe("invasion settlement mismatch", () => {
  it("flags a won fight the server settled as a loss", () => {
    // The reported bug: the session was closed by the client's own abandoned-raid
    // recovery, so the victory screen patched itself to 0 gold / 0 brains / no loot.
    expect(isUnsettledInvasion({ win: true }, { win: false })).toBe(true);
  });

  it("stays quiet when the settlement agrees with the fight", () => {
    expect(isUnsettledInvasion({ win: true }, { win: true })).toBe(false);
    expect(isUnsettledInvasion({ win: false }, { win: false })).toBe(false);
  });

  it("stays quiet on a conceded loss, where the client reported the defeat itself", () => {
    // A client-only hazard killed the run: the player saw the loss, so a zero-reward
    // settlement is not a contradiction and needs no explanation.
    expect(isUnsettledInvasion({ win: false }, { win: false })).toBe(false);
  });

  it("stays quiet when the server sent no outcome at all (older Worker)", () => {
    expect(isUnsettledInvasion({ win: true }, null)).toBe(false);
    expect(isUnsettledInvasion({ win: true }, undefined)).toBe(false);
  });
});

describe("invasionSettlementNotice", () => {
  it("explains an expired session, which carries no outcome to contradict", () => {
    // alt0rion, 2026-08-09: the Robot invasion was won 21 minutes after its session
    // expired. The server's stored body is exactly this shape — `expired` and the
    // zeroed reward rows, with NO `outcome` — so the outcome-contradiction rule was
    // blind to it and the victory screen zeroed itself in silence.
    const notice = invasionSettlementNotice({ win: true }, { expired: true });
    expect(notice).toEqual({ notice: EXPIRED_INVASION_NOTICE, toast: EXPIRED_INVASION_TOAST });
  });

  it("still explains a session closed by something other than the TTL", () => {
    const notice = invasionSettlementNotice({ win: true }, { outcome: { win: false } });
    expect(notice).toEqual({ notice: UNSETTLED_INVASION_NOTICE, toast: UNSETTLED_INVASION_TOAST });
  });

  it("prefers the expiry wording when the server sent both", () => {
    // Defensive: expiry is the more specific, more actionable diagnosis.
    const notice = invasionSettlementNotice({ win: true }, { expired: true, outcome: { win: false } });
    expect(notice?.notice).toBe(EXPIRED_INVASION_NOTICE);
  });

  it("stays quiet on an ordinary settled win", () => {
    expect(invasionSettlementNotice({ win: true }, { outcome: { win: true } })).toBeNull();
  });

  it("stays quiet when an older Worker omits the outcome", () => {
    expect(invasionSettlementNotice({ win: true }, {})).toBeNull();
  });

  it("stays quiet on a defeat, even an expired one", () => {
    // Zero rewards is what a loss pays anyway — there is nothing to explain, and
    // claiming the session ate a reward would be false.
    expect(invasionSettlementNotice({ win: false }, { expired: true })).toBeNull();
    expect(invasionSettlementNotice({ win: false }, { outcome: { win: false } })).toBeNull();
  });
});
