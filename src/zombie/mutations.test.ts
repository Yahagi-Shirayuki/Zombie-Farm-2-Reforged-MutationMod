import { describe, it, expect } from "vitest";
import {
  applyBodyTypeRestriction, canReceive, combineMasks, HEADLESS_FORBIDDEN_MASK,
  HEADLESS_ONLY_MASK, mutationBonus, mutationLabel, SLOT_MASK,
} from "./mutations";

// Ground truth: combineZombieMutationFlag:withZombieFlag: / randMutation: — per slot,
// non-conflicting bits carry over; a same-slot conflict keeps the HIGHER bit value
// (higher-tier mutation), DETERMINISTICALLY (no RNG). One mutation per slot.

describe("combineMasks — deterministic per-slot inheritance", () => {
  it("carries a mutation from either parent when the other slot is empty", () => {
    expect(combineMasks(1, 0)).toBe(1); // only A (head)
    expect(combineMasks(0, 8)).toBe(8); // only B (arm)
  });

  it("unions mutations that occupy different slots", () => {
    // 1 = head (tomato), 8 = arm (turnip) — independent slots
    expect(combineMasks(1, 8)).toBe(9);
  });

  it("resolves a same-slot conflict to the higher bit (higher tier wins)", () => {
    // head slot: 1 (tomato) vs 256 (garlic) -> garlic
    expect(combineMasks(1, 256)).toBe(256);
    expect(combineMasks(256, 1)).toBe(256); // order-independent
  });

  it("keeps at most one mutation per slot in the child", () => {
    const child = combineMasks(1, 16); // both head (tomato vs potato)
    expect(child & SLOT_MASK.head).toBe(16); // the higher one, only
    // exactly one head bit set
    const headBits = SLOT_MASK.head & child;
    expect(headBits & (headBits - 1)).toBe(0);
  });

  it("is commutative across every slot", () => {
    const a = 1 | 8 | 1024; // head + arm + body
    const b = 256 | 4 | 2048; // head + hair_eye + neck
    expect(combineMasks(a, b)).toBe(combineMasks(b, a));
  });
});

describe("headless restriction — no head or hair/eye mutations", () => {
  it("covers every head and hair/eye bit except headless-only Pumpking", () => {
    expect(HEADLESS_FORBIDDEN_MASK)
      .toBe((SLOT_MASK.head | SLOT_MASK.hair_eye) & ~HEADLESS_ONLY_MASK);
    // Pinned: server/migrations/0035_headless_mutation_repair.sql clears this literal.
    expect(HEADLESS_FORBIDDEN_MASK).toBe(951);
  });

  it("drops the eye mutations a headless zombie cannot wear", () => {
    // carrot/eyebiscus (4) and broccoli (128) are hair_eye; turnip (8) is an arm.
    expect(applyBodyTypeRestriction(4 | 8 | 128, true)).toBe(8);
    expect(applyBodyTypeRestriction(4 | 8 | 128, false)).toBe(4 | 8 | 128);
    expect(canReceive(0, 4, true)).toBe(false); // never accepted in the first place
    expect(canReceive(0, 8, true)).toBe(true);
  });
});

describe("Pumpking — the headless-only head mutation", () => {
  const PUMPKING = HEADLESS_ONLY_MASK;

  it("pays the head slot's best attack bonus", () => {
    expect(mutationBonus(PUMPKING)).toEqual({ str: 3, con: 0, dex: 0 });
    expect(mutationLabel(PUMPKING)).toBe("Pumpking");
  });

  it("lands on a headless zombie and nowhere else", () => {
    expect(canReceive(0, PUMPKING, true)).toBe(true);
    expect(canReceive(0, PUMPKING, false)).toBe(false);
    expect(applyBodyTypeRestriction(PUMPKING | 8, true)).toBe(PUMPKING | 8);
    expect(applyBodyTypeRestriction(PUMPKING | 8, false)).toBe(8);
  });

  it("still obeys one-per-slot against the other head mutations", () => {
    // A headless zombie can't hold them anyway, but a mask that somehow has one
    // must not gain a second head mutation.
    expect(canReceive(PUMPKING, 256, true)).toBe(false); // garlic (head) blocked
    expect(canReceive(256, PUMPKING, false)).toBe(false);
    expect(canReceive(PUMPKING, PUMPKING, true)).toBe(true); // already has it: no-op
  });

  it("does not cost a non-headless child its own head mutation in the Pot", () => {
    // Garlic (256) vs Pumpking (8192) both sit in the head slot. The higher bit
    // normally wins, but a non-headless child can't wear Pumpking — garlic survives.
    expect(combineMasks(256, PUMPKING, false)).toBe(256);
    expect(combineMasks(256, PUMPKING, true)).toBe(PUMPKING); // headless child keeps it
    expect(combineMasks(PUMPKING, 8, false)).toBe(8);
  });
});

// The Market's guaranteed-mutation line moved to zombie/statDisplay, because the
// number it shows has to be normalized — see marketMutationText.test.ts.
