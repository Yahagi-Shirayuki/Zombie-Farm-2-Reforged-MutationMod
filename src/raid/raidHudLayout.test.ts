import { describe, expect, it } from "vitest";
import { computeRaidHudLayout } from "./raidHudLayout";

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe("raid HUD layout", () => {
  it("keeps raid chrome outside notches and the home indicator", () => {
    const layout = computeRaidHudLayout(
      844,
      390,
      { top: 0, right: 47, bottom: 21, left: 47 },
      true,
    );

    expect(layout.leftBarX).toBeGreaterThanOrEqual(55);
    expect(layout.rightBarX + layout.barWidth).toBeLessThanOrEqual(844 - 55);
    expect(layout.leftFaceX).toBeGreaterThanOrEqual(47 + 25);
    expect(layout.rightFaceX).toBeLessThanOrEqual(844 - 47 - 25);
    expect(layout.retreatBottomMargin).toBe(39);
  });

  it("places the top row below an iPhone portrait safe area and hides portraits", () => {
    const layout = computeRaidHudLayout(
      430,
      932,
      { top: 59, right: 0, bottom: 34, left: 0 },
      true,
    );

    expect(layout.topY).toBeGreaterThanOrEqual(68);
    expect(layout.topHudHeight).toBeGreaterThan(layout.topY);
    expect(layout.hidePortraits).toBe(true);
    expect(layout.retreatBottomMargin).toBe(52);
  });

  it("retains portraits on desktop and mobile landscape", () => {
    expect(computeRaidHudLayout(1200, 800, noInsets, false).hidePortraits).toBe(false);
    expect(computeRaidHudLayout(844, 390, noInsets, true).hidePortraits).toBe(false);
  });
});
