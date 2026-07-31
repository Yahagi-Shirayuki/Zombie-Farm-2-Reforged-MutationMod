import { describe, expect, it } from "vitest";
import { purchaseXpFeedback } from "./purchaseFeedback";

describe("purchase XP feedback", () => {
  it("formats purchase XP for floating and modal feedback", () => {
    expect(purchaseXpFeedback(2_000)).toEqual({
      floating: "+2000xp",
      toast: "+2,000 XP",
    });
  });

  it("does not announce a purchase that grants no XP", () => {
    expect(purchaseXpFeedback(0)).toBeNull();
    expect(purchaseXpFeedback(-10)).toBeNull();
  });
});
