import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import plants from "../public/assets/plants.json";
import { SEED_FILE } from "./assets";
import { CARROT, CropConfig, Field } from "./Field";

// The Water Lily's MIDDLE stage is a POND: one flat isometric diamond filling the plot,
// nothing standing above the water. The ordinary crop render graduates a growing crop
// into the depth-sorted entityLayer so a tall plant can hide an actor walking behind it
// — which for a piece of ground means the farmer and any zombie crossing the plot
// disappear underneath it. FLAT_GROWTH_CROPS keeps that stage in cropSeedLayer (below
// every entity, no footprint) so characters always walk over it.
//
// The exception is that one stage only. The ripe art grows a tall flower well clear of
// the water, so it rejoins the ordinary split render and sorts like any other crop.

/** A stand-in for the Sprite layoutCrop positions. Real Sprites need a GPU texture; the
 *  only Sprite API layoutCrop touches is anchor/scale/position/texture, and everything
 *  under test is WHICH LAYER the node ends up parented to. */
const makeSprite = () => {
  const node = new Container() as Container & { anchor: { set(x: number, y?: number): void }; texture: unknown };
  node.anchor = { set: () => {} };
  return node;
};

const TEX = { width: 188, height: 128 } as unknown as never; // PLOT * TILE_W wide-ish

interface CropLayout {
  cropSeedLayer: Container;
  cropGroundLayer: Container;
  entityLayer: Container;
  layoutCrop(c: { cfg: CropConfig; sprite: unknown; groundSprite?: unknown },
    stageFile: string, oc: number, or: number): number;
}

const makeField = (): CropLayout => {
  const field: Field = Object.create(Field.prototype);
  // The layers are class FIELDS, so Object.create skips them (the other Field tests
  // skip the Pixi constructor the same way — see Field.flatTile.test.ts).
  Object.assign(field, {
    cropSeedLayer: new Container(),
    cropGroundLayer: new Container(),
    entityLayer: new Container(),
    assets: {
      field: { tileW: 48 },
      crop: new Proxy({}, { get: () => TEX }),
      cropTop: new Proxy({}, { get: () => TEX }),
      soil: new Proxy({}, { get: () => TEX }),
    },
  });
  return field as unknown as CropLayout;
};

/** Plant `cfg` at its final growth stage and report which layer its sprite landed in. */
const layerOfGrown = (cfg: CropConfig): "seed" | "entity" | "other" => {
  const field = makeField();
  const sprite = makeSprite();
  const crop = { cfg, sprite };
  // Walk the whole ladder: a stage change re-parents, so the last one has to stick.
  for (const stage of cfg.stages) field.layoutCrop(crop, stage, 4, 4);
  if (sprite.parent === field.cropSeedLayer) return "seed";
  if (sprite.parent === field.entityLayer) return "entity";
  return "other";
};

const cfgFor = (key: string): CropConfig => {
  const p = (plants as { key: string; name: string; stage1: string; stage2: string;
    growMs: number; cost: number; sell: number; xp: number; level: number }[])
    .find((row) => row.key === key);
  if (!p) throw new Error(`no plant ${key}`);
  return {
    key: p.key, name: p.name, stages: [SEED_FILE, p.stage1, p.stage2],
    growMs: p.growMs, cost: p.cost, sell: p.sell, xp: p.xp, unlockLevel: p.level,
  };
};

describe("flat crops", () => {
  it("graduates a RIPE Water Lily into the depth sort like any other crop", () => {
    // Its flower stands well above the water, so the ripe stage is not ground and must
    // not be pinned below the actors.
    expect(layerOfGrown(cfgFor("water_lily"))).toBe("entity");
  });

  it("still graduates an ordinary crop into the depth-sorted entity layer", () => {
    // The guard against fixing the lily by flattening every crop: a grown carrot must
    // still sort against actors, or the farmer walks over the tops of everything.
    expect(layerOfGrown(CARROT)).toBe("entity");
  });

  it("draws a Water Lily flat while it GROWS, and only while it grows", () => {
    const cfg = cfgFor("water_lily");
    const ripe = cfg.stages[cfg.stages.length - 1];
    for (const stage of cfg.stages) {
      const field = makeField();
      const sprite = makeSprite();
      field.layoutCrop({ cfg, sprite }, stage, 4, 4);
      const want = stage === ripe ? field.entityLayer : field.cropSeedLayer;
      expect(sprite.parent, `stage ${stage} landed in the wrong layer`).toBe(want);
    }
  });

  it("re-parents out of the ground layer when the lily ripens", () => {
    // The whole ladder in one crop, the way a real plot grows: the mid stage must not
    // strand the sprite in cropSeedLayer once the flower opens.
    const field = makeField();
    const sprite = makeSprite();
    const cfg = cfgFor("water_lily");
    for (const stage of cfg.stages) field.layoutCrop({ cfg, sprite }, stage, 4, 4);
    expect(field.cropSeedLayer.children.length).toBe(0);
  });

  it("leaves no soil companion in the crop ground layer for the flat stage", () => {
    // The split render's second copy is what carries baked dirt. The pond IS its own
    // ground, so a companion would double-draw it.
    const field = makeField();
    const sprite = makeSprite();
    const cfg = cfgFor("water_lily");
    for (const stage of cfg.stages.slice(0, -1)) field.layoutCrop({ cfg, sprite }, stage, 4, 4);
    expect(field.cropGroundLayer.children.length).toBe(0);
    // ...and the ripe stage takes the ordinary split render, dirt copy and all.
    field.layoutCrop({ cfg, sprite }, cfg.stages[cfg.stages.length - 1], 4, 4);
    expect(field.cropGroundLayer.children.length).toBe(1);
  });
});
