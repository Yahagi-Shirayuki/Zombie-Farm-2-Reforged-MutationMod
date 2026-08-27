import { describe, expect, it } from "vitest";
import { SAVE_VERSION, migrateSave, type SaveGame } from "./schema";

// Every reader of a stored save compared `version !== SAVE_VERSION` and treated any
// difference as damage. Nothing migrated, and nothing ever had to — each field added
// since launch was made optional with a default, precisely so the constant could stay
// at 1. That is what made it dangerous: the first person to bump it would have turned
// every Local Farm on every device into "Can't Open Your Local Farm", whose only other
// button is "Start a New Local Farm" — which deletes the save AND its backup. A
// one-line change was one click away from wiping every offline player, with the bytes
// on disk perfectly intact the whole time.
//
// `migrateSave` is the seam that makes a bump survivable, and these are the rules it
// has to keep for that to be true.

const save = (over: Partial<SaveGame> = {}): SaveGame => ({
  version: SAVE_VERSION,
  savedAt: 1,
  player: { name: "P", gold: 1, brains: 1, xp: 1, zombieMax: 16, zombieCount: 0 },
  farm: { fieldId: "default", w: 30, h: 30, climate: "grass", plots: [] },
  ...over,
} as SaveGame);

describe("save migration", () => {
  it("passes a current save through untouched", () => {
    const current = save();
    expect(migrateSave(current)).toBe(current);
  });

  it("refuses a save from a FUTURE build rather than guessing", () => {
    // This build cannot know what a later one meant by its shape, and a wrong guess
    // would corrupt the save for the build that CAN read it.
    expect(migrateSave(save({ version: SAVE_VERSION + 1 }))).toBeNull();
  });

  it("refuses anything that is not a save", () => {
    expect(migrateSave(null)).toBeNull();
    expect(migrateSave(undefined)).toBeNull();
    expect(migrateSave({} as SaveGame)).toBeNull();
    expect(migrateSave(save({ version: "1" as never }))).toBeNull();
    // The two fields every reader has always required before applying anything.
    expect(migrateSave(save({ player: undefined as never }))).toBeNull();
    expect(migrateSave(save({ farm: undefined as never }))).toBeNull();
  });

  // The point of the seam. If this fails, someone bumped SAVE_VERSION without
  // teaching migrateSave how to read the version before it — which is the exact
  // change that would delete every existing Local Farm.
  it("can read every version it has ever written", () => {
    for (let version = 1; version <= SAVE_VERSION; version++) {
      const migrated = migrateSave(save({ version }));
      expect(migrated, `no migration path from save version ${version}`).not.toBeNull();
      expect(migrated!.version).toBe(SAVE_VERSION);
    }
  });
});
