import { describe, expect, it, vi } from "vitest";
import { Field, PLOT } from "./Field";

// Same trick as Field.rehome.test.ts: the tile bookkeeping is what matters here, so
// build a Field without its Pixi constructor and stub the two drawing calls a move
// makes (re-fitting the soil sprite and re-laying-out any crop).
const makeField = (w = 16, h = 16) => {
  const field: Field = Object.create(Field.prototype);
  Object.assign(field, {
    w, h,
    plots: new Map(),
    tilePlot: new Map<string, string>(),
    reserved: new Set<string>(),
    tileObject: new Map<string, string>(),
    fit: vi.fn(),
    layoutCrop: vi.fn().mockReturnValue(0),
  });
  return field;
};

/** Register a plot the way tillAt would, minus the sprite work. */
const addPlot = (
  field: Field, oc: number, or: number, crop?: unknown, state = "plowed"
) => {
  const key = `${oc},${or}`;
  const plot = { oc, or, soil: { texture: "soil" }, state, crop };
  (field as any).plots.set(key, plot);
  for (let r = or; r < or + PLOT; r++)
    for (let c = oc; c < oc + PLOT; c++) (field as any).tilePlot.set(`${c},${r}`, key);
  return plot;
};

const tilesOf = (field: Field) => [...(field as any).tilePlot.keys()].sort();

describe("Field.movePlot", () => {
  it("re-keys the plot and hands its tiles over", () => {
    const field = makeField();
    addPlot(field, 0, 0);

    expect(field.movePlot(0, 0, 8, 8)).toBe(true);

    expect((field as any).plots.has("0,0")).toBe(false);
    expect((field as any).plots.get("8,8")).toMatchObject({ oc: 8, or: 8 });
    expect(field.plotOriginAt(0, 0)).toBeNull();
    expect(field.plotOriginAt(8, 8)).toEqual({ oc: 8, or: 8 });
    expect(tilesOf(field)).toHaveLength(PLOT * PLOT); // no tiles left behind
  });

  it("refuses to move a plot with anything growing on it", () => {
    // Only bare tilled ground moves: a crop's payout and its mutation adjacency are
    // decided where it sits, so a planted plot must stay put.
    const field = makeField();
    const crop = { cfg: { stages: ["seed.png"] }, stageFile: "stage2.png", plantedAt: 1234 };
    addPlot(field, 0, 0, crop, "planted");

    expect(field.canMovePlot(0, 0)).toBe(false);
    expect(field.canMovePlotTo(0, 0, 8, 8)).toBe(false);
    expect(field.movePlot(0, 0, 8, 8)).toBe(false);
    expect(field.plotOriginAt(0, 0)).toEqual({ oc: 0, or: 0 }); // unmoved
    expect((field as any).layoutCrop).not.toHaveBeenCalled();
  });

  it("refuses even a no-op move of a planted plot", () => {
    // The same-origin shortcut must not report success for a plot that cannot move.
    const field = makeField();
    addPlot(field, 0, 0, { cfg: { stages: [] } }, "planted");
    expect(field.movePlot(0, 0, 0, 0)).toBe(false);
  });

  it("refuses spent dirt and holes, which are not tilled ground", () => {
    const field = makeField();
    addPlot(field, 0, 0, undefined, "dirt");
    addPlot(field, 8, 0, undefined, "hole");
    expect(field.canMovePlot(0, 0)).toBe(false);
    expect(field.canMovePlot(8, 0)).toBe(false);
  });

  it("moves a bare tilled plot", () => {
    const field = makeField();
    addPlot(field, 0, 0);
    expect(field.canMovePlot(0, 0)).toBe(true);
    expect(field.movePlot(0, 0, 4, 0)).toBe(true);
    expect(field.plotOriginAt(4, 0)).toEqual({ oc: 4, or: 0 });
  });

  it("allows a one-tile nudge that overlaps the plot's own footprint", () => {
    const field = makeField();
    addPlot(field, 4, 4);
    expect(field.canMovePlotTo(4, 4, 5, 4)).toBe(true);
    expect(field.movePlot(4, 4, 5, 4)).toBe(true);
    expect(field.plotOriginAt(5, 4)).toEqual({ oc: 5, or: 4 });
    expect(tilesOf(field)).toHaveLength(PLOT * PLOT);
  });

  it("refuses a destination that overlaps another plot", () => {
    const field = makeField();
    addPlot(field, 0, 0);
    addPlot(field, 4, 0);
    expect(field.canMovePlotTo(0, 0, 2, 0)).toBe(false);
    expect(field.movePlot(0, 0, 2, 0)).toBe(false);
    expect(field.plotOriginAt(0, 0)).toEqual({ oc: 0, or: 0 }); // unmoved
  });

  it("refuses a destination that overhangs the farm or holds an object", () => {
    const field = makeField(8, 8);
    addPlot(field, 0, 0);
    expect(field.canMovePlotTo(0, 0, 6, 0)).toBe(false); // needs column 9 of 8
    (field as any).tileObject.set("5,5", "gnome");
    expect(field.canMovePlotTo(0, 0, 4, 4)).toBe(false);
  });

  it("is a no-op onto its own origin, and fails from an empty tile", () => {
    const field = makeField();
    addPlot(field, 0, 0);
    expect(field.movePlot(0, 0, 0, 0)).toBe(true);
    expect(field.plotOriginAt(0, 0)).toEqual({ oc: 0, or: 0 });
    expect(field.movePlot(8, 8, 12, 12)).toBe(false);
  });
});
