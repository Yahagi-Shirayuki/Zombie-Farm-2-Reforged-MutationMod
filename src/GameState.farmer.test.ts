import { describe, expect, it } from "vitest";
import { GameState } from "./GameState";
import type { FarmerCatalog } from "./assets";

// Ids matter: 12 (Paper Bag, +10% harvest gold) and 2 (Skeleton, +10% zombie life)
// carry bonuses in the shared HEAD_EFFECTS table; 1 and 15 are cosmetics.
const catalog: FarmerCatalog = {
  heads: [
    { id: 1, name: "Free", part: "free.png", bodyId: 0, sort: 1 },
    { id: 2, name: "Paid", part: "paid.png", bodyId: 1, sort: 2, cost: 15, brains: true },
  ],
  bodies: [
    { id: 0, name: "Body A", body: "a.png", arm1: "a1", arm2: "a2" },
    { id: 1, name: "Body B", body: "b.png", arm1: "b1", arm2: "b2" },
  ],
};

describe("farmer wardrobe", () => {
  it("unlocks missing-price parts and permits independent owned equips", () => {
    const state = new GameState();
    state.seedFarmerCatalog(catalog);
    expect(state.ownedFarmerHeads).toEqual([1]);
    expect(state.ownedFarmerBodies).toEqual([0, 1]);
    expect(state.equipFarmerHead(2)).toBe(false);

    state.unlockFarmerHead(2, 1);
    expect(state.equipFarmerHead(2)).toBe(true);
    expect(state.equipFarmerBody(0)).toBe(true);
    expect([state.farmerHeadId, state.farmerBodyId]).toEqual([2, 0]);
  });
});

describe("separate worn and bonus head slots", () => {
  /** A player owning the Paper Bag (+10% harvest gold) and a cosmetic Jester Mask. */
  const dressed = () => {
    const state = new GameState();
    state.seedFarmerCatalog(catalog);
    state.unlockFarmerHead(12, 0);
    state.unlockFarmerHead(15, 0);
    return state;
  };

  it("keeps a pre-split save's bonus by following the worn head", () => {
    const state = dressed();
    state.equipFarmerHead(12);
    expect(state.farmerBonusHeadId).toBeNull();
    expect(state.bonusHeadId()).toBe(12);
    expect(state.farmerHarvestGold(100)).toBe(110);
  });

  it("keeps the bonus alive while a cosmetic head is worn", () => {
    const state = dressed();
    expect(state.equipFarmerBonusHead(12)).toBe(true);
    expect(state.equipFarmerHead(15)).toBe(true);
    expect(state.farmerHeadId).toBe(15); // wearing the cosmetic
    expect(state.farmerHarvestGold(100)).toBe(110); // still earning the bonus
  });

  it("un-pinning hands the bonus back to whatever is worn", () => {
    const state = dressed();
    state.equipFarmerBonusHead(12);
    state.equipFarmerHead(15);
    expect(state.equipFarmerBonusHead(null)).toBe(true);
    expect(state.bonusHeadId()).toBe(15);
    expect(state.farmerHarvestGold(100)).toBe(100);
  });

  it("refuses to pin an unowned head or a cosmetic one", () => {
    const state = dressed();
    expect(state.equipFarmerBonusHead(2)).toBe(false); // has a bonus, but not owned
    expect(state.equipFarmerBonusHead(15)).toBe(false); // owned, but no bonus to give
    expect(state.farmerBonusHeadId).toBeNull();
  });

  it("only reports a bonus slot worth showing once one is owned", () => {
    const bare = new GameState();
    bare.seedFarmerCatalog(catalog);
    expect(bare.hasBonusHead()).toBe(false);
    expect(dressed().hasBonusHead()).toBe(true);
  });

  it("drops a pin the server no longer says is owned", () => {
    const state = dressed();
    state.equipFarmerBonusHead(12);
    state.syncFarmerOwnership([1, 15], catalog, 15, 12);
    expect(state.farmerBonusHeadId).toBeNull();
  });

  it("leaves the pin alone when a pre-split server reports no bonus slot", () => {
    const state = dressed();
    state.equipFarmerBonusHead(12);
    state.syncFarmerOwnership([1, 12, 15], catalog, 15);
    expect(state.farmerBonusHeadId).toBe(12);
  });
});
