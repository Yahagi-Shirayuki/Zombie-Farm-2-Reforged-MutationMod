import { describe, it, expect } from "vitest";
import { FARM_BG_DENSITY, type FarmBackground } from "./prefs";
import { pickPiece, surroundingsTheme, themeObjectFiles } from "./surroundings";

const TERRAINS = ["grass", "dirt", "snow", "stone", "sand", "water"];

// Everything a theme may name, enumerated off the real asset tree at build time.
// A theme entry with a typo'd filename would otherwise fail only in the browser,
// as a piece that silently never draws.
const basenames = (glob: Record<string, unknown>) =>
  new Set(Object.keys(glob).map((p) => p.slice(p.lastIndexOf("/") + 1)));
const SHIPPED_OBJECTS = basenames(import.meta.glob("../public/assets/objects/*.png"));
const SHIPPED_SCENERY = basenames(import.meta.glob("../public/assets/scenery/*.png"));
const SHIPPED_BACKDROPS = basenames(import.meta.glob("../public/assets/farm_background*.png"));

describe("surroundingsTheme", () => {
  it("dresses every ground_index terrain the Market sells", () => {
    for (const t of TERRAINS) expect(surroundingsTheme(t).key).toBe(t);
  });

  it("falls back to the temperate theme for an unknown skin", () => {
    expect(surroundingsTheme("lava").key).toBe("grass");
    expect(surroundingsTheme("").key).toBe("grass");
  });

  it("gives every theme something to scatter in both bands", () => {
    for (const t of TERRAINS) {
      const theme = surroundingsTheme(t);
      expect(theme.trees.length, `${t} trees`).toBeGreaterThan(0);
      expect(theme.props.length, `${t} props`).toBeGreaterThan(0);
    }
  });

  it("names art that actually ships", () => {
    // Guard the guard: an empty glob would make every assertion below vacuous.
    expect(SHIPPED_OBJECTS.size).toBeGreaterThan(100);
    expect(SHIPPED_SCENERY.size).toBe(4);
    expect(SHIPPED_BACKDROPS.size).toBe(TERRAINS.length);
    for (const t of TERRAINS) {
      const theme = surroundingsTheme(t);
      for (const p of [...theme.trees, ...theme.props]) {
        const shipped = p.scenery ? SHIPPED_SCENERY : SHIPPED_OBJECTS;
        expect(shipped.has(p.file), `${t}: ${p.file}`).toBe(true);
      }
      expect(SHIPPED_BACKDROPS.has(theme.background), theme.background).toBe(true);
    }
  });

  it("keeps the built environments far sparser than the natural ones", () => {
    // Urban and Lunar are man-made: at forest density their pieces read as an
    // installation. Their LUSHEST setting must land near the natural themes'
    // sparsest, so assert against the real FARM_BG_DENSITY numbers rather than a
    // bare constant — a change to either side should fail here.
    const at = (t: string, bg: FarmBackground) =>
      (surroundingsTheme(t).density ?? 1) * FARM_BG_DENSITY[bg];
    for (const built of ["stone", "water"]) {
      for (const natural of ["grass", "dirt", "snow", "sand"]) {
        expect(at(built, "deep-forest"), `${built} vs ${natural}`)
          .toBeLessThan(at(natural, "woodland"));
        expect(at(built, "deep-forest")).toBeCloseTo(at(natural, "light-meadow"), 1);
      }
    }
  });

  it("weights the far band toward trees only where the big pieces ARE trees", () => {
    for (const natural of ["grass", "dirt", "snow", "sand"]) {
      expect(surroundingsTheme(natural).treeShare ?? 0.5, natural).toBeGreaterThan(0.5);
    }
    // Built environments: their far-band pieces are street lights and rocket
    // wrecks, which read as an installation in any quantity.
    for (const built of ["stone", "water"]) {
      expect(surroundingsTheme(built).treeShare ?? 0.5, built).toBeLessThanOrEqual(0.5);
    }
  });

  it("makes craters the substance of the lunar surface", () => {
    const { props, treeShare = 0.5 } = surroundingsTheme("water");
    const craters = props.filter((p) => p.file === "spaceCrater.png");
    expect(craters.length / props.length).toBeGreaterThan(0.6);
    // Craters are props, so the far band must also favour props over hardware —
    // a high crater share inside a list the scatter rarely reaches does nothing.
    expect(treeShare).toBeLessThan(0.3);
    // Two distinct sizes, or a crater field is one stamp repeated.
    expect(new Set(craters.map((p) => p.scale)).size).toBeGreaterThan(1);
  });

  it("keeps both scatter knobs in range", () => {
    for (const t of TERRAINS) {
      const { density = 1, treeShare = 0.5 } = surroundingsTheme(t);
      expect(density).toBeGreaterThan(0);
      expect(density).toBeLessThanOrEqual(1);
      expect(treeShare).toBeGreaterThan(0);
      expect(treeShare).toBeLessThanOrEqual(1);
    }
  });

  it("lists each object file once for preloading, and no scenery art", () => {
    const files = themeObjectFiles(surroundingsTheme("dirt"));
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain("palmTree.png");
    expect(files).not.toContain("tree.png");
    expect(themeObjectFiles(surroundingsTheme("grass"))).toEqual([]);
  });
});

describe("pickPiece", () => {
  // The scatter walks its lattice in steps of two, so pickPiece only ever sees
  // EVEN coordinates. An un-avalanched hash of two even numbers stays even and
  // can reach only the even slots of an even-length list — which silently halved
  // every theme's variety. Assert over the coordinates the caller actually uses.
  it("reaches every slot of an even-length list on the even lattice", () => {
    for (const len of [2, 8, 10, 24]) {
      const list = Array.from({ length: len }, (_, i) => ({ file: `${i}.png` }));
      const hits = new Set<string>();
      for (let v = -60; v <= 60; v += 2) {
        for (let u = -120; u <= 120; u += 2) hits.add(pickPiece(list, u, v).file);
      }
      expect(hits.size, `list of ${len}`).toBe(len);
    }
  });

  it("spreads roughly evenly — no slot under half its share", () => {
    const len = 10;
    const list = Array.from({ length: len }, (_, i) => ({ file: `${i}.png` }));
    const counts = new Array(len).fill(0);
    let total = 0;
    for (let v = -60; v <= 60; v += 2) {
      for (let u = -120; u <= 120; u += 2) {
        counts[Number(pickPiece(list, u, v).file.split(".")[0])]++;
        total++;
      }
    }
    const fair = total / len;
    expect(Math.min(...counts)).toBeGreaterThan(fair * 0.5);
    expect(Math.max(...counts)).toBeLessThan(fair * 1.5);
  });

  it("is stable: the same point always yields the same piece", () => {
    const list = [{ file: "a.png" }, { file: "b.png" }, { file: "c.png" }];
    expect(pickPiece(list, 12, -8)).toBe(pickPiece(list, 12, -8));
  });
});
