import { describe, expect, it } from "vitest";
import { specialHeadFxKind } from "./specialHeadFx";

describe("special head effects", () => {
  it("puts the red-core aura on Kindlehead", () => {
    expect(specialHeadFxKind("ZombieActorHeadlessTier2")).toBe("kindle");
  });

  it("puts the blue-core aura on Flamehead", () => {
    expect(specialHeadFxKind("ZombieActorHeadlessTier3")).toBe("flame");
  });

  it("puts confetti on Party Zombie", () => {
    expect(specialHeadFxKind("ZombieActorHeadlessTier4")).toBe("confetti");
  });

  it("does not decorate other headless tiers", () => {
    expect(specialHeadFxKind("ZombieActorHeadlessTier1")).toBeNull();
  });

  it("yields the head slot to a Pumpking mutation", () => {
    // The pumpkin IS the head now, so the flame it replaces must not burn through it.
    expect(specialHeadFxKind("ZombieActorHeadlessTier3", 8192)).toBeNull();
    expect(specialHeadFxKind("ZombieActorHeadlessTier4", 8192)).toBeNull();
    // An arm/body mutation leaves the effect alone.
    expect(specialHeadFxKind("ZombieActorHeadlessTier3", 8 | 1024)).toBe("flame");
  });
});
