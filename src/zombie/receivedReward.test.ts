import { describe, expect, it } from "vitest";
import { encodeReceivedZombie, parseReceivedZombie } from "./receivedReward";

describe("Received zombie rewards", () => {
  it("round-trips a unique awarded unit", () => {
    const reward = { id: "raid:unit/1", key: "ZombieActorRegularTier1", mutation: 5, invasions: 2 };
    expect(parseReceivedZombie(encodeReceivedZombie(reward))).toEqual(reward);
  });

  it("does not treat ordinary Received items or malformed markers as zombies", () => {
    expect(parseReceivedZombie("Windmill")).toBeNull();
    expect(parseReceivedZombie("zombie-reward:bad:key:-1:0")).toBeNull();
  });
});
