import { describe, expect, it } from "vitest";
import { isUnsettledInvasion } from "./settlementNotice";

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
