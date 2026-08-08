import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { GameAssets, ZombieModel } from "../assets";
import { RaidActor } from "./RaidActor";

const model: ZombieModel = {
  name: "Test Zombie",
  neck: { x: 0, y: 0 },
  scale: 1,
  color: [255, 255, 255],
  parts: [
    { file: "defaultArmB", group: "root", px: -3, py: -25, ax: 1, ay: 0.25, z: 0, tint: true },
    { file: "defaultBody", group: "root", px: 0, py: 0, ax: 0.5, ay: 0.5, z: 3, tint: true },
    { file: "defaultEyeL", group: "head", px: -3, py: -10, ax: 0.5, ay: 0.5, z: 5, tint: true },
    { file: "defaultEyeR", group: "head", px: 3, py: -10, ax: 0.5, ay: 0.5, z: 5, tint: true },
    { file: "defaultJaw", group: "head", px: 0, py: -4, ax: 0.5, ay: 0.5, z: 6, tint: true },
    { file: "defaultArmF", group: "root", px: 9, py: -28, ax: 1, ay: 0.25, z: 7, tint: true },
  ],
};

function assets(): GameAssets {
  return {
    zombieModels: { test: model },
    zombiePartTex: {
      defaultArmB: Texture.EMPTY,
      defaultBody: Texture.EMPTY,
      defaultEyeL: Texture.EMPTY,
      defaultEyeR: Texture.EMPTY,
      defaultJaw: Texture.EMPTY,
      defaultArmF: Texture.EMPTY,
      turnipArm: Texture.EMPTY,
      backArm: Texture.EMPTY,
    },
    mutationParts: {
      turnip: { file: "turnipArm", group: "root", headRel: false, ox: 0, oy: 28, ax: 1, ay: 0.28, z: 8, replaces: "armF" },
      corn_arm: { file: "backArm", group: "root", headRel: false, ox: 9, oy: 29, ax: 1, ay: 0.25, z: 8, replaces: "armF" },
    },
  } as unknown as GameAssets;
}

describe("RaidActor mutation rendering", () => {
  it("excludes animated head effects from raid sizing bounds", () => {
    const testAssets = assets();
    testAssets.zombieModels.ZombieActorHeadlessTier1 = model;
    testAssets.zombieModels.ZombieActorHeadlessTier2 = model;
    const undecorated = new RaidActor(testAssets, "ZombieActorHeadlessTier1");
    const actor = new RaidActor(testAssets, "ZombieActorHeadlessTier2");

    expect(actor.container.getLocalBounds().height)
      .toBeGreaterThan(undecorated.container.getLocalBounds().height);
    expect(actor.getSizingBounds()).toEqual(undecorated.getSizingBounds());
    expect(actor.container.getLocalBounds().height)
      .toBeGreaterThan(actor.getSizingBounds().height);
  });

  it("replaces the normal front arm and animates the mutation arm", () => {
    const actor = new RaidActor(assets(), "test", 8);
    const root = (actor as unknown as { root: { children: { visible: boolean; texture: unknown }[] } }).root;
    const arms = (actor as unknown as { arms: { rotation: number }[] }).arms;

    // Both base arms stay in the rig so a later facing flip can show the other one.
    expect(root.children).toHaveLength(9);
    expect(arms).toHaveLength(3);
    expect(root.children.filter((child) => child.visible === false)).toHaveLength(1);

    actor.poseArms(1, false, false, 0, 0);
    expect(arms.every((arm) => arm.rotation === -2.5)).toBe(true);
  });

  it("replaces the normal back arm and animates the mutation arm", () => {
    const actor = new RaidActor(assets(), "test", 0, "", undefined, ["corn_arm_b"]);
    const root = (actor as unknown as { root: { children: { visible: boolean }[] } }).root;
    const arms = (actor as unknown as { arms: { rotation: number }[] }).arms;

    expect(root.children).toHaveLength(9);
    expect(arms).toHaveLength(3);
    expect(root.children.filter((child) => child.visible === false)).toHaveLength(1);

    actor.poseArms(1, false, false, 0, 0);
    expect(arms.every((arm) => arm.rotation === -2.5)).toBe(true);
  });

  it("swaps front/back mutation arms when facing flips", () => {
    const actor = new RaidActor(assets(), "test", 0, "", undefined, ["corn_arm_b"]);
    const root = (actor as unknown as { root: { children: { visible: boolean }[] } }).root;
    const baseArmB = root.children[0];
    const baseArmF = root.children[5];

    expect(baseArmB.visible).toBe(true);
    expect(baseArmF.visible).toBe(false);

    actor.setFacingFromDelta(-1);
    expect(baseArmB.visible).toBe(false);
    expect(baseArmF.visible).toBe(true);
  });

  it("squashes its eyes only while actively focusing", () => {
    const actor = new RaidActor(assets(), "test");
    const eyes = (actor as unknown as { eyes: { sp: { y: number; scale: { y: number } } }[] }).eyes;

    expect(eyes).toHaveLength(2);
    actor.update(1, false, true);
    expect(eyes.every(({ sp }) => sp.scale.y === 0.76)).toBe(true);

    actor.update(1, false, false);
    expect(eyes.every(({ sp }) => sp.scale.y === 1)).toBe(true);
  });

  it("matches the farm's layered one-fifth-size eyes for Large zombies", () => {
    const actor = new RaidActor(assets(), "test", 0, "Large");
    const eyes = (actor as unknown as {
      eyes: { sp: { scale: { x: number; y: number }; tint: number } }[];
    }).eyes;

    expect(eyes).toHaveLength(4);
    expect(eyes.filter(({ sp }) => sp.scale.x === 0.2 && sp.scale.y === 0.2))
      .toHaveLength(2);
    expect(eyes.filter(({ sp }) => sp.scale.x === 0.2).every(({ sp }) => sp.tint === 0xffffff))
      .toBe(true);

    actor.update(1, false, true);
    for (const { sp } of eyes.filter(({ sp }) => sp.scale.x === 0.2)) {
      expect(sp.scale.y).toBeCloseTo(0.152);
    }
  });

  it("uses the recovered bite head, jaw, eye, and two-arm pose", () => {
    const actor = new RaidActor(assets(), "test");
    const head = (actor as unknown as { headParts: { sp: { x: number } }[] }).headParts;
    const jaws = (actor as unknown as { jaws: { y: number }[] }).jaws;
    const eyes = (actor as unknown as { eyes: { sp: { y: number; scale: { y: number } } }[] }).eyes;
    const arms = (actor as unknown as { arms: { rotation: number }[] }).arms;
    actor.update(0, false);

    // atkProg .38 maps to source time .13: end of headBite's lunge.
    const beforeX = head[0].sp.x;
    const beforeJawY = jaws[0].y;
    const beforeEyeY = eyes[0].sp.y;
    actor.poseArms(0, true, false, 0.38, 0, -1, 0, "ZombieBite");
    expect(head[0].sp.x).toBeLessThan(beforeX - 7);
    expect(jaws[0].y - beforeJawY).toBeGreaterThan(eyes[0].sp.y - beforeEyeY + 1);
    expect(eyes.every(({ sp }) => sp.scale.y < 1)).toBe(true);
    expect(arms.every((arm) => arm.rotation < -1)).toBe(true);
  });

  it("uses the recovered scratch contact pose instead of the generic arm wave", () => {
    const actor = new RaidActor(assets(), "test");
    const head = (actor as unknown as { headParts: { sp: { x: number } }[] }).headParts;
    const arms = (actor as unknown as { arms: { rotation: number }[] }).arms;
    actor.update(0, false);

    // Scratch contact is source time .5, which coincides with atkProg 0/1.
    actor.poseArms(0, true, false, 1, 0, -1, 0, "ZombieScratch");
    expect(head[0].sp.x).toBeLessThan(-3);
    expect(arms[0].rotation).toBeGreaterThan(0.8);
    expect(arms[1].rotation).toBeLessThan(-0.3);
  });

  it("tints the battlefield rig with the unit's own colour, matching the farm", () => {
    // A Zombie Pot child carries an inherited tint. The raid rig used to ignore it
    // and always use the model's catalog colour, so the same zombie was one colour
    // on the farm and in the Army screen and another in the fight.
    const owned = new RaidActor(assets(), "test", 0, "", [16, 32, 48]);
    const children = (owned as unknown as {
      root: { children: { tint: number }[] };
    }).root.children;

    // Body and arms take the owned tint; the model's own colour is white, so
    // seeing 0x102030 at all proves the argument won.
    expect(children.filter((sprite) => sprite.tint === 0x102030).length).toBeGreaterThan(0);

    // Default eyes keep their authored light-yellow regardless of the body tint.
    const eyes = (owned as unknown as { eyes: { sp: { tint: number } }[] }).eyes;
    expect(eyes.every(({ sp }) => sp.tint === 0xffffff)).toBe(true);
  });

  it("falls back to the model's catalog colour when the unit has no tint", () => {
    const plain = new RaidActor(assets(), "test");
    const tinted = (plain as unknown as {
      root: { children: { tint: number }[] };
    }).root.children.filter((sprite) => sprite.tint === 0xffffff);
    // model.color is [255,255,255], so every tintable part lands on white.
    expect(tinted.length).toBeGreaterThan(0);
  });

  it("raises healing arms forward from rest to overhead, then resets", () => {
    const actor = new RaidActor(assets(), "test");
    const arms = (actor as unknown as { arms: { rotation: number }[] }).arms;

    actor.poseArms(0, false, false, 0, 0);
    expect(arms.every((arm) => arm.rotation === -1.5)).toBe(true);

    actor.poseArms(0, false, false, 0, 0, -1, 0.5);
    expect(arms.every((arm) => arm.rotation === 0)).toBe(true);

    actor.poseArms(0, false, false, 0, 0, -1, 1);
    expect(arms.every((arm) => arm.rotation === 1.5)).toBe(true);

    actor.poseArms(0, false, false, 0, 0);
    expect(arms.every((arm) => arm.rotation === -1.5)).toBe(true);
  });
});
