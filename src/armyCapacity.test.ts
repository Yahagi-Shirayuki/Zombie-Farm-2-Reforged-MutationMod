import { describe, expect, it } from "vitest";
import placeables from "../public/assets/placeables.json";
import { armyCapacityOf, BASE_ARMY_MAX } from "./armyCapacity";
import type { PlaceableDef } from "./assets";

const catalog = new Map((placeables as PlaceableDef[]).map((def) => [def.key, def]));
const armyMaxOf = (key: string) => catalog.get(key)?.armyMax;

describe("armyCapacityOf", () => {
  it("is the base alone on a farm with nothing that grants slots", () => {
    expect(armyCapacityOf(BASE_ARMY_MAX, ["daisy", "shamrocks"], armyMaxOf)).toBe(16);
  });

  it("adds the Zombie Monolith's four slots while it is placed", () => {
    expect(armyCapacityOf(BASE_ARMY_MAX, ["daisy", "monolithZombie"], armyMaxOf)).toBe(20);
  });

  // The bug: the cap used to be nudged by +/- armyMax at each placement site, so a
  // Monolith that reached the farm through a branch that forgot to add its +4 left the
  // cap at 16 — and storing it subtracted four slots the cap had never been given,
  // dropping the player to 12. Derived, the answer depends only on what is placed, so
  // storing and re-placing are exact inverses no matter how the object got there.
  it("is an exact inverse across store and re-place, however the object arrived", () => {
    const placed = ["daisy", "monolithZombie"];
    const stored = ["daisy"];
    expect(armyCapacityOf(BASE_ARMY_MAX, placed, armyMaxOf)).toBe(20);
    expect(armyCapacityOf(BASE_ARMY_MAX, stored, armyMaxOf)).toBe(16);
    expect(armyCapacityOf(BASE_ARMY_MAX, placed, armyMaxOf)).toBe(20);
    // ...and it can never read below the base, which is what "went down to 12" was.
    expect(armyCapacityOf(BASE_ARMY_MAX, stored, armyMaxOf)).toBeGreaterThanOrEqual(BASE_ARMY_MAX);
  });

  it("counts every copy, and ignores keys the catalog does not know", () => {
    expect(armyCapacityOf(BASE_ARMY_MAX, ["monolithZombie", "monolithZombie"], armyMaxOf)).toBe(24);
    expect(armyCapacityOf(BASE_ARMY_MAX, ["nonesuch"], armyMaxOf)).toBe(16);
  });

  // Online the server sends its own base and it wins, so a future server-side bump
  // does not need a client release to agree about the same farm.
  it("follows the server's base rather than the shipped default", () => {
    expect(armyCapacityOf(24, ["monolithZombie"], armyMaxOf)).toBe(28);
  });

  it("ships the same base the server derives from (server/src/index.ts DEFAULT_ARMY_SIZE)", () => {
    expect(BASE_ARMY_MAX).toBe(16);
  });
});
