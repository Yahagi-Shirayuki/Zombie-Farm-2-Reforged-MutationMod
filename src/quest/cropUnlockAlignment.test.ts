import { describe, expect, it } from "vitest";
import plants from "../../public/assets/plants.json";
import quests from "../../public/assets/quests.json";
import { XP_THRESHOLDS } from "../GameState";

// The crop rebalance (tools/reforge_economy.py CROP_REBALANCE) respreads the 25
// regular crops over levels 1-45. Two invariants have to hold for that ladder to
// be playable, and both were violated at some point while designing it:
//
//   1. Nothing unlocks above the level cap. The first draft put the capstone crop
//      at level 50, which no account can ever reach.
//   2. No quest asks for a crop that unlocks after the quest itself does, or the
//      quest sits on the rail as an impossible objective.
//
// Neither is expressible in plants.json alone, so they live here.

const LEVEL_CAP = XP_THRESHOLDS.length;

/** Quest requirement kinds whose `notificationObject` names a crop. */
const CROP_EVENTS = new Set([
  "kCropPlantedNotification",
  "kCropHarvestedNotification",
  "kCropHarvestedZombieNotification",
]);

interface QuestDef {
  title: string;
  levelRequired: number;
  prerequisiteQuest: number;
  seasonal: boolean;
  epicEvent: boolean;
  requirements: { notificationID: string; notificationObject: string }[];
}
const QUESTS = quests as unknown as Record<string, QuestDef>;

const cropByName = new Map(plants.map((p) => [p.name.toLowerCase(), p]));

/** The level a quest actually becomes available at. `levelRequired: -1` means
 *  "inherit", so the real gate is the highest requirement in the prerequisite
 *  chain — reading the field alone reports a gate that is too low. */
function effectiveGate(id: string, seen = new Set<string>()): number {
  const q = QUESTS[id];
  if (!q || seen.has(id)) return 0;
  seen.add(id);
  const own = q.levelRequired > 0 ? q.levelRequired : 0;
  const prereq = String(q.prerequisiteQuest);
  return QUESTS[prereq] ? Math.max(own, effectiveGate(prereq, seen)) : own;
}

describe("crop unlock ladder", () => {
  it("never unlocks a crop above the level cap", () => {
    expect(LEVEL_CAP).toBe(45);
    for (const p of plants) {
      expect.soft(p.level, `${p.key} unlocks at ${p.level}, cap is ${LEVEL_CAP}`)
        .toBeLessThanOrEqual(LEVEL_CAP);
    }
  });

  it("tops out exactly at the cap, so the last level still unlocks something", () => {
    const regular = plants.filter((p) => !p.seasonal);
    expect(Math.max(...regular.map((p) => p.level))).toBe(LEVEL_CAP);
  });

  it("unlocks at most two regular crops on any one level", () => {
    const perLevel = new Map<number, string[]>();
    for (const p of plants.filter((x) => !x.seasonal)) {
      perLevel.set(p.level, [...(perLevel.get(p.level) ?? []), p.key]);
    }
    for (const [level, keys] of perLevel) {
      expect.soft(keys.length, `level ${level}: ${keys.join(", ")}`).toBeLessThanOrEqual(2);
    }
  });
});

describe("quest gates match crop unlocks", () => {
  it("never asks for a crop that unlocks after the quest becomes available", () => {
    let checked = 0;
    for (const [id, q] of Object.entries(QUESTS)) {
      // Seasonal and epic-event quests run on their own schedules, and seasonal
      // crops are excluded from the rebalance, so neither is in scope here.
      if (q.seasonal || q.epicEvent) continue;
      const gate = effectiveGate(id);
      for (const req of q.requirements ?? []) {
        if (!CROP_EVENTS.has(req.notificationID)) continue;
        // "" is the format's wildcard ("harvest any 15 crops").
        const crop = cropByName.get((req.notificationObject || "").trim().toLowerCase());
        // Requirements naming a zombie or a tree are gated by their own catalogs.
        if (!crop || crop.seasonal) continue;
        checked++;
        expect.soft(
          crop.level,
          `quest ${id} "${q.title}" opens at level ${gate} but needs ${crop.key} (level ${crop.level})`,
        ).toBeLessThanOrEqual(gate);
      }
    }
    // Guards the guard: a rename in either file would otherwise make every
    // lookup miss and leave this test asserting nothing at all.
    expect(checked).toBeGreaterThanOrEqual(14);
  });
});
