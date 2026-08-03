import { describe, expect, it } from "vitest";
import type { GameAssets, ZombieDef } from "../assets";
import type { Field } from "../Field";
import { GameState } from "../GameState";
import type { ZombiePotSave } from "../save/schema";
import { ZombieField } from "./ZombieField";

const legacyJob = (): ZombiePotSave => ({
  parentAId: "parent-a",
  parentBId: "parent-b",
  keyA: "ordinary",
  keyB: "mutant",
  maskA: 0,
  maskB: 1,
  startedAt: 1,
  finishAt: 2,
});

/** Enough of GameAssets for ZombieUnit to build a part-less model. */
const renderableAssets = (key: string): GameAssets => ({
  zombieModels: { [key]: { color: [0, 0, 0], neck: { x: 0, y: 0 }, parts: [] } },
  zombiePartTex: {},
  invasionBubble: undefined,
} as unknown as GameAssets);

/** A Field that can host a spawned unit (the combine result is added to the farm). */
const renderableField = (): Field => ({
  zombiePotId: () => "pot",
  entityLayer: { addChild: () => {}, removeChild: () => {} },
  patchRestTiles: () => [],
} as unknown as Field);

describe("ZombieField combine save migration", () => {
  it("hydrates legacy jobs and falls back when the multi-pot map is empty", () => {
    const state = new GameState();
    state.xp = 20_500;
    const defs = new Map<string, Partial<ZombieDef>>([
      ["ordinary", { key: "ordinary", tier: 3, group: "Large", category: "normal" }],
      ["mutant", { key: "mutant", tier: 2, group: "Small", category: "mutant" }],
    ]);
    const field = { zombiePotId: () => "pot" } as unknown as Field;
    const zombies = new ZombieField(
      {} as GameAssets,
      field,
      state,
      (key) => defs.get(key) as ZombieDef | undefined
    );

    zombies.restorePots({}, legacyJob());

    expect(zombies.potFor("pot").pending).toMatchObject({
      tierA: 3,
      tierB: 2,
      baseA: false,
      baseB: true,
      groupA: "Large",
      groupB: "Small",
      specialA: false,
      specialB: false,
      playerLevel: 25,
    });
  });

  it("renames stored zombies and persists the normalized custom name", () => {
    const state = new GameState();
    const def = {
      key: "ordinary", name: "Regular Zombie", group: "Regular",
      className: "Green", classColor: "#00ff00", str: 1, dex: 1, con: 1, focus: 1,
    } as ZombieDef;
    const field = { zombiePotId: () => "pot" } as unknown as Field;
    const zombies = new ZombieField({} as GameAssets, field, state, (key) => key === def.key ? def : undefined);
    zombies.restore([{ id: "z1", key: def.key, stored: true, name: "Original" }]);

    expect(zombies.rename("z1", "  Sir   Rottington  ")).toBe("Sir Rottington");
    expect(zombies.serialize()[0]).toMatchObject({ id: "z1", name: "Sir Rottington", stored: true });
    expect(zombies.rename("z1", "   ")).toBeNull();
    expect(zombies.serialize()[0].name).toBe("Sir Rottington");
  });

  it("leaves a ready Pot pending while the active zombie capacity is full", () => {
    const state = new GameState();
    state.zombieMax = 0;
    const def = {
      key: "ordinary", name: "Regular Zombie", group: "Regular", tier: 1,
      className: "Green", classColor: "#00ff00", str: 1, dex: 1, con: 1, focus: 1,
    } as ZombieDef;
    const field = { zombiePotId: () => "pot" } as unknown as Field;
    const zombies = new ZombieField({} as GameAssets, field, state, (key) => key === def.key ? def : undefined);
    zombies.restorePots({ pot: {
      parentAId: "a", parentBId: "b", keyA: def.key, keyB: def.key,
      maskA: 0, maskB: 0, startedAt: 0, finishAt: 0,
    } });

    expect(zombies.collectCombine(0, 0, "pot")).toBeNull();
    expect(zombies.potFor("pot").pending).not.toBeNull();
  });

  it("puts the job back when the collection cannot be handed to the server", () => {
    const state = new GameState();
    const def = {
      key: "ordinary", name: "Regular Zombie", group: "Regular", tier: 1,
      className: "Green", classColor: "#00ff00", str: 1, dex: 1, con: 1, focus: 1,
    } as ZombieDef;
    const field = renderableField();
    const zombies = new ZombieField(renderableAssets(def.key), field, state, (key) => key === def.key ? def : undefined);
    zombies.restorePots({ pot: {
      parentAId: "a", parentBId: "b", keyA: def.key, keyB: def.key,
      maskA: 0, maskB: 0, reserved: true, startedAt: 0, finishAt: 0,
    } });
    zombies.setRosterLive();
    zombies.onCombineCollect = () => false; // client no longer knows the parents

    expect(zombies.collectCombine(0, 0, "pot")).toBeNull();
    // The parents were consumed at start: losing the job here would destroy both.
    expect(zombies.potFor("pot").pending).toMatchObject({ parentAId: "a", parentBId: "b" });
    expect(zombies.potFor("pot").ready).toBe(true);
    expect(zombies.roster()).toHaveLength(0); // no phantom child left behind
  });

  it("keeps the job when the collection is accepted", () => {
    const state = new GameState();
    const def = {
      key: "ordinary", name: "Regular Zombie", group: "Regular", tier: 1,
      className: "Green", classColor: "#00ff00", str: 1, dex: 1, con: 1, focus: 1,
    } as ZombieDef;
    const field = renderableField();
    const zombies = new ZombieField(renderableAssets(def.key), field, state, (key) => key === def.key ? def : undefined);
    zombies.restorePots({ pot: {
      parentAId: "a", parentBId: "b", keyA: def.key, keyB: def.key,
      maskA: 0, maskB: 0, reserved: true, startedAt: 0, finishAt: 0,
    } });
    zombies.setRosterLive();
    zombies.onCombineCollect = () => true;

    expect(zombies.collectCombine(0, 0, "pot")).not.toBeNull();
    expect(zombies.potFor("pot").pending).toBeNull();
    expect(zombies.roster()).toHaveLength(1);
  });

  it("retires a reserved job the settled authoritative roster does not back", () => {
    const state = new GameState();
    const defs = new Map<string, Partial<ZombieDef>>([
      ["ordinary", { key: "ordinary", tier: 1, category: "normal" }],
    ]);
    const field = { zombiePotId: () => "pot" } as unknown as Field;
    const zombies = new ZombieField(
      {} as GameAssets, field, state, (key) => defs.get(key) as ZombieDef | undefined
    );
    zombies.restorePots({ pot: {
      parentAId: "a", parentBId: "b", keyA: "ordinary", keyB: "ordinary",
      maskA: 0, maskB: 0, reserved: true, startedAt: 0, finishAt: 0,
    } });

    // Unsettled: this client still has work outstanding, so the roster proves nothing.
    expect(zombies.reconcileServerPots([
      { id: "a", key: "ordinary", mutation: 0 },
      { id: "b", key: "ordinary", mutation: 0 },
    ], false).retired).toEqual([]);
    expect(zombies.potFor("pot").busy).toBe(true);

    // Settled with both parents unreserved: the server has no such combine.
    const result = zombies.reconcileServerPots([
      { id: "a", key: "ordinary", mutation: 0 },
      { id: "b", key: "ordinary", mutation: 0 },
    ], true);
    expect(result.retired).toEqual(["pot"]);
    expect(zombies.potFor("pot").busy).toBe(false);
    // Released: the parents are no longer hidden from the roster reconcile.
    expect(zombies.pendingPotParents()).toEqual([]);
  });

  it("never retires an unreserved legacy job the server still honours", () => {
    const state = new GameState();
    const defs = new Map<string, Partial<ZombieDef>>([
      ["ordinary", { key: "ordinary", tier: 1, category: "normal" }],
    ]);
    const field = { zombiePotId: () => "pot" } as unknown as Field;
    const zombies = new ZombieField(
      {} as GameAssets, field, state, (key) => defs.get(key) as ZombieDef | undefined
    );
    zombies.restorePots({ pot: legacyJob() });

    const result = zombies.reconcileServerPots([
      { id: "parent-a", key: "ordinary", mutation: 0 },
      { id: "parent-b", key: "ordinary", mutation: 0 },
    ], true);

    expect(result.retired).toEqual([]);
    expect(zombies.potFor("pot").busy).toBe(true);
  });

  it("recovers an orphaned authoritative Pot reservation as ready", () => {
    const state = new GameState();
    const defs = new Map<string, Partial<ZombieDef>>([
      ["ordinary", { key: "ordinary", tier: 1, category: "normal" }],
      ["mutant", { key: "mutant", tier: 1, category: "mutant" }],
    ]);
    const field = { zombiePotId: () => "pot" } as unknown as Field;
    const zombies = new ZombieField(
      {} as GameAssets, field, state, (key) => defs.get(key) as ZombieDef | undefined
    );

    const recovered = zombies.reconcileServerPots([
      { id: "a", key: "ordinary", mutation: 0, lockedByRaid: "pot:pot" },
      { id: "b", key: "mutant", mutation: 1, lockedByRaid: "pot:pot" },
    ]);

    expect(recovered.live).toEqual([{
      potId: "pot", parentAId: "a", parentBId: "b", playerLevel: state.level,
    }]);
    expect(recovered.retired).toEqual([]);
    expect(zombies.potFor("pot").ready).toBe(true);
    expect(zombies.potFor("pot").pending).toMatchObject({
      parentAId: "a", parentBId: "b", keyA: "ordinary", keyB: "mutant",
    });
  });
});
