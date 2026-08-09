import { describe, expect, it } from "vitest";
import { validGameplayCommand } from "../src/index";
import type { GameplayCommand } from "../../src/net/protocol";

/** One VALID instance of every command the client can emit.
 *
 *  The Record key is the client's own union, so adding a command type to
 *  `GameplayCommand` fails to compile until a sample lands here — which is the point.
 *  A type the client can send but `validGameplayCommand` doesn't know is not a
 *  degraded action: the batch is refused wholesale as `bad_command_batch`, the
 *  persisted outbox replays it, and the player's farm is paused permanently behind
 *  "Gameplay paused — reconnect to continue".
 *
 *  This is exactly how `farm.move` shipped: the engine implemented it and had six
 *  passing tests, but those call the engine directly and never cross this door, so
 *  every player who moved a plot bricked their own account. */
const SAMPLES: Record<GameplayCommand["type"], GameplayCommand> = {
  "writer.claim": { type: "writer.claim" },
  "farm.plow": { type: "farm.plow", oc: 0, or: 0 },
  "farm.plant": { type: "farm.plant", oc: 0, or: 0, cropKey: "carrot", fertilized: true },
  "farm.harvest": { type: "farm.harvest", oc: 0, or: 0 },
  "farm.remove": { type: "farm.remove", oc: 0, or: 0 },
  "farm.move": { type: "farm.move", oc: 0, or: 0, toOc: 8, toOr: 4 },
  "power.buy": { type: "power.buy", key: "fertilizer" },
  "power.use": { type: "power.use", key: "fertilizer", oc: 0, or: 0, target: "zombie_pot" },
  "object.buy": { type: "object.buy", catalogKey: "tree", clientInstanceId: "local-1" },
  "object.refund": { type: "object.refund", instanceId: "obj-1" },
  "object.upgrade": { type: "object.upgrade", instanceId: "obj-1", catalogKey: "tree2" },
  "object.status": { type: "object.status", instanceId: "obj-1", status: "stored" },
  "object.harvest_trees": { type: "object.harvest_trees", instanceIds: ["obj-1", "obj-2"] },
  "storage.claim": { type: "storage.claim", itemName: "Gnome", clientInstanceId: "local-2" },
  "storage.move": { type: "storage.move", itemKey: "carrot", direction: "store", quantity: 3 },
  "roster.sell": { type: "roster.sell", unitId: "z-1" },
  "roster.status": { type: "roster.status", unitId: "z-1", stored: true },
  "roster.combine_start": {
    type: "roster.combine_start", potId: "pot-1", parentAId: "z-1", parentBId: "z-2", playerLevel: 25,
  },
  "roster.combine": {
    type: "roster.combine", potId: "pot-1", parentAId: "z-1", parentBId: "z-2", playerLevel: 25,
    stored: true,
  },
  "shop.size": { type: "shop.size", size: 40, currency: "gold" },
  "shop.climate": { type: "shop.climate", terrain: "swamp" },
  "farmer.buy": { type: "farmer.buy", headId: 3 },
  "farmer.equip": { type: "farmer.equip", headId: 3 },
  "farmer.bonus": { type: "farmer.bonus", headId: null },
  "pet.buy": { type: "pet.buy", petKey: "cat" },
  "pet.equip": { type: "pet.equip", petKey: null },
  "pet.pen": { type: "pet.pen", petKeys: ["cat", "dog"] },
  "memorial.enshrine": { type: "memorial.enshrine", instanceId: "obj-1", unitId: "z-1", name: "Bob" },
  "memorial.clear": { type: "memorial.clear", instanceId: "obj-1" },
  "tutorial.complete": { type: "tutorial.complete" },
};

describe("gameplay command validation", () => {
  it.each(Object.keys(SAMPLES))("accepts %s", (type) => {
    expect(validGameplayCommand(SAMPLES[type as GameplayCommand["type"]])).toBe(true);
  });

  // The optional fields are the easy ones to over-tighten; omitting them must stay legal.
  it("accepts commands with every optional field omitted", () => {
    const minimal: GameplayCommand[] = [
      { type: "farm.plant", oc: 0, or: 0, cropKey: "carrot" },
      { type: "power.use", key: "fertilizer" },
      { type: "object.buy", catalogKey: "tree" },
      { type: "storage.claim", itemName: "Gnome" },
      { type: "roster.combine_start", potId: "p", parentAId: "a", parentBId: "b" },
      { type: "roster.combine", parentAId: "a", parentBId: "b" },
      { type: "memorial.enshrine", instanceId: "obj-1", unitId: "z-1" },
    ];
    for (const command of minimal) expect(validGameplayCommand(command)).toBe(true);
  });

  it("still refuses malformed and unknown commands", () => {
    expect(validGameplayCommand({ type: "farm.move", oc: 0, or: 0 })).toBe(false);
    expect(validGameplayCommand({ type: "farm.move", oc: 0, or: 0, toOc: 1.5, toOr: 0 })).toBe(false);
    expect(validGameplayCommand({ type: "farm.plow", oc: "0", or: 0 })).toBe(false);
    expect(validGameplayCommand({ type: "nonsense.command" })).toBe(false);
    expect(validGameplayCommand(null)).toBe(false);
  });
});
