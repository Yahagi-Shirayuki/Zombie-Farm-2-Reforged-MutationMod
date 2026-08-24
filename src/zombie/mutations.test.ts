import { describe, it, expect } from "vitest";
import {
  addMutationRef, applyBodyTypeRestriction, bitGrowable, canReceive, canReceiveRef, combineMasks, HEADLESS_FORBIDDEN_MASK,
  HEADLESS_HEAD_MASK, mutationBonus, mutationLabel, SLOTS, SLOT_MASK,
  ALL_MUTATIONS_MASK, bitOf, combineMutationSets, MODDED_MUTATIONS, mutationOf, MUTATION_LIST,
  resolveMutationBit, resolveMutationRef, sanitizeMutationMask, slotOfRef, statEffectsOf, type MutationStats,
} from "./mutations";
import {
  bitValue, maskHas, maskIntersect, maskUnion, maskWithout, MAX_MASK_BITS,
} from "./mutationMask";

// Mutations are named, never numbered: bitOf resolves a key to the bit it persists as,
// so these read as the rules they encode rather than as arithmetic. The bit VALUES
// still matter to one rule — a same-slot conflict keeps the higher one — and the
// catalog's append-only order is what makes "higher bit" mean "higher tier".
const TOMATO = bitOf("tomato"), POTATO = bitOf("potato");
const GARLIC = bitOf("garlic"), PUMPKING = bitOf("pumpking");
const CARROT = bitOf("carrot"), BROCCOLI = bitOf("broccoli");
const TURNIP = bitOf("turnip"), DRAGON = bitOf("dragon"), LIMABEAN = bitOf("limabean");

// Ground truth: combineZombieMutationFlag:withZombieFlag: / randMutation: — per slot,
// non-conflicting bits carry over; a same-slot conflict keeps the HIGHER bit value
// (higher-tier mutation), DETERMINISTICALLY (no RNG). One mutation per slot.

describe("combineMasks — deterministic per-slot inheritance", () => {
  it("carries a mutation from either parent when the other slot is empty", () => {
    expect(combineMasks(TOMATO, 0)).toBe(TOMATO); // only A (head)
    expect(combineMasks(0, TURNIP)).toBe(TURNIP); // only B (arm)
  });

  it("unions mutations that occupy different slots", () => {
    // tomato is a head, turnip an arm — independent slots
    expect(combineMasks(TOMATO, TURNIP)).toBe(maskUnion(TOMATO, TURNIP));
  });

  it("resolves a same-slot conflict to the higher bit (higher tier wins)", () => {
    // head slot: tomato vs garlic -> garlic, the later (higher-tier) catalog entry
    expect(combineMasks(TOMATO, GARLIC)).toBe(GARLIC);
    expect(combineMasks(GARLIC, TOMATO)).toBe(GARLIC); // order-independent
  });

  it("keeps at most one mutation per slot in the child", () => {
    const child = combineMasks(TOMATO, POTATO); // both head
    expect(maskIntersect(child, SLOT_MASK.head)).toBe(POTATO); // the higher one, only
    // exactly one head bit set
    const headBits = maskIntersect(SLOT_MASK.head, child);
    expect(headBits & (headBits - 1)).toBe(0);
  });

  it("is commutative across every slot", () => {
    const a = 1 | 8 | 1024; // head + arm + body
    const b = 256 | 4 | 2048; // head + hair_eye + neck
    expect(combineMasks(a, b)).toBe(combineMasks(b, a));
  });
});

describe("headless restriction — no head or hair/eye mutations", () => {
  it("covers every head and hair/eye bit except the headless family's own Pumpking", () => {
    expect(HEADLESS_FORBIDDEN_MASK)
      .toBe(maskWithout(maskUnion(SLOT_MASK.head, SLOT_MASK.hair_eye), HEADLESS_HEAD_MASK));
  });

  it("drops the eye mutations a headless zombie cannot wear", () => {
    // carrot/eyebiscus (4) and broccoli (128) are hair_eye; turnip (8) is an arm.
    expect(applyBodyTypeRestriction(CARROT | TURNIP | BROCCOLI, true)).toBe(TURNIP);
    expect(applyBodyTypeRestriction(CARROT | TURNIP | BROCCOLI, false)).toBe(CARROT | TURNIP | BROCCOLI);
    expect(canReceive(0, CARROT, true)).toBe(false); // never accepted in the first place
    expect(canReceive(0, TURNIP, true)).toBe(true);
  });
});

describe("Pumpking — grown only on the headless family, worn by anyone", () => {

  it("pays the head slot's best attack bonus", () => {
    expect(mutationBonus(PUMPKING)).toEqual({ str: 3, con: 2, dex: 0, wis: 1 });
    // The claim in the name: no other head pays more attack, which is what makes the
    // capstone crop worth growing over the Garlichead it evicts in the Pot.
    expect(mutationBonus(PUMPKING).str).toBeGreaterThan(mutationBonus(GARLIC).str);
    expect(mutationLabel(PUMPKING)).toBe("Pumpking");
  });

  it("GROWS on a headless zombie and on nothing else", () => {
    // The crop-adjacency gate. A zombie with a head of its own never grows one,
    // however many pumpkings are planted around it.
    expect(bitGrowable(PUMPKING, true)).toBe(true);
    expect(bitGrowable(PUMPKING, false)).toBe(false);
    // Every other mutation grows exactly where it can be worn.
    expect(bitGrowable(GARLIC, false)).toBe(true); // garlic on a normal zombie
    expect(bitGrowable(GARLIC, true)).toBe(false); // ...never on a headless one
    expect(bitGrowable(TURNIP, true)).toBe(true); // turnip arm: fine on both
  });

  it("is WEARABLE by anyone, so an inherited one is never scrubbed off", () => {
    expect(canReceive(0, PUMPKING, true)).toBe(true);
    expect(canReceive(0, PUMPKING, false)).toBe(true);
    expect(applyBodyTypeRestriction(PUMPKING | TURNIP, true)).toBe(PUMPKING | TURNIP);
    expect(applyBodyTypeRestriction(PUMPKING | TURNIP, false)).toBe(PUMPKING | TURNIP);
  });

  it("still obeys one-per-slot against the other head mutations", () => {
    expect(canReceive(PUMPKING, GARLIC, true)).toBe(false); // garlic (head) blocked
    expect(canReceive(GARLIC, PUMPKING, false)).toBe(false); // head slot already taken
    expect(canReceive(PUMPKING, PUMPKING, true)).toBe(true); // already has it: no-op
  });

  it("reaches a non-headless child through the Pot, winning the head slot", () => {
    // Garlic and Pumpking both sit in the head slot, and the higher bit
    // wins — so a headless parent hands its pumpkin to a child of any body type.
    // This is the ONLY route: it cannot be grown on a zombie that has a head.
    expect(combineMasks(GARLIC, PUMPKING, false)).toBe(PUMPKING);
    expect(combineMasks(PUMPKING, GARLIC, false)).toBe(PUMPKING); // order-independent
    expect(combineMasks(GARLIC, PUMPKING, true)).toBe(PUMPKING); // headless child too
    expect(combineMasks(PUMPKING, TURNIP, false)).toBe(PUMPKING | TURNIP); // arm rides along
  });
});

// The Market's guaranteed-mutation line moved to zombie/statDisplay, because the
// number it shows has to be normalized — see marketMutationText.test.ts.

// ---------------------------------------------------------------------------
// The catalog itself: bits are persisted values, so the shape of the table that
// produces them is as much a contract as the combine rules above.
// ---------------------------------------------------------------------------

describe("mutation catalog", () => {
  // The one place bit VALUES are written out. Everywhere else names a mutation and
  // lets bitOf resolve it; here the encoding itself is the thing under test, because
  // it is what every save, every roster_v3 row and every Black Market order holds.
  const SHIPPED_ORDER = [
    "tomato", "onion", "carrot", "turnip", "potato", "coffee", "celery",
    "broccoli", "garlic", "cauli", "limabean", "flytrap", "dragon", "pumpking",
    "eyebiscus", "heartichoke",
  ];

  it("assigns every shipped mutation the bit it has always had", () => {
    // A row inserted, removed or reordered in CATALOG shifts every bit below it and
    // would silently re-label every mutated zombie in every save. mutations.ts throws
    // at load if that happens; this spells out what it is protecting — the ORDER,
    // and the fact that position N still means bit 2^N.
    expect(MUTATION_LIST.slice(0, SHIPPED_ORDER.length).map((def) => def.key))
      .toEqual(SHIPPED_ORDER);
    SHIPPED_ORDER.forEach((key, index) => {
      expect(bitOf(key), `mutation "${key}"`).toBe(2 ** index);
      expect(mutationOf(bitOf(key))?.key).toBe(key); // and back again
    });
    expect(bitOf("tomato")).toBe(1);
    expect(bitOf("pumpking")).toBe(8192);
    expect(bitOf("heartichoke")).toBe(32768); // the newest row, appended past pumpking
    expect(ALL_MUTATIONS_MASK).toBe(65535);
  });

  it("keeps one mutation per slot resolvable from either its key or its bit", () => {
    expect(resolveMutationBit("pumpking")).toBe(bitOf("pumpking"));
    expect(resolveMutationBit(bitOf("pumpking"))).toBe(bitOf("pumpking"));
    expect(slotOfRef("celery")).toBe("arm");
    expect(slotOfRef(bitOf("celery"))).toBe("arm");
    // A key the catalog does not have is not a mutation, however it is spelled.
    expect(() => bitOf("cornhead")).toThrow(/unknown vanilla mutation/);
  });

  it("exposes a sixth back-arm slot for paired arm mutations", () => {
    expect(SLOTS).toEqual(["head", "hair_eye", "arm", "armB", "body", "neck"]);
    expect(SLOT_MASK.armB).toBe(0);
  });

  it("keeps local modded mutations as string ids instead of bit slots", () => {
    expect(MODDED_MUTATIONS.corn_head.slot).toBe("head");
    expect(resolveMutationBit("corn_head")).toBeNull();
    expect(resolveMutationRef("corn_head")).toBe("corn_head");
    expect(slotOfRef("corn_head")).toBe("head");
    expect(resolveMutationBit("corn_arm")).toBeNull();
    expect(resolveMutationBit("corn_arm_b")).toBeNull();
    expect(resolveMutationRef("corn_arm")).toBe("corn_arm");
    expect(resolveMutationRef("corn_arm_b")).toBe("corn_arm_b");
    expect(resolveMutationRef("turnip_b")).toBe("turnip_b");
    expect(MODDED_MUTATIONS.turnip_b).toMatchObject({
      key: "turnip_b",
      name: "Turnip-Arm (secondary)",
      slot: "armB",
      stats: mutationOf(bitOf("turnip"))?.stats,
    });
    expect(MODDED_MUTATIONS.corn_arm_b).toMatchObject({
      key: "corn_arm_b",
      name: "Corned Arm (secondary)",
      slot: "armB",
      stats: MODDED_MUTATIONS.corn_arm.stats,
    });
    expect(mutationBonus(0, ["corn_head"])).toEqual({ str: 1, con: 2, dex: 0, wis: 1 });
    expect(mutationLabel(0, ["corn_head"])).toBe("Corned head");
    expect(mutationLabel(0, ["corn_arm_b"])).toBe("Corned Arm (secondary)");
    expect(combineMutationSets(TOMATO, [], 0, ["corn_head"]).ids).toEqual(["corn_head"]);
  });

  it("prevents vanilla and modded mutations from sharing the same slot", () => {
    expect(canReceiveRef(0, ["corn_head"], TOMATO)).toBe(false);
    expect(addMutationRef({ mask: 0, ids: ["corn_head"] }, TOMATO))
      .toEqual({ mask: 0, ids: ["corn_head"] });

    expect(canReceiveRef(TOMATO, [], "corn_head")).toBe(false);
    expect(addMutationRef({ mask: TOMATO, ids: [] }, "corn_head"))
      .toEqual({ mask: TOMATO, ids: [] });

    expect(addMutationRef({ mask: CARROT, ids: ["corn_head"] }, TURNIP))
      .toEqual({ mask: CARROT | TURNIP, ids: ["corn_head"] });
  });
  it("resolves an unknown name to nothing rather than to a neighbouring bit", () => {
    // A typo in cropMutations.ts or in a data file must cost that entry its mutation,
    // never land it on someone else's.
    expect(resolveMutationBit("cornhead_typo")).toBeNull();
    expect(resolveMutationBit(2 ** 40)).toBeNull(); // real bit, no mutation on it
    expect(resolveMutationBit(3)).toBeNull(); // two bits at once is not one mutation
    expect(slotOfRef("cornhead_typo")).toBeNull();
  });

  it("drops unknown bits from an untrusted mask instead of clamping it", () => {
    // This replaced `Math.min(0xffff, mask)` on the server. A clamp turned an
    // out-of-range value into 0xffff — a mask of arbitrary OTHER mutations — where
    // intersecting against the catalog yields only what the catalog actually knows.
    expect(sanitizeMutationMask(TOMATO | TURNIP)).toBe(TOMATO | TURNIP);
    expect(sanitizeMutationMask(0xffff)).toBe(ALL_MUTATIONS_MASK);
    expect(sanitizeMutationMask(2 ** 40 + CARROT)).toBe(CARROT);
    expect(sanitizeMutationMask(2 ** 40)).toBe(0);
    expect(sanitizeMutationMask(-1)).toBe(0);
    expect(sanitizeMutationMask(1.5)).toBe(0);
    expect(sanitizeMutationMask("8" as unknown)).toBe(0);
  });

  it("has room to grow, and the room is the one mutationMask.ts advertises", () => {
    expect(MUTATION_LIST.length).toBeLessThan(MAX_MASK_BITS);
    // The next mutation appended to CATALOG lands here, and everything downstream —
    // slots, bonuses, combine — is bit-agnostic, so no other file has to learn it.
    const nextBit = bitValue(MUTATION_LIST.length);
    expect(nextBit).toBe(65536);
    expect(maskHas(ALL_MUTATIONS_MASK, nextBit)).toBe(false);
    expect(sanitizeMutationMask(nextBit)).toBe(0); // unknown until it is catalogued
  });
});

describe("mutation stats", () => {
  // A mutation names any mix of str/dex/con, and a negative is a real penalty. These
  // work from explicit specs because that is what statEffectsOf consumes from the
  // catalog.
  const spec = (stats: MutationStats) => ({ stats });

  it("lists only the stats a mutation actually moves, in str/dex/con order", () => {
    expect(statEffectsOf(spec({ con: 8, dex: -2 }))).toEqual([
      { stat: "dex", amount: -2 },
      { stat: "con", amount: 8 },
    ]);
    // Declaration order in the literal must not leak into the display order, or two
    // mutations with the same effects would render differently.
    expect(statEffectsOf(spec({ dex: -2, con: 8 })))
      .toEqual(statEffectsOf(spec({ con: 8, dex: -2 })));
    expect(statEffectsOf(spec({ str: 3 }))).toEqual([{ stat: "str", amount: 3 }]);
  });

  it("treats an absent stat and an explicit zero as untouched", () => {
    // The card lists one row per effect, so a declared 0 must not produce a "+0 Speed"
    // row for a mutation that has nothing to do with speed.
    expect(statEffectsOf(spec({ str: 1, dex: 0 }))).toEqual([{ stat: "str", amount: 1 }]);
    expect(statEffectsOf(spec({}))).toEqual([]);
  });

  it("sums the shipped catalog's bonuses across slots and stats", () => {
    expect(mutationBonus(0)).toEqual({ str: 0, con: 0, dex: 0, wis: 0 });
    expect(mutationBonus(DRAGON)).toEqual({ str: 4, con: 0, dex: 1, wis: 1 }); // dragon arm
    // garlic head + carrot eyes + lima bean body: one bit per slot, all three counted.
    expect(mutationBonus(GARLIC | CARROT | LIMABEAN)).toEqual({ str: 3, con: 5, dex: 1, wis: 1 });
    // tomato and dragon land on the same stats and add up.
    expect(mutationBonus(TOMATO | DRAGON)).toEqual({ str: 5, con: 1, dex: 1, wis: 1 });
  });

  it("keeps every shipped mutation effect non-zero", () => {
    for (const def of MUTATION_LIST) {
      const effects = statEffectsOf(def);
      expect(effects.length, `${def.key} affects no stat`).toBeGreaterThan(0);
      for (const e of effects) {
        expect(e.amount, `${def.key} ${e.stat}`).not.toBe(0);
      }
    }
  });
});
