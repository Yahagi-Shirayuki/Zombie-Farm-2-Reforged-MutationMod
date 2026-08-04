import { describe, it, expect } from "vitest";
import {
  sortZombies, isZombieSort, DEFAULT_ZOMBIE_SORT, ZOMBIE_SORTS, type SortableZombie,
} from "./rosterSort";

const z = (over: Partial<SortableZombie> & { name: string }): SortableZombie => ({
  id: over.name, key: "ZombieActorRegular", group: "Regular", className: "Green",
  str: 5, dex: 2, con: 8, focus: 50, mutation: 0, invasions: 0, ...over,
});

// No abilities unlocked: the stat totals are then base × veterancy, which keeps the
// expectations readable without pinning them to the ability pool's contents.
const locked = () => false;
const names = (rows: SortableZombie[]) => rows.map((r) => r.name);

const roster: SortableZombie[] = [
  z({ name: "Ada", str: 5, dex: 2, con: 8, focus: 40, invasions: 12 }),
  z({ name: "boris", str: 11, dex: 1, con: 20, focus: 90, invasions: 0 }),
  z({ name: "Cara", str: 2, dex: 4.3, con: 5, focus: 65, invasions: 3 }),
];

describe("sortZombies", () => {
  it("leaves the roster in its own (creation) order by default", () => {
    expect(names(sortZombies(roster, "default", locked))).toEqual(["Ada", "boris", "Cara"]);
  });

  it("sorts by each stat, strongest first", () => {
    expect(names(sortZombies(roster, "str", locked))).toEqual(["boris", "Ada", "Cara"]);
    expect(names(sortZombies(roster, "dex", locked))).toEqual(["Cara", "Ada", "boris"]);
    expect(names(sortZombies(roster, "con", locked))).toEqual(["boris", "Ada", "Cara"]);
    expect(names(sortZombies(roster, "focus", locked))).toEqual(["boris", "Cara", "Ada"]);
  });

  it("sorts by invasions, the most experienced first", () => {
    expect(names(sortZombies(roster, "invasions", locked))).toEqual(["Ada", "Cara", "boris"]);
  });

  it("sorts by name, case-insensitively", () => {
    expect(names(sortZombies(roster, "name", locked))).toEqual(["Ada", "boris", "Cara"]);
  });

  it("ranks by the DISPLAYED stat, so veterancy outranks an equal raw stat", () => {
    const rows = sortZombies(
      [z({ name: "Rookie", str: 9 }), z({ name: "Master", str: 9, invasions: 60 })],
      "str", locked
    );
    expect(names(rows)).toEqual(["Master", "Rookie"]);
  });

  it("breaks ties by name so a re-render never reshuffles equal rows", () => {
    const tied = [z({ name: "zed" }), z({ name: "Abe" }), z({ name: "mid" })];
    expect(names(sortZombies(tied, "str", locked))).toEqual(["Abe", "mid", "zed"]);
    expect(names(sortZombies(tied, "invasions", locked))).toEqual(["Abe", "mid", "zed"]);
  });

  it("never mutates the roster it was given", () => {
    const original = [...roster];
    sortZombies(roster, "con", locked);
    sortZombies(roster, "name", locked);
    expect(roster).toEqual(original);
  });
});

describe("isZombieSort", () => {
  it("accepts every offered mode and rejects anything else", () => {
    for (const option of ZOMBIE_SORTS) expect(isZombieSort(option.id)).toBe(true);
    expect(isZombieSort("power")).toBe(false);
    expect(isZombieSort(undefined)).toBe(false);
    expect(isZombieSort(null)).toBe(false);
  });

  it("offers the default mode", () => {
    expect(ZOMBIE_SORTS.some((s) => s.id === DEFAULT_ZOMBIE_SORT)).toBe(true);
  });
});
