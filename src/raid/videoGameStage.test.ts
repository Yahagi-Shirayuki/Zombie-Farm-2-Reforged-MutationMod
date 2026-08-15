import { describe, expect, it } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test environment
// provides this at runtime. Same treatment as docsVersionSync.test.ts.
// @ts-ignore
import { readFileSync } from "node:fs";
import enemyStatsJson from "../../public/assets/raids/enemy_stats.json";
import attacksJson from "../../public/assets/raids/attacks.json";
import raidsJson from "../../public/assets/raids/raids.json";
import { PIXEL_ZOMBIE_KEY, VIDEO_GAME_RAID_ID, turnedUnitFor } from "./videoGameStage";
import type { AttackDef, EnemyStat, RaidDef } from "./types";

const enemyStats = enemyStatsJson as unknown as Record<string, EnemyStat>;
const attacks = attacksJson as unknown as Record<string, AttackDef>;
const raids = raidsJson as unknown as RaidDef[];

describe("the pixel zombie turnZombie stands up", () => {
  it("is carried through the asset pipeline at all", () => {
    // It is authored in UnitStats.json but listed in NO raid stage, so `prep_raids.py`
    // dropped it until EXTRA_UNITS was added. If this fails, a regeneration lost it again
    // and `turnZombie` silently becomes a no-op — which is exactly how the action came to
    // be modelled as an instant kill in the first place.
    expect(enemyStats[PIXEL_ZOMBIE_KEY]).toBeTruthy();
    expect(attacks[enemyStats[PIXEL_ZOMBIE_KEY].attacks![0].name]).toBeTruthy();
  });

  it("builds only for the raid whose boss carries the action", () => {
    expect(turnedUnitFor(VIDEO_GAME_RAID_ID, enemyStats, attacks)?.sourceKey)
      .toBe(PIXEL_ZOMBIE_KEY);
    for (const raid of raids) {
      if (raid.id === VIDEO_GAME_RAID_ID) continue;
      expect(turnedUnitFor(raid.id, enemyStats, attacks), raid.name).toBeNull();
    }
  });

  it("is far too tough to be fought down, which is why it is tapped down", () => {
    const pixel = turnedUnitFor(VIDEO_GAME_RAID_ID, enemyStats, attacks)!;
    // The authored con of 10000 is the whole reason this unit is a hazard rather than an
    // enemy: it dwarfs every wave minion on the stage. If someone "fixes" it down to a
    // fightable number, the tap-to-rescue loop stops making sense and it should become an
    // ordinary blocker instead — a deliberate decision, not a quiet consequence.
    const stageKeys = ["VideoGameStageGhostActor", "VideoGameStageKnightActor", "VideoGameStageMonsterActor"];
    for (const key of stageKeys) {
      expect(pixel.maxHp).toBeGreaterThan((enemyStats[key].con ?? 1) * 100 * 10);
    }
  });

  it("is forwarded from the launch all the way to the live scene", () => {
    // The bug this guards is silent in the worst way: `turnedTemplate` is an OPTIONAL
    // RaidScene param, so a launch that computes it correctly and a `RaidScene.create`
    // call that forgets to pass it type-check, run, and simply never convert anybody.
    // Caught exactly that way during development. Every per-fight config the launch
    // resolves has the same shape, so guard them together.
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const call = main.slice(main.lastIndexOf("RaidScene.create(app, {"));
    const body = call.slice(0, call.indexOf("onFinish:"));
    for (const field of [
      "bossThrow", "bossSpecials", "grabber", "crab", "summon",
      "waveCadence", "wallTemplate", "turnedTemplate",
    ]) {
      expect(body, field).toContain(`${field}: setup.${field},`);
    }
  });
});
