// A texture that will not load is allowed to be non-fatal. It is not allowed to be
// invisible — that is how a three-second stall on a URL that could never exist survived a
// whole beta, unseen from inside the game and absent from every bug report.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetFailureLine, assetFailures, noteAssetFailure, resetAssetFailures } from "./assetFailures";
import { clearCrumbs, readCrumbs } from "./breadcrumbs";

describe("asset failure tally", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    clearCrumbs();
    resetAssetFailures();
  });

  it("says so plainly when nothing failed", () => {
    expect(assetFailureLine()).toBe("none");
    expect(assetFailures().count).toBe(0);
  });

  it("names the first failure, which is the informative one", () => {
    noteAssetFailure("/assets/raids/enemies/EpicBoss:dr-groundhog.png");
    expect(assetFailureLine()).toBe("1 failed (first /assets/raids/enemies/EpicBoss:dr-groundhog.png)");
  });

  it("counts the rest and names the latest", () => {
    noteAssetFailure("/assets/a.png");
    noteAssetFailure("/assets/b.png");
    noteAssetFailure("/assets/c.png");
    expect(assetFailureLine()).toBe("3 failed (first /assets/a.png, latest /assets/c.png)");
  });

  it("cannot flood the activity trail out of the report", () => {
    // A battle entered with no connection fails a texture per asset. Thirty crumbs would
    // push the trail that EXPLAINS them straight out of the ring, so only the first few
    // get a crumb and the tally carries the rest.
    for (let i = 0; i < 30; i++) noteAssetFailure(`/assets/${i}.png`);
    const crumbs = readCrumbs().filter((c) => c.tag === "asset:fail");
    expect(crumbs.length).toBeLessThanOrEqual(3);
    expect(crumbs[0].detail).toBe("/assets/0.png");
    expect(assetFailures().count).toBe(30);
  });
});
