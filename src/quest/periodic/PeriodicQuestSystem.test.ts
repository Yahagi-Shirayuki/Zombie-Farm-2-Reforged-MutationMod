import { describe, expect, it, vi } from "vitest";
import { GameState } from "../../GameState";
import { QuestBus } from "../events";
import { PeriodicQuestSystem } from "./PeriodicQuestSystem";
import type { PeriodicScopeState } from "./types";

const completedDaily = (): PeriodicScopeState => ({
  period: 20_000,
  level: 10,
  quests: [{
    id: "daily_plow",
    template: "daily_plow",
    text: "Plow 5 plots",
    icon: "plow.png",
    notificationID: "kSoilPlowedNotification",
    notificationObject: "",
    countTotal: 5,
    xp: 30,
  }],
  counts: [5],
  claimed: [],
});

describe("PeriodicQuestSystem authoritative claims", () => {
  it("keeps a reward claimable when the command cannot be queued", () => {
    const submitClaim = vi.fn(() => false);
    const system = new PeriodicQuestSystem(new GameState(), () => "account", new QuestBus(), {
      authoritative: true,
      submitClaim,
      render: () => {},
    });
    system.adoptAuthoritative({ daily: completedDaily(), weekly: null });

    system.claim("daily", "daily_plow");

    expect(submitClaim).toHaveBeenCalledOnce();
    expect(system.views()[0].quests[0].claimed).toBe(false);
    expect(system.claimable).toBe(1);
  });

  it("latches an accepted claim against double taps until projection", () => {
    const submitClaim = vi.fn(() => true);
    const system = new PeriodicQuestSystem(new GameState(), () => "account", new QuestBus(), {
      authoritative: true,
      submitClaim,
      render: () => {},
    });
    system.adoptAuthoritative({ daily: completedDaily(), weekly: null });

    system.claim("daily", "daily_plow");
    system.claim("daily", "daily_plow");

    expect(submitClaim).toHaveBeenCalledOnce();
    expect(system.views()[0].quests[0].claimed).toBe(true);
  });
});
