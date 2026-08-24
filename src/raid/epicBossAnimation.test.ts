import { describe, expect, it } from "vitest";
import {
  epicAttackFrameIndex, epicBossAnimationLoops, epicStripFrameIndex, selectEpicBossAnimation,
} from "./epicBossAnimation";
import { EPIC_BOSS_LAND_MS } from "./BattleSim";
import { EPIC_BOSSES } from "../epicBoss/catalog";
import { deriveAttackIntervalMs } from "./combatStats";

const fighting = {
  alive: true, leaving: false, state: "fight", has: () => true,
};
/** A boss carrying only the states someone has ordered by hand. */
const partial = (...states: string[]) => (name: string) => states.includes(name);

describe("selectEpicBossAnimation", () => {
  it("plays the attack strip for every swing the boss is in melee for", () => {
    expect(selectEpicBossAnimation(fighting)).toBe("attack");
  });

  it("idles when nothing is in reach, and while perched or walking on", () => {
    expect(selectEpicBossAnimation({ ...fighting, state: "hold" })).toBe("idle");
    expect(selectEpicBossAnimation({ ...fighting, state: "emerging" })).toBe("idle");
  });

  // Three bosses lost their frame metadata and carry only hand-ordered strips, so a
  // state can simply be absent. Naming it anyway left the token stuck on whatever was
  // last playing, because the play call finds no frames and silently does nothing.
  it("falls back to idle for any state this boss has no strip for", () => {
    const has = partial("idle", "attack");
    expect(selectEpicBossAnimation({ ...fighting, has })).toBe("attack");
    expect(selectEpicBossAnimation({ ...fighting, has, leaving: true })).toBe("idle");
    expect(selectEpicBossAnimation({ ...fighting, has, alive: false })).toBe("idle");
    expect(selectEpicBossAnimation({ ...fighting, has, state: "falling" })).toBe("idle");
    expect(selectEpicBossAnimation({ ...fighting, has, state: "landing" })).toBe("idle");
    expect(selectEpicBossAnimation({ ...fighting, has: partial("idle") })).toBe("idle");
  });

  it("prefers defeat, then escape, over anything the fight state asks for", () => {
    expect(selectEpicBossAnimation({ ...fighting, alive: false })).toBe("defeat");
    expect(selectEpicBossAnimation({ ...fighting, alive: false, leaving: true })).toBe("defeat");
    expect(selectEpicBossAnimation({ ...fighting, leaving: true })).toBe("escape");
  });

  it("uses the sky-entry strips while dropping in and landing", () => {
    expect(selectEpicBossAnimation({ ...fighting, state: "falling" })).toBe("fly");
    expect(selectEpicBossAnimation({ ...fighting, state: "landing" })).toBe("enter");
  });

  it("loops only the two resting strips — attack repeats off the attack clock", () => {
    expect(epicBossAnimationLoops("idle")).toBe(true);
    expect(epicBossAnimationLoops("fly")).toBe(true);
    expect(epicBossAnimationLoops("attack")).toBe(false);
    expect(epicBossAnimationLoops("enter")).toBe(false);
    expect(epicBossAnimationLoops("defeat")).toBe(false);
    expect(epicBossAnimationLoops("escape")).toBe(false);
  });
});

describe("epicStripFrameIndex", () => {
  it("spans the whole strip across the beat", () => {
    expect(epicStripFrameIndex(0, 13)).toBe(0);
    expect(epicStripFrameIndex(0.5, 13)).toBe(6);
    expect(epicStripFrameIndex(1, 13)).toBe(12);
  });

  it("clamps a progress that runs outside the beat", () => {
    expect(epicStripFrameIndex(-3, 13)).toBe(0);
    expect(epicStripFrameIndex(9, 13)).toBe(12);
    expect(epicStripFrameIndex(0.5, 1)).toBe(0);
  });

  // The landing beat is 500 ms of SIM time, shared with the server's replay, so it
  // cannot be widened per boss — the strips authored against it run up to 2 s.
  it("plays every entrance in full inside the landing beat", () => {
    for (const boss of EPIC_BOSSES) {
      const enter = boss.animations.enter;
      if (!enter) continue;
      const seen = new Set<number>();
      for (let ms = EPIC_BOSS_LAND_MS; ms >= 0; ms -= 0.5) {
        seen.add(epicStripFrameIndex(1 - ms / EPIC_BOSS_LAND_MS, enter.frameCount));
      }
      expect(seen.size).toBe(enter.frameCount);
    }
  });
});

describe("epicAttackFrameIndex", () => {
  it("lands the impact frame on the sim's hit", () => {
    // 10 frames, damage at 0.8 => frame 8 is the impact. attackMs 0 IS the hit.
    expect(epicAttackFrameIndex(0, 500, 0.8, 10)).toBe(8);
  });

  it("plays the swing's tail over the start of the next cycle", () => {
    // Just after a hit the strip is still in recovery (past the impact frame), and it
    // reaches the last frame before the wind-up restarts from frame 0.
    expect(epicAttackFrameIndex(500, 500, 0.8, 10)).toBe(8);
    expect(epicAttackFrameIndex(450, 500, 0.8, 10)).toBe(9);
    // The recovery tail owns the first 20% of the cycle; the wind-up restarts under it.
    expect(epicAttackFrameIndex(400, 500, 0.8, 10)).toBe(9);
    expect(epicAttackFrameIndex(399, 500, 0.8, 10)).toBe(0);
  });

  it("advances monotonically through the wind-up", () => {
    let previous = -1;
    for (let ms = 399; ms >= 0; ms--) {
      const index = epicAttackFrameIndex(ms, 500, 0.8, 10);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
    expect(previous).toBe(8); // the wind-up ends on the impact frame
  });

  it("shows every frame of the strip exactly once per attack cycle", () => {
    const seen = new Set<number>();
    for (let ms = 500; ms > 0; ms -= 1) seen.add(epicAttackFrameIndex(ms, 500, 0.8, 10));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("stays in range for a single-frame strip and for a clamped damage timing", () => {
    expect(epicAttackFrameIndex(120, 500, 0.8, 1)).toBe(0);
    expect(epicAttackFrameIndex(120, 500, 5, 6)).toBeLessThan(6);
    expect(epicAttackFrameIndex(120, 500, -5, 6)).toBeGreaterThanOrEqual(0);
    expect(epicAttackFrameIndex(0, 0, 0.8, 6)).toBeLessThan(6);
  });

  // The regression this module exists for: every authored attack strip is LONGER than
  // the attack cycle it belongs to, so playback-driven one-shots could never keep up.
  // The clock-driven index must, whatever the ratio.
  it("keeps up with every animated Epic Boss's real cadence", () => {
    // All eight: the five ZF2 defined, plus the three whose strips are hand-ordered
    // from a recovered atlas (tools/art/epic-boss-frames/*/animations.json).
    const animated = EPIC_BOSSES.filter((boss) => boss.animations.attack);
    expect(animated.length).toBe(EPIC_BOSSES.length);
    for (const boss of animated) {
      const strip = boss.animations.attack;
      const cycleMs = deriveAttackIntervalMs(boss.unitStats.dex, "enemy");
      const stripMs = strip.frameCount * strip.frameSeconds * 1000;
      expect(stripMs).toBeGreaterThan(cycleMs); // the trap: authored longer than a swing

      const seen = new Set<number>();
      for (let ms = cycleMs; ms > 0; ms -= 0.5) {
        seen.add(epicAttackFrameIndex(ms, cycleMs, 0.88, strip.frameCount));
      }
      expect(seen.size).toBe(strip.frameCount); // one full pass per swing, no frames lost
    }
  });
});
