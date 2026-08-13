// The Market's guaranteed-mutation line must be in DISPLAYED stat units, not the raw
// 1–4 points the mutation table stores. Every stat tile normalizes against a fixed
// reference (traits.STAT_DISPLAY_MAX) and the three references differ a lot, so raw
// points both understated the bonus and misranked mutations against each other.
//
// Also covers the reported "wrong text displayed, also for Heartichoke (lvl 44)":
// the two Tier-4 mutants reuse a lower tier's mutation bit, so the old text named the
// wrong mutation ("Cauli-hair" on a Heartichoke Zombie).
import { describe, expect, it } from "vitest";
import zombieRows from "../../public/assets/zombies.json";
import { makeOwned } from "./types";
import { displayStat } from "./traits";
import { mutationDisplayGains, mutationMarketDescription } from "./statDisplay";
import { statBreakdown } from "./statDisplay";
import type { ZombieDef } from "../assets";

const rows = zombieRows as unknown as ZombieDef[];
const row = (key: string) => rows.find((z) => z.key === key)!;
const mutants = rows.filter((z) => z.category === "mutant");

describe("mutation gains are reported in displayed units", () => {
  it("scales Carrot's single dex point to the +23 Speed the card shows", () => {
    const carrot = row("ZombieActorRegularTier1Carrots");
    expect(carrot.mutation).toBe(4);
    expect(mutationDisplayGains(carrot, carrot.mutation!)).toEqual([
      { stat: "dex", label: "Speed", delta: 23 },
    ]);
  });

  it("scales each stat by its own reference, so equal raw points differ on screen", () => {
    // One raw point of dex, str and con are +23 Speed, +4 Damage and +3 Life.
    const base = { str: 2, dex: 2, con: 2 };
    expect(mutationDisplayGains(base, 4)[0].delta).toBe(23); // carrot, +1 dex
    expect(mutationDisplayGains(base, 1)[0].delta).toBe(4); //  tomato, +1 str
    expect(mutationDisplayGains(base, 2)[0].delta).toBe(3); //  onion,  +1 con
  });

  it("reports no gain for an unmutated species", () => {
    const plain = row("ZombieActorRegularTier1");
    expect(mutationDisplayGains(plain, 0)).toEqual([]);
    expect(mutationMarketDescription(plain, 0)).toBeUndefined();
  });

  it("normalizes a multi-stat mask once per stat", () => {
    const base = { str: 2, dex: 2, con: 2 };
    // Turnip (+2 str) + Lima Bean (+3 con) occupy different slots and stats.
    expect(mutationDisplayGains(base, 8 | 1024)).toEqual([
      { stat: "str", label: "Damage", delta: 8 },
      { stat: "con", label: "Life", delta: 10 },
    ]);
  });
});

describe("every Market mutant's promise matches what its card will read", () => {
  it.each(mutants.map((z) => [z.name, z.key] as const))(
    "%s advertises the gain its grown unit actually shows",
    (_name, key) => {
      const def = row(key);
      const gains = mutationDisplayGains(def, def.mutation!);
      expect(gains.length).toBeGreaterThan(0);

      // Grow the unit for real, then read the stat card's own "Mutation" line.
      const owned = makeOwned("z1", def, 0, 0);
      for (const gain of gains) {
        const line = statBreakdown(owned, gain.stat, () => false).lines
          .find((l) => l.label === "Mutation")!;
        expect(line.amount).toBe(`+${gain.delta}`);
      }
    }
  );

  it("never quotes a raw 1-4 point value for a speed mutation", () => {
    // The regression: Carrot/Coffee/Eyebiscus used to read "+1 speed" / "+2 speed".
    for (const def of mutants) {
      const speed = mutationDisplayGains(def, def.mutation!).find((g) => g.stat === "dex");
      if (speed) expect(speed.delta).toBeGreaterThan(4);
    }
  });
});

describe("the Tier-4 mutants carry a Tier-4 mutation", () => {
  // Both used to ride a LOWER tier's bit — Heartichoke Cauliflower's 512, Eyebiscus
  // Carrot's 4 — which made the game's two priciest, slowest mutation crops pay the
  // Tier-1 bonus, and made the Market line name the wrong mutation ("Cauli-hair" on a
  // Heartichoke Zombie). Each owns its mutation now, and each beats the one it rode.
  const gainOf = (base: { str: number; dex: number; con: number }, mask: number, stat: string) =>
    mutationDisplayGains(base, mask).find((g) => g.stat === stat)?.delta ?? 0;

  it("pays Heartichoke more Life than the Lima Bean it shares the body slot with", () => {
    const heartichoke = row("ZombieActorRegularTier4Heartichoke");
    // Unlock level is deliberately not asserted here; it moves with the mutant ladder
    // and is owned by quest/cropUnlockAlignment.test.ts.
    expect(heartichoke.mutation).toBe(32768);

    const base = { str: 5, dex: 2, con: 5 }; // Lima Bean Zombie's own stats
    expect(gainOf(base, 32768, "con")).toBeGreaterThan(gainOf(base, 1024, "con"));
    const text = mutationMarketDescription(heartichoke, heartichoke.mutation!)!;
    expect(text).toContain("Life");
    expect(text).not.toContain("Cauli-hair"); // the reported wrong text
    expect(text).not.toContain("+5 life"); // the raw-unit value
  });

  it("pays Eyebiscus double a Carrot's Speed, and Damage on top", () => {
    const eyebiscus = row("ZombieActorRegularTier4Eyebiscus");
    expect(eyebiscus.mutation).toBe(16384);
    const text = mutationMarketDescription(eyebiscus, eyebiscus.mutation!)!;
    expect(text).toContain("Speed");
    expect(text).toContain("Damage"); // what Carrot-eyed hasn't got at all
    expect(text).not.toContain("Carrot-eyed");

    const base = { str: 2, dex: 2, con: 2 }; // Carrot Zombie's own stats
    // +2 dex against Carrot-eyed's +1, and +1 str against its nothing. Measured
    // rather than written out, so it survives a change to the display reference.
    expect(gainOf(base, 16384, "dex")).toBe(2 * gainOf(base, 4, "dex"));
    expect(gainOf(base, 16384, "str")).toBeGreaterThan(gainOf(base, 4, "str"));
    // ...and it out-speeds Coffeehead's +2 dex without giving up the head slot.
    expect(gainOf(base, 16384, "dex")).toBe(gainOf(base, 32, "dex"));
  });

  it("gives two species the same displayed gain for the same mask", () => {
    // Normalization is linear, so a gain is a property of the mutation, not of the
    // species carrying it — even though their base stats differ sharply.
    const cauli = row("ZombieActorRegularTier2Cauliflower");
    const heartichoke = row("ZombieActorRegularTier4Heartichoke");
    expect(heartichoke.con).toBeGreaterThan(cauli.con);
    expect(mutationDisplayGains(cauli, 512)).toEqual(mutationDisplayGains(heartichoke, 512));
  });
});

describe("displayStat reference", () => {
  it("is what makes one dex point worth so much more than one str point", () => {
    // Guards the constants the whole feature rests on (STAT_DISPLAY_MAX).
    expect(displayStat("dex", 1) - displayStat("dex", 0)).toBe(23);
    expect(displayStat("str", 1) - displayStat("str", 0)).toBe(4);
    expect(displayStat("con", 1) - displayStat("con", 0)).toBe(3);
  });
});
