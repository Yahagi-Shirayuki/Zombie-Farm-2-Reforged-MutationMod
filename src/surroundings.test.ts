import { describe, it, expect } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test
// environment provides this at runtime. Same treatment as skyExtension.test.ts.
// @ts-ignore
import { readFileSync } from "node:fs";
import groundIndex from "../public/assets/ground_index.json";
import upgrades from "../public/assets/upgrades.json";
import { FARM_BG_DENSITY, type FarmBackground } from "./prefs";
import { pickPiece, surroundingsTheme, themeObjectFiles, themePieces } from "./surroundings";
import placeables from "../public/assets/placeables.json";

// Taken from the generated catalog rather than hand-listed, so adding a ground
// skin extends every test below instead of needing this line kept up to date.
const TERRAINS = upgrades.climate.map((c) => c.terrain);
// The man-made skins, which are deliberately sparse and NOT tree-weighted.
const BUILT = ["stone", "water"];
const NATURAL = TERRAINS.filter((t) => !BUILT.includes(t));

// Everything a theme may name, enumerated off the real asset tree at build time.
// A theme entry with a typo'd filename would otherwise fail only in the browser,
// as a piece that silently never draws.
const basenames = (glob: Record<string, unknown>) =>
  new Set(Object.keys(glob).map((p) => p.slice(p.lastIndexOf("/") + 1)));
const SHIPPED_OBJECTS = basenames(import.meta.glob("../public/assets/objects/*.png"));
const SHIPPED_SCENERY = basenames(import.meta.glob("../public/assets/scenery/*.png"));
const SHIPPED_BACKDROPS = basenames(import.meta.glob("../public/assets/farm_background*.png"));
const SHIPPED_GROUND = basenames(import.meta.glob("../public/assets/ground/*.png"));

describe("surroundingsTheme", () => {
  it("dresses every terrain the Market sells", () => {
    expect(TERRAINS.length).toBeGreaterThanOrEqual(6); // guard against an empty catalog
    for (const t of TERRAINS) expect(surroundingsTheme(t).key).toBe(t);
  });

  // A skin is three separate assets that must agree: a Market entry, a row of
  // ground tiles, and a surroundings theme. Miss the tiles and Field.setClimate
  // silently no-ops — the player buys a skin and the farm never changes.
  it("every skin on sale has ground tiles to paint the farm with", () => {
    const rows = groundIndex as Record<string, string[]>;
    for (const t of TERRAINS) {
      expect(rows[t], `${t} missing from ground_index.json`).toBeDefined();
      expect(rows[t].length, `${t} has no tile variants`).toBeGreaterThan(0);
    }
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
    // One backdrop per terrain, plus one more for each time-of-day variant. Counted
    // rather than hard-coded so a stray or orphaned backdrop still fails here.
    const variants = TERRAINS.filter((t) => surroundingsTheme(t).dusk).length;
    expect(SHIPPED_BACKDROPS.size).toBe(TERRAINS.length + variants);
    for (const t of TERRAINS) {
      const theme = surroundingsTheme(t);
      for (const p of themePieces(theme)) {
        const shipped = p.scenery ? SHIPPED_SCENERY : SHIPPED_OBJECTS;
        expect(shipped.has(p.file), `${t}: ${p.file}`).toBe(true);
      }
      expect(SHIPPED_BACKDROPS.has(theme.background), theme.background).toBe(true);
      if (theme.dusk) {
        expect(SHIPPED_BACKDROPS.has(theme.dusk.background), theme.dusk.background).toBe(true);
      }
      // A groundFill that does not resolve is worse than none: the land around the
      // farm stays flat filler and the only clue is a console warning.
      if (theme.groundFill) {
        expect(theme.groundFill.startsWith("ground/"), theme.groundFill).toBe(true);
        expect(SHIPPED_GROUND.has(theme.groundFill.slice("ground/".length)),
          theme.groundFill).toBe(true);
      }
    }
  });

  // The road is laid end to end down one grid row, so its piece has to be the shape
  // that tiles that way: a 2x2 flat tile. Anything else leaves gaps or steps, and
  // the road is named by catalog KEY, which no filename check would catch.
  it("lays roads with a piece that can actually tile", () => {
    const byKey = new Map((placeables as { key: string }[]).map((p) => [p.key, p]));
    for (const t of TERRAINS) {
      const road = surroundingsTheme(t).road;
      if (!road) continue;
      const def = byKey.get(road.key) as
        { tileW: number; tileH: number; flatTile?: boolean; sprite: string } | undefined;
      expect(def, `${t}: no catalog entry for road ${road.key}`).toBeDefined();
      expect([def!.tileW, def!.tileH], `${t}: ${road.key} footprint`).toEqual([2, 2]);
      expect(def!.flatTile, `${t}: ${road.key} is not flat`).toBe(true);
      expect(SHIPPED_OBJECTS.has(def!.sprite), def!.sprite).toBe(true);
      // A stride under a tile would stack every lamp on one spot.
      expect(road.lampSpacing).toBeGreaterThanOrEqual(1);
      expect(road.litterClumps).toBeGreaterThan(0);
      expect(road.litterPerClump).toBeGreaterThan(0);
      // The crossing replaces a straight in the run, so it has to be the same shape.
      const crossing = byKey.get(road.crossingKey) as
        { tileW: number; tileH: number; flatTile?: boolean; sprite: string } | undefined;
      expect(crossing, `${t}: no catalog entry for ${road.crossingKey}`).toBeDefined();
      expect([crossing!.tileW, crossing!.tileH], road.crossingKey).toEqual([2, 2]);
      expect(SHIPPED_OBJECTS.has(crossing!.sprite), crossing!.sprite).toBe(true);
      // The street must clear the scatter's own margin, or it runs into the fence.
      expect(road.offset).toBeGreaterThan(3);
    }
  });

  // The fill is tiled edge to edge, so a non-repeating one shows a hard seam every
  // 240px. Only its dimensions are checkable here, and they are the thing that goes
  // wrong: the emitted rect must stay a period of the 48x24 iso lattice.
  it("tiles the surrounding ground on a lattice period", () => {
    for (const t of TERRAINS) {
      const fill = surroundingsTheme(t).groundFill;
      if (!fill) continue;
      const bytes = readFileSync(new URL(`../public/assets/${fill}`, import.meta.url));
      const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
      expect(w % 48, `${fill} width`).toBe(0);
      expect(h % 24, `${fill} height`).toBe(0);
    }
  });

  it("keeps the built environments far sparser than the natural ones", () => {
    // Urban and Lunar are man-made: at forest density their pieces read as an
    // installation. Their LUSHEST setting must land near the natural themes'
    // sparsest, so assert against the real FARM_BG_DENSITY numbers rather than a
    // bare constant — a change to either side should fail here.
    const at = (t: string, bg: FarmBackground) =>
      (surroundingsTheme(t).density ?? 1) * FARM_BG_DENSITY[bg];
    for (const built of BUILT) {
      for (const natural of NATURAL) {
        expect(at(built, "deep-forest"), `${built} vs ${natural}`)
          .toBeLessThan(at(natural, "woodland"));
        expect(at(built, "deep-forest")).toBeCloseTo(at(natural, "light-meadow"), 1);
      }
    }
  });

  it("weights the far band toward trees only where the big pieces ARE trees", () => {
    for (const natural of NATURAL) {
      expect(surroundingsTheme(natural).treeShare ?? 0.5, natural).toBeGreaterThan(0.5);
    }
    // Built environments: their far-band pieces are street lights and rocket
    // wrecks, which read as an installation in any quantity.
    for (const built of BUILT) {
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
