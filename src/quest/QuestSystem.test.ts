import { describe, expect, it, vi } from "vitest";
import { GameState } from "../GameState";
import { QuestBus, QuestEvent } from "./events";
import { QuestSystem } from "./QuestSystem";
import { QuestDef, RewardType } from "./types";

const quest = (): QuestDef => ({
  id: "1",
  title: "Fresh Dirt",
  messageComplete: "Done",
  tip: "Plow twice",
  sprite: "quest.png",
  levelRequired: -1,
  prerequisiteQuest: -1,
  requirements: [{
    notificationID: QuestEvent.SoilPlowed,
    notificationObject: "",
    countTotal: 2,
    text: "Plow 2 plots",
    type: 2,
    sprite: "soil.png",
  }],
  rewardType: RewardType.Xp,
  rewardValue: 10,
  rewardItem: "",
  rewardItemKey: "",
  tutorialQuest: false,
  epicEvent: false,
  seasonal: false,
  seasonalDate: "",
  removeQuest: false,
  ignoreCheckQuest: false,
});

describe("QuestSystem client-paced progress", () => {
  it("displays optimistic progress without making it durable", () => {
    const bus = new QuestBus();
    const grantReward = vi.fn();
    const system = new QuestSystem(new Map([["1", quest()]]), new GameState(), bus, {
      authoritative: true,
      grantReward,
      grantItem: vi.fn(), grantZombie: vi.fn(), completed: vi.fn(), render: vi.fn(),
    });
    system.restore();
    expect(system.views()[0].reward).toEqual({
      icon: "topbar_level_icon.png",
      label: "+10 XP",
    });
    bus.post(QuestEvent.SoilPlowed);
    expect(system.views()[0].objectives[0].count).toBe(1);
    expect(system.serialize().active[0].counts[0]).toBe(0);
    expect(grantReward).not.toHaveBeenCalled();
    system.applyAuthoritativeChanges([{ questId: "1", counts: [1], completed: false }]);
    expect(system.views()[0].objectives[0].count).toBe(1);
  });

  it("catches the rail up when the server counted more than this client posted", () => {
    // Reported from the field: "I put in two giant lollipops and it shows I still
    // need to buy one more." The rail draws the optimistic preview in preference to
    // the confirmed counts, and nothing cleared that preview — so a server count the
    // client had not posted locally stayed hidden for the rest of the session.
    const bus = new QuestBus();
    const system = new QuestSystem(new Map([["1", quest()]]), new GameState(), bus, {
      authoritative: true,
      grantReward: vi.fn(), grantItem: vi.fn(), grantZombie: vi.fn(),
      completed: vi.fn(), render: vi.fn(),
    });
    system.restore();

    bus.post(QuestEvent.SoilPlowed); // optimistic preview := 1
    expect(system.views()[0].objectives[0].count).toBe(1);

    system.applyAuthoritativeChanges([{ questId: "1", counts: [2], completed: false }]);
    expect(system.views()[0].objectives[0].count).toBe(2);
  });

  it("still shows an unconfirmed local event that runs ahead of the server", () => {
    const bus = new QuestBus();
    const system = new QuestSystem(new Map([["1", quest()]]), new GameState(), bus, {
      authoritative: true,
      grantReward: vi.fn(), grantItem: vi.fn(), grantZombie: vi.fn(),
      completed: vi.fn(), render: vi.fn(),
    });
    system.restore();

    bus.post(QuestEvent.SoilPlowed);
    bus.post(QuestEvent.SoilPlowed); // preview := 2, server has only seen the first
    system.applyAuthoritativeChanges([{ questId: "1", counts: [1], completed: false }]);
    expect(system.views()[0].objectives[0].count).toBe(2); // no flicker backwards
  });

  it("requests prompt server confirmation when local events predict completion", () => {
    const bus = new QuestBus();
    const requestAuthoritativeCompletionCheck = vi.fn();
    const completed = vi.fn();
    const system = new QuestSystem(new Map([["1", quest()]]), new GameState(), bus, {
      authoritative: true,
      requestAuthoritativeCompletionCheck,
      grantItem: vi.fn(), grantZombie: vi.fn(), completed, render: vi.fn(),
    });
    system.restoreAuthoritative({ completed: [], progress: [{ questId: "1", counts: [0] }] });

    bus.post(QuestEvent.SoilPlowed);
    expect(requestAuthoritativeCompletionCheck).not.toHaveBeenCalled();
    expect(system.views()[0].objectives[0].count).toBe(1);

    bus.post(QuestEvent.SoilPlowed);
    bus.post(QuestEvent.SoilPlowed);
    expect(requestAuthoritativeCompletionCheck).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(system.views()[0].objectives[0].count).toBe(2);
    expect(system.completedCount).toBe(0);

    system.applyAuthoritativeChanges([{ questId: "1", counts: [2], completed: true }]);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(system.completedCount).toBe(1);
  });

  it("rolls optimistic progress back to the authoritative projection", () => {
    const bus = new QuestBus();
    const system = new QuestSystem(new Map([["1", quest()]]), new GameState(), bus, {
      authoritative: true,
      grantItem: vi.fn(), grantZombie: vi.fn(), completed: vi.fn(), render: vi.fn(),
    });
    system.restoreAuthoritative({ completed: [], progress: [{ questId: "1", counts: [0] }] });

    bus.post(QuestEvent.SoilPlowed);
    expect(system.views()[0].objectives[0].count).toBe(1);

    system.restoreAuthoritative({ completed: [], progress: [{ questId: "1", counts: [0] }] });
    expect(system.views()[0].objectives[0].count).toBe(0);
  });

  it("updates immediately and submits completion once", () => {
    const bus = new QuestBus();
    const grantReward = vi.fn(() => true);
    const completed = vi.fn();
    const system = new QuestSystem(new Map([["1", quest()]]), new GameState(), bus, {
      authoritative: false,
      grantReward,
      grantItem: vi.fn(),
      grantZombie: vi.fn(),
      completed,
      render: vi.fn(),
    });
    system.restore();

    bus.post(QuestEvent.SoilPlowed);
    expect(system.views()[0].objectives[0].count).toBe(1);
    bus.post(QuestEvent.SoilPlowed);
    bus.post(QuestEvent.SoilPlowed);

    expect(grantReward).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(system.completedCount).toBe(1);
  });

  it("does not let an older server projection roll local progress backward", () => {
    const bus = new QuestBus();
    const system = new QuestSystem(new Map([["1", quest()]]), new GameState(), bus, {
      authoritative: false,
      grantItem: vi.fn(),
      grantZombie: vi.fn(),
      completed: vi.fn(),
      render: vi.fn(),
    });
    system.restore();
    bus.post(QuestEvent.SoilPlowed);

    system.restoreAuthoritative({ completed: [], progress: [] });

    expect(system.views()[0].objectives[0].count).toBe(1);
  });

  it("closes out a restored quest whose requirement is already satisfied", () => {
    // Reported from the field: "One of the quests is completed, but still showing up"
    // — Master Combiner sitting in the quest log at "Collect 15 zombies from the
    // Zombie Pot (15/15) ✓", forever, reward never paid. Its countTotal was lowered
    // from 50 to 15, so a save carrying 15+ collections restores already finished.
    // Completion used to be tested only when an event ADVANCED a counter, and a
    // capped requirement can never advance again — so nothing ever re-checked it.
    const bus = new QuestBus();
    const state = new GameState();
    const completed = vi.fn();
    const system = new QuestSystem(new Map([["1", quest()]]), state, bus, {
      authoritative: false,
      grantItem: vi.fn(), grantZombie: vi.fn(), completed, render: vi.fn(),
    });

    // countTotal is 2; the save was written when the requirement still asked for more.
    system.restore({ active: [{ id: "1", counts: [7] }], completed: [] });

    expect(system.views()).toEqual([]);
    expect(system.completedCount).toBe(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(state.xp).toBe(10); // the reward it was owed, paid once
  });

  it("leaves a satisfied quest to the server when the server owns completion", () => {
    // The mirror of the case above: online the Worker re-checks every eligible quest
    // on each command batch, so it heals itself. Completing here would pay a reward
    // the server never granted (and bounce off the spend-only economy endpoint).
    const bus = new QuestBus();
    const grantReward = vi.fn(() => true);
    const completed = vi.fn();
    const system = new QuestSystem(new Map([["1", quest()]]), new GameState(), bus, {
      authoritative: true,
      grantReward, grantItem: vi.fn(), grantZombie: vi.fn(), completed, render: vi.fn(),
    });

    system.restoreAuthoritative({ completed: [], progress: [{ questId: "1", counts: [2] }] });

    expect(system.completedCount).toBe(0);
    expect(grantReward).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();

    system.applyAuthoritativeChanges([{ questId: "1", counts: [2], completed: true }]);
    expect(system.completedCount).toBe(1);
  });

  it("unlocks a successor when a satisfied quest is closed out on restore", () => {
    const bus = new QuestBus();
    const second = { ...quest(), id: "2", prerequisiteQuest: 1 };
    const system = new QuestSystem(
      new Map([["1", quest()], ["2", second]]), new GameState(), bus, {
        authoritative: false,
        grantItem: vi.fn(), grantZombie: vi.fn(), completed: vi.fn(), render: vi.fn(),
      });

    system.restore({ active: [{ id: "1", counts: [2] }], completed: [] });

    expect(system.views().map((v) => v.id)).toEqual(["2"]);
  });

  it("hides inactive Epic quests without discarding lifetime progress", () => {
    const bus = new QuestBus();
    const epic = { ...quest(), id: "1000", epicEvent: true, requirements: [{
      ...quest().requirements[0], notificationID: QuestEvent.EpicStageEnemyDefeated,
      notificationObject: "5",
    }] };
    const system = new QuestSystem(new Map([[epic.id, epic]]), new GameState(), bus, {
      grantItem: vi.fn(), grantZombie: vi.fn(), completed: vi.fn(), render: vi.fn(),
    });
    system.setEpicBossActive(true);
    bus.post(QuestEvent.EpicStageEnemyDefeated, "5");
    const save = system.serialize();
    expect(save.active[0].counts[0]).toBe(1);
    system.setEpicBossActive(false);
    expect(system.views()).toEqual([]);

    const restored = new QuestSystem(new Map([[epic.id, epic]]), new GameState(), new QuestBus(), {
      grantItem: vi.fn(), grantZombie: vi.fn(), completed: vi.fn(), render: vi.fn(),
    });
    restored.restore(save);
    expect(restored.views()).toEqual([]);
    restored.setEpicBossActive(true);
    expect(restored.views()[0].objectives[0].count).toBe(1);
  });

  it("only surfaces and advances quests for the selected Epic Boss", () => {
    const bus = new QuestBus();
    const groundhog = { ...quest(), id: "1000", epicEvent: true, requirements: [{
      ...quest().requirements[0], notificationID: QuestEvent.EpicStageEnemyDefeated,
      notificationObject: "5",
    }] };
    const locust = { ...groundhog, id: "2000", title: "Loco Locust" };
    const system = new QuestSystem(new Map([[groundhog.id, groundhog], [locust.id, locust]]), new GameState(), bus, {
      grantItem: vi.fn(), grantZombie: vi.fn(), completed: vi.fn(), render: vi.fn(),
    });
    system.restore({ active: [{ id: "1000", counts: [0] }, { id: "2000", counts: [0] }], completed: [] });
    system.setEpicBossActive(true, ["2000"]);
    expect(system.views().map((view) => view.id)).toEqual(["2000"]);
    bus.post(QuestEvent.EpicStageEnemyDefeated, "5");
    const saved = system.serialize();
    expect(saved.active.find((active) => active.id === "1000")?.counts).toEqual([0]);
  });

  it("re-offers a finished Epic quest on the next run of that boss", () => {
    const bus = new QuestBus();
    const epic = { ...quest(), id: "1000", epicEvent: true, rewardType: RewardType.Zombie,
      rewardItemKey: "ZombieActorDrZombie", requirements: [{
        ...quest().requirements[0], notificationID: QuestEvent.EpicStageEnemyDefeated,
        notificationObject: "5", countTotal: 1,
      }] };
    const grantZombie = vi.fn();
    const system = new QuestSystem(new Map([[epic.id, epic]]), new GameState(), bus, {
      grantItem: vi.fn(), grantZombie, completed: vi.fn(), render: vi.fn(),
    });
    system.setEpicBossActive(true, ["1000"]);
    bus.post(QuestEvent.EpicStageEnemyDefeated, "5");
    expect(grantZombie).toHaveBeenCalledTimes(1);
    expect(system.views()).toEqual([]);
    expect(system.serialize().completed).toEqual(["1000"]);

    // A second activation of the same boss.
    system.reopenEpicQuests(["1000"]);
    expect(system.serialize().completed).toEqual([]);
    // Back on the rail at ZERO — carrying the old count over would re-complete it on
    // the first win of the new run, whatever level that win was on.
    expect(system.views()[0].objectives[0]).toMatchObject({ count: 0, done: false });
    bus.post(QuestEvent.EpicStageEnemyDefeated, "5");
    expect(grantZombie).toHaveBeenCalledTimes(2);
  });

  it("leaves an unfinished Epic quest's lifetime progress alone when a run reopens", () => {
    const bus = new QuestBus();
    const epic = { ...quest(), id: "1010", epicEvent: true, requirements: [{
      ...quest().requirements[0], notificationID: QuestEvent.EpicStageEnemyDefeated,
      notificationObject: "5", countTotal: 3,
    }] };
    const system = new QuestSystem(new Map([[epic.id, epic]]), new GameState(), bus, {
      grantItem: vi.fn(), grantZombie: vi.fn(), completed: vi.fn(), render: vi.fn(),
    });
    system.setEpicBossActive(true, ["1010"]);
    bus.post(QuestEvent.EpicStageEnemyDefeated, "5");
    system.reopenEpicQuests(["1010"]);
    expect(system.views()[0].objectives[0].count).toBe(1);
  });
});
