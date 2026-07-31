import { Texture } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameAssets, ZombieModel } from "../assets";
import { buildZombiePortraitRig, validatePortraitDataUrl } from "./mutationPortrait";

afterEach(() => vi.unstubAllGlobals());

const model: ZombieModel = {
  name: "Test", neck: { x: 2, y: -20 }, scale: 1, color: [100, 120, 140],
  parts: [
    { file: "baseBody", group: "root", px: 0, py: -20, ax: 0.5, ay: 0.5, z: 3, tint: true },
    { file: "baseArmF", group: "root", px: 8, py: -25, ax: 1, ay: 0.5, z: 7, tint: true },
    { file: "defaultHead", group: "head", px: 2, py: -30, ax: 0.5, ay: 0.5, z: 4, tint: true },
    { file: "defaultEyeL", group: "head", px: 0, py: -32, ax: 0.5, ay: 0.5, z: 9, tint: true },
    { file: "defaultJaw", group: "head", px: 2, py: -25, ax: 0.5, ay: 0.5, z: 10, tint: true },
    { file: "defaultLowerTeeth", group: "head", px: 2, py: -24, ax: 0.5, ay: 0.5, z: 11, tint: true },
    { file: "gnomeFeature", group: "head", px: 2, py: -34, ax: 0.5, ay: 0.5, z: 12, tint: false },
  ],
};

const assets = {
  zombieModels: { test: model, ZombieActorRegularTier1: model },
  zombiePartTex: {
    baseBody: Texture.EMPTY, baseArmF: Texture.EMPTY, defaultHead: Texture.EMPTY,
    defaultEyeL: Texture.EMPTY, defaultJaw: Texture.EMPTY, defaultLowerTeeth: Texture.EMPTY,
    gnomeFeature: Texture.EMPTY,
    tomato: Texture.EMPTY, turnip: Texture.EMPTY, lima: Texture.EMPTY,
  },
  mutationParts: {
    "1": { file: "tomato", group: "head", headRel: true, ox: 1, oy: 4, ax: 0.5, ay: 0.5, z: 4 },
    "8": { file: "turnip", group: "root", headRel: false, ox: 8, oy: 25, ax: 1, ay: 0.5, z: 8, replaces: "armF" },
    "1024": { file: "lima", group: "root", headRel: false, ox: 0, oy: 20, ax: 0.5, ay: 0.5, z: 4, replaces: "body" },
  },
} as unknown as GameAssets;

describe("mutation-aware zombie portraits", () => {
  it("accepts visible extracts and rejects fully transparent PNGs", async () => {
    class FakeImage {
      src = "";
      naturalWidth = 1;
      naturalHeight = 1;
      decode = vi.fn().mockResolvedValue(undefined);
    }
    let alpha = 255;
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
          getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, alpha]) }),
        }),
      }),
    });

    await expect(validatePortraitDataUrl("data:image/png;base64,visible")).resolves
      .toBe("data:image/png;base64,visible");
    alpha = 0;
    await expect(validatePortraitDataUrl("data:image/png;base64,blank")).rejects
      .toThrow("portrait extraction was transparent");
  });

  it("renders every mutation and hides the base parts they replace", () => {
    const rig = buildZombiePortraitRig(assets, "test", 1 | 8 | 1024);
    const children = rig.children as unknown as {
      label: string;
      visible: boolean;
      tint: number;
      zIndex: number;
    }[];

    expect(children.map((child) => child.label)).toEqual([
      "baseBody", "baseArmF", "defaultHead", "defaultEyeL", "defaultJaw",
      "defaultLowerTeeth", "gnomeFeature", "tomato", "turnip", "lima",
    ]);
    expect(children.find((child) => child.label === "baseBody")?.visible).toBe(false);
    expect(children.find((child) => child.label === "baseArmF")?.visible).toBe(false);
    expect(children.find((child) => child.label === "defaultHead")?.visible).toBe(false);
    expect(children.find((child) => child.label === "defaultEyeL")?.tint).toBe(0xffffff);
    const mutationZ = children.find((child) => child.label === "tomato")?.zIndex ?? 0;
    for (const label of ["defaultEyeL", "defaultJaw", "defaultLowerTeeth", "gnomeFeature"]) {
      const child = children.find((candidate) => candidate.label === label);
      expect(child?.visible).toBe(true);
      expect(child?.zIndex).toBeGreaterThan(mutationZ);
    }
  });
});
