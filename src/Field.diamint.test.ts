import { Sprite, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  DIAMINT_HARVEST_GRACE_MS,
  DIAMINT_KEY,
  Field,
  INVADING_MINT,
  INVADING_MINT_GROW_MS,
  PLOT,
  type CropConfig,
} from "./Field";
import { DIRT_FILE, PLOWED_FILE } from "./assets";

const diamint: CropConfig = {
  key: DIAMINT_KEY,
  name: "Diamint",
  stages: ["diamint_stage1.png", "diamint_stage2.png"],
  growMs: 1000,
  cost: 0,
  sell: 0,
  xp: 1,
  unlockLevel: 1,
};

function makeField(): Field {
  const field: Field = Object.create(Field.prototype);
  Object.assign(field, {
    assets: { soil: { [PLOWED_FILE]: Texture.EMPTY, [DIRT_FILE]: Texture.EMPTY } },
    w: 16,
    h: 16,
    plots: new Map(),
    tilePlot: new Map<string, string>(),
    objects: new Map(),
    fit: vi.fn((sprite: Sprite, texture: Texture) => { sprite.texture = texture; }),
    layoutCrop: vi.fn((crop: { stageFile?: string }, stageFile: string) => {
      crop.stageFile = stageFile;
      return 0;
    }),
  });
  return field;
}

function addPlot(field: Field, oc: number, or: number, cfg?: CropConfig, harvestLocked = false): void {
  const key = `${oc},${or}`;
  const plot = {
    oc,
    or,
    soil: new Sprite(Texture.EMPTY),
    state: cfg ? "planted" : "dirt",
    harvestLocked,
    ...(cfg ? {
      crop: {
        cfg,
        plantedAt: 0,
        ageMs: cfg.growMs,
        sprite: new Sprite(Texture.EMPTY),
        baseY: 0,
      },
    } : {}),
  };
  (field as any).plots.set(key, plot);
  for (let row = or; row < or + PLOT; row++)
    for (let col = oc; col < oc + PLOT; col++) (field as any).tilePlot.set(`${col},${row}`, key);
}

describe("Diamint invasion clearing", () => {
  it("lets invasive mint be cleared while the original Diamint is still active", () => {
    const field = makeField();
    addPlot(field, 0, 0, diamint);
    addPlot(field, PLOT, 0, INVADING_MINT, true);
    const now = diamint.growMs + DIAMINT_HARVEST_GRACE_MS;

    expect(field.isHarvestable(PLOT, 0)).toBe(true);
    const result = field.harvestAt(PLOT, 0);

    expect(result?.invasiveMint).toBe(true);
    const cleared = (field as any).plots.get(`${PLOT},0`);
    expect(cleared.crop).toBeUndefined();
    expect(cleared.invasiveMintCleared).toBe(true);

    expect((field as any).advanceInvasiveMint(now)).toBe(false);
    expect(cleared.crop).toBeUndefined();
    expect(cleared.invasiveMintCleared).toBe(true);
  });

  it("allows a cleared tile to be invaded again after active Diamint pressure is gone", () => {
    const field = makeField();
    addPlot(field, 0, 0, diamint);
    addPlot(field, PLOT, 0, INVADING_MINT);
    const now = diamint.growMs + DIAMINT_HARVEST_GRACE_MS + INVADING_MINT_GROW_MS;

    expect(field.harvestAt(PLOT, 0)?.invasiveMint).toBe(true);
    const source = (field as any).plots.get("0,0");
    source.crop = undefined;
    source.state = "dirt";

    expect((field as any).advanceInvasiveMint(now)).toBe(true);
    expect((field as any).plots.get(`${PLOT},0`).invasiveMintCleared).toBe(false);
  });
});
