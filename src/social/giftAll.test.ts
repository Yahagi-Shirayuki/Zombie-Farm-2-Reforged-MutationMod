import { describe, it, expect } from "vitest";
import { planGiftAll } from "./giftAll";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i + 1}`);

describe("planGiftAll — what one 'Gift all' press costs", () => {
  it("gives the first two sends of the day away free", () => {
    const plan = planGiftAll({ eligibleIds: ids(2), sentToday: 0, gold: 0 });
    expect(plan).toMatchObject({
      targets: ["f1", "f2"], freeCount: 2, paidCount: 0, goldCost: 0, skippedForGold: 0,
    });
  });

  it("charges 100 gold each once the free allowance runs out", () => {
    const plan = planGiftAll({ eligibleIds: ids(5), sentToday: 0, gold: 10_000 });
    expect(plan).toMatchObject({ freeCount: 2, paidCount: 3, goldCost: 300 });
    expect(plan.targets).toHaveLength(5);
  });

  it("counts the free allowance against the DAY, not against this batch", () => {
    // Both freebies were already spent on earlier one-off gifts: everything here pays.
    const plan = planGiftAll({ eligibleIds: ids(3), sentToday: 2, gold: 10_000 });
    expect(plan).toMatchObject({ freeCount: 0, paidCount: 3, goldCost: 300 });
  });

  it("has NO ceiling on gifts per day — reach is limited only by gold", () => {
    const plan = planGiftAll({ eligibleIds: ids(40), sentToday: 0, gold: 10_000 });
    expect(plan.targets).toHaveLength(40);
    expect(plan).toMatchObject({ freeCount: 2, paidCount: 38, goldCost: 3800, skippedForGold: 0 });
  });

  it("keeps going past the old ten-a-day limit when the player can pay", () => {
    const plan = planGiftAll({ eligibleIds: ids(9), sentToday: 6, gold: 10_000 });
    expect(plan.targets).toHaveLength(9); // every eligible friend, not 10 minus 6
    expect(plan).toMatchObject({ freeCount: 0, paidCount: 9, goldCost: 900, skippedForGold: 0 });
  });

  it("trims to what the player can actually afford", () => {
    const plan = planGiftAll({ eligibleIds: ids(6), sentToday: 0, gold: 250 });
    // 2 free + 2 paid (200 gold); the 50 gold left over buys nobody.
    expect(plan).toMatchObject({ freeCount: 2, paidCount: 2, goldCost: 200, skippedForGold: 2 });
    expect(plan.targets).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("still sends the free gifts when the player is flat broke", () => {
    const plan = planGiftAll({ eligibleIds: ids(4), sentToday: 0, gold: 0 });
    expect(plan).toMatchObject({ freeCount: 2, paidCount: 0, goldCost: 0, skippedForGold: 2 });
  });

  it("counts the unaffordable remainder when one free send is left", () => {
    const plan = planGiftAll({ eligibleIds: ids(15), sentToday: 1, gold: 300 });
    // 1 free left + 3 affordable = 4 sent; the other 11 need gold there isn't.
    expect(plan.targets).toHaveLength(4);
    expect(plan).toMatchObject({ freeCount: 1, paidCount: 3, goldCost: 300, skippedForGold: 11 });
  });

  it("plans nothing when every friend was already gifted today", () => {
    const plan = planGiftAll({ eligibleIds: [], sentToday: 3, gold: 10_000 });
    expect(plan).toMatchObject({
      targets: [], freeCount: 0, paidCount: 0, goldCost: 0, skippedForGold: 0,
    });
  });

  it("still plans a full batch for a sender who has already sent many today", () => {
    const plan = planGiftAll({ eligibleIds: ids(4), sentToday: 40, gold: 10_000 });
    expect(plan.targets).toHaveLength(4);
    expect(plan).toMatchObject({ freeCount: 0, paidCount: 4, goldCost: 400, skippedForGold: 0 });
  });

  it("ignores nonsense inputs rather than planning negative sends", () => {
    const plan = planGiftAll({ eligibleIds: ids(3), sentToday: -5, gold: -100 });
    expect(plan).toMatchObject({ freeCount: 2, paidCount: 0, goldCost: 0 });
    expect(plan.targets).toEqual(["f1", "f2"]);
  });
});
