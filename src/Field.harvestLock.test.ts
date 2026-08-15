import { Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { DIRT_FILE, HOLE_FILE, PLOWED_FILE } from "./assets";
import { Field, PLOT, type CropConfig } from "./Field";
import type { PlotSave } from "./save/schema";

const makeField = () => {
  const field: Field = Object.create(Field.prototype);
  Object.assign(field, {
    plots: new Map(),
    tilePlot: new Map<string, string>(),
  });
  (field as any).syncFence = () => {};
  return field;
};

const addRipePlot = (field: Field, oc = 0, or = 0) => {
  const key = `${oc},${or}`;
  const plot = {
    oc, or,
    soil: {},
    state: "planted",
    crop: {
      cfg: { key: "spinalch", growMs: 1000 },
      ageMs: 1000,
    },
  };
  (field as any).plots.set(key, plot);
  for (let r = or; r < or + PLOT; r++)
    for (let c = oc; c < oc + PLOT; c++) (field as any).tilePlot.set(`${c},${r}`, key);
  return plot;
};

const makeRestorableField = () => {
  const field: Field = Object.create(Field.prototype);
  Object.assign(field, {
    assets: {
      soil: {
        [PLOWED_FILE]: Texture.EMPTY,
        [DIRT_FILE]: Texture.EMPTY,
        [HOLE_FILE]: Texture.EMPTY,
      },
    },
    w: 32,
    h: 32,
    plots: new Map(),
    tilePlot: new Map<string, string>(),
    reserved: new Set<string>(),
    tileObject: new Map<string, string>(),
    plotLayer: new Container(),
    fenceLayer: new Container(),
      cropSeedLayer: new Container(),
      cropGroundLayer: new Container(),
      cropEntityLayer: new Container(),
      entityLayer: new Container(),
    groundObjectLayer: new Container(),
    objects: new Map(),
    fx: { update: vi.fn(), burst: vi.fn() },
    fenceBackTex: Texture.EMPTY,
    fenceFrontTex: Texture.EMPTY,
    fit: vi.fn((sprite: { texture: Texture }, texture: Texture) => { sprite.texture = texture; }),
    layoutCrop: vi.fn((crop: { stageFile?: string }, stageFile: string) => {
      crop.stageFile = stageFile;
      return 0;
    }),
  });
  return field;
};

describe("Field harvest locks", () => {
  it("keeps a ripe plot visible but unavailable to harvest actions", () => {
    const field = makeField();
    addRipePlot(field);

    expect(field.isRipe(0, 0)).toBe(true);
    expect(field.isHarvestable(0, 0)).toBe(true);

    expect(field.toggleHarvestLockedAt(0, 0, true)).toBe(true);

    expect(field.isRipe(0, 0)).toBe(true);
    expect(field.isHarvestLocked(0, 0)).toBe(true);
    expect(field.isHarvestable(0, 0)).toBe(false);
    expect(field.ripePlots()).toEqual([]);
    expect(field.harvestAt(0, 0)).toBeNull();
  });

  it("restores locked plots across empty, spent, crop, and zombie states", () => {
    const now = 100_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const field = makeRestorableField();
    const crop: CropConfig = {
      key: "test_crop",
      name: "Test Crop",
      stages: ["seed.png", "crop_stage1.png", "crop_stage2.png"],
      growMs: 90_000,
      cost: 1,
      sell: 1,
      xp: 1,
      unlockLevel: 1,
    };
    const zombie: CropConfig = {
      ...crop,
      key: "test_zombie",
      name: "Test Zombie",
      stages: ["grave.png", "zombie_stage1.png", "zombie_stage2.png"],
      isZombie: true,
    };
    const planted = (
      oc: number, or: number, key: string, plantedAt: number, isZombie = false
    ): PlotSave => ({
      oc, or,
      state: "planted",
      harvestLocked: true,
      crop: { key, isZombie, plantedAt, growMs: 90_000 },
    });
    const plots: PlotSave[] = [
      { oc: 0, or: 0, state: "plowed", harvestLocked: true },
      { oc: 4, or: 0, state: "dirt", harvestLocked: true },
      { oc: 8, or: 0, state: "hole", harvestLocked: true },
      planted(12, 0, "test_crop", now),
      planted(0, 4, "test_crop", now - 45_000),
      planted(4, 4, "test_crop", now - 90_000),
      planted(8, 4, "test_zombie", now, true),
    ];

    field.restore(plots, (key) => key === "test_zombie" ? zombie : key === "test_crop" ? crop : undefined);

    for (const plot of plots) {
      expect(field.plotOriginAt(plot.oc, plot.or)).toEqual({ oc: plot.oc, or: plot.or });
      expect(field.isHarvestLocked(plot.oc, plot.or)).toBe(true);
      expect((field as any).plots.get(`${plot.oc},${plot.or}`).fenceBack).toBeTruthy();
      expect((field as any).plots.get(`${plot.oc},${plot.or}`).fenceFront).toBeTruthy();
    }
    expect(field.canPlant(0, 0)).toBe(true);
    expect(field.isHarvestable(4, 4)).toBe(false);
    expect(field.ripeZombieAt(8, 4)).toBe(false);
  });
});
