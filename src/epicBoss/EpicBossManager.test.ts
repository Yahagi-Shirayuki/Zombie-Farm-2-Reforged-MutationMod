import { describe, expect, it } from "vitest";
import { DR_GROUNDHOG, EPIC_BOSSES, epicBossById, epicBossHp } from "./catalog";
import { EpicBossManager } from "./EpicBossManager";

describe("Dr. Groundhog event", () => {
  it("registers all eight recovered bosses with usable combat presentation", () => {
    expect(EPIC_BOSSES).toHaveLength(8);
    expect(new Set(EPIC_BOSSES.map((boss) => boss.id)).size).toBe(8);
    expect(EPIC_BOSSES.slice(0, 5).every((boss) => Object.keys(boss.animations).length === 6)).toBe(true);
    expect(EPIC_BOSSES.slice(5).every((boss) => boss.reconstructed && boss.bossTexture)).toBe(true);
    for (const boss of EPIC_BOSSES) {
      expect(epicBossById(boss.id)).toBe(boss);
      expect(new EpicBossManager(boss, () => 1_000).activate("run").bossId).toBe(boss.id);
      expect(epicBossHp(boss, boss.maxLevel)).toBeGreaterThan(0);
    }
  });
  it("uses the pair-compressed 10-rung HP curve", () => {
    // Each rung is two authored ones added together: 1x+1.4x, 2.2x+3.6x, … 88x+107x.
    // Dr. Groundhog is the BOTTOM of the baseHp ramp at 1500 (0.75x the source's 2000),
    // so its rungs are the curve's shape at three quarters the scale.
    expect(DR_GROUNDHOG.baseHp).toBe(1_500);
    expect(epicBossHp(DR_GROUNDHOG, 1)).toBe(3_600);
    expect(epicBossHp(DR_GROUNDHOG, 2)).toBe(8_700);
    expect(epicBossHp(DR_GROUNDHOG, 10)).toBe(292_500);
  });

  it("ramps baseHp across the unlock ladder, ±25% about the middle pair", () => {
    // The ladder used to be flat, which made the ENTRY event the grindiest one — every
    // event cost the same total damage, but the army fighting the first is the weakest.
    // Ordered by unlock level, not by the catalog's own order.
    const byUnlock = ["dr-groundhog", "bully-frog", "rocky-rhino", "general-larvaelus",
                      "mystical-mamba", "foul-owl", "skunkarella", "loco-locust"]
      .map((id) => epicBossById(id)!);
    expect(byUnlock.every(Boolean)).toBe(true);
    // Monotone, and the two middle events hold ZF2's own BaseHP — they are the fixed
    // point the ±25% is stated against, so a drift there moves every other event's meaning.
    for (let i = 1; i < byUnlock.length; i++) {
      expect(byUnlock[i].baseHp, byUnlock[i].id).toBeGreaterThanOrEqual(byUnlock[i - 1].baseHp);
    }
    expect(byUnlock[3].baseHp).toBe(2_000);
    expect(byUnlock[4].baseHp).toBe(2_000);
    expect(byUnlock[0].baseHp / 2_000).toBeCloseTo(0.75, 5);
    expect(byUnlock[7].baseHp / 2_000).toBeCloseTo(1.25, 5);
  });

  it("retains damage and permits an immediate resource-gated retry", () => {
    let now = 1_000;
    const manager = new EpicBossManager(DR_GROUNDHOG, () => now);
    let run = manager.activate("run");
    const gate = manager.start(run, ["z1"]);
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    run = manager.finish(gate.run, 600, false).run;
    expect(run.currentHp).toBe(3_000);
    expect(manager.start(run, ["z1"]).ok).toBe(true);
    now = gate.run.encounterStartedAt + DR_GROUNDHOG.encounterMs;
    expect(manager.normalize(run)?.currentHp).toBe(3_600);
  });

  it("advances immediately through the top rung and completes", () => {
    let now = 1_000;
    const manager = new EpicBossManager(DR_GROUNDHOG, () => now);
    let run = manager.activate("run");
    for (let level = 1; level <= DR_GROUNDHOG.maxLevel; level++) {
      const gate = manager.start(run, ["z1"]);
      expect(gate.ok).toBe(true);
      if (!gate.ok) return;
      const result = manager.finish(gate.run, gate.run.currentHp, true);
      expect(result.defeatedLevel).toBe(level);
      run = result.run;
      now++;
    }
    expect(run.completedAt).toBeGreaterThan(0);
    expect(manager.isActive(run)).toBe(false);
  });

  it("expires after fourteen real-world days", () => {
    let now = 1_000;
    const manager = new EpicBossManager(DR_GROUNDHOG, () => now);
    const run = manager.activate("run");
    now = run.expiresAt;
    expect(manager.start(run, [])).toEqual({ ok: false, error: "expired" });
  });

  it("can end an active event early without completing it", () => {
    let now = 1_000;
    const manager = new EpicBossManager(DR_GROUNDHOG, () => now);
    const run = manager.activate("run");
    now += 5_000;
    const ended = manager.end(run)!;
    expect(ended.expiresAt).toBe(now);
    expect(ended.completedAt).toBe(0);
    expect(manager.isActive(ended)).toBe(false);
    expect(manager.end(ended)).toBeNull();
  });

  it("clears hoarded tokens when the event ends", () => {
    const manager = new EpicBossManager(DR_GROUNDHOG, () => 1_000);
    const active = { ...manager.activate("run"), tokenCount: 4 };
    expect(manager.end(active)?.tokenCount).toBe(0);
  });
});

describe("runs saved above the ladder (rung-count cuts)", () => {
  const boss = epicBossById("loco-locust")!;

  it("pulls an in-flight run down to the last rung, at the same HP", () => {
    const manager = new EpicBossManager(boss, () => 1_000);
    // A run mid-flight at level 25 when the ladder was cut beneath it — first from 40
    // rungs to 20, now from 20 to 10. Either way it lands on the current top rung.
    // Built at the rung's own full HP so "at the same HP" is a real claim: the run is
    // undamaged before the clamp and must still be undamaged after it.
    const top = epicBossHp(boss, 25);
    const stale = { ...manager.activate("run"), level: 25, maxHp: top, currentHp: top };
    const run = manager.normalize(stale)!;
    expect(run.level).toBe(boss.maxLevel);
    // epicBossHp clamps its own index, so an off-the-end level reads as the top rung.
    expect(run.maxHp).toBe(epicBossHp(boss, 25));
    expect(run.currentHp).toBe(run.maxHp);
  });

  it("keeps the damage already dealt to the boss it is part-way through", () => {
    const manager = new EpicBossManager(boss, () => 1_000);
    const stale = { ...manager.activate("run"), level: 33, maxHp: 214_000, currentHp: 90_000 };
    expect(manager.normalize(stale)?.currentHp).toBe(90_000);
  });

  it("lets that run's next win claim the top prize instead of ending unrewarded", () => {
    const manager = new EpicBossManager(boss, () => 1_000);
    const stale = { ...manager.activate("run"), level: 25, maxHp: 214_000, currentHp: 214_000 };
    const gate = manager.start(stale, ["z1"]);
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const result = manager.finish(gate.run, gate.run.currentHp, true);
    // The current top rung is what the retuned top-prize quest listens for — an unclamped
    // run would have reported 25 here, completed, and never granted Vagabond Zombie.
    expect(result.defeatedLevel).toBe(boss.maxLevel);
    expect(result.completed).toBe(true);
  });

  it("leaves a completed run's recorded level alone", () => {
    const manager = new EpicBossManager(boss, () => 1_000);
    const done = { ...manager.activate("run"), level: 40, completedAt: 900 };
    expect(manager.normalize(done)?.level).toBe(40);
  });
});
