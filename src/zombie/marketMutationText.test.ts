// The Market's guaranteed-mutation line must be in DISPLAYED stat units, not the raw
// 1–4 points the mutation table stores. Every stat tile normalizes against a fixed
// reference (traits.STAT_DISPLAY_MAX) and the three references differ a lot, so raw
// points both understated the bonus and misranked mutations against each other.
//
// Also covers the reported "wrong text displayed, also for Heartichoke (lvl 44)":
// the two Tier-4 mutants reuse a lower tier's mutation bit, so the old text named the
// wrong mutation ("Cauli-hair" on a Heartichoke Zombie).
import { describe, expect, it } from "vitest";
import moddedZombieRows from "../../public/assets/modded_zombies.json";
import zombieRows from "../../public/assets/zombies.json";
import { makeOwned } from "./types";
import { displayStat } from "./traits";
import { mutationDisplayGains, mutationMarketDescription } from "./statDisplay";
import { statBreakdown } from "./statDisplay";
import { mergeModdedZombies, type ModdedZombieDef, type ZombieDef } from "../assets";

const rows = mergeModdedZombies(
  zombieRows as unknown as ZombieDef[],
  moddedZombieRows as unknown as ModdedZombieDef[],
);
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
      { stat: "str", label: "Damage", delta: 12 },
      { stat: "con", label: "Life", delta: 10 },
    ]);
  });
});

describe("every Market mutant's promise matches what its card will read", () => {
  it.each(mutants.map((z) => [z.name, z.key] as const))(
    "%s advertises the gain its grown unit actually shows",
    (_name, key) => {
      const def = row(key);
      const gains = mutationDisplayGains(def, def.mutation ?? 0, def.mutationIds);
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
      const speed = mutationDisplayGains(def, def.mutation ?? 0, def.mutationIds).find((g) => g.stat === "dex");
      if (speed) expect(speed.delta).toBeGreaterThan(4);
    }
  });

  it("supports modded string-id market mutants", () => {
    const bread = row("ZombieActorRegularTier1Bread");
    expect(bread.mutation).toBe(0);
    expect(bread.mutationIds).toEqual(["bread_neck"]);
    expect(mutationDisplayGains(bread, bread.mutation ?? 0, bread.mutationIds)).toEqual([
      { stat: "con", label: "Life", delta: 10 },
    ]);

    const owned = makeOwned("z1", bread, 0, 0);
    expect(owned.mutationIds).toEqual(["bread_neck"]);
    expect(owned.con).toBe(5);
  });
});

describe("Tier-4 mutants that reuse a lower tier's bit", () => {
  it("describes Heartichoke by its bonus, not as Cauliflower's mutation", () => {
    const heartichoke = row("ZombieActorRegularTier4Heartichoke");
    // Unlock level is deliberately not asserted here (see the Eyebiscus case
    // below); it moves with the mutant ladder and is owned by
    // quest/cropUnlockAlignment.test.ts. What matters here is the shared bit.
    expect(heartichoke.mutation).toBe(512); // shared with Cauliflower Zombie

    const text = mutationMarketDescription(heartichoke, heartichoke.mutation!)!;
    expect(text).toContain("+6 Life");
    expect(text).toContain("+13 Focus");
    expect(text).not.toContain("Cauli-hair"); // the reported wrong text
    expect(text).not.toContain("+3 life"); // the raw-unit value
  });

  it("describes Eyebiscus by its bonus, not as Carrot's mutation", () => {
    const eyebiscus = row("ZombieActorRegularTier4Eyebiscus");
    expect(eyebiscus.mutation).toBe(4); // shared with Carrot Zombie
    const text = mutationMarketDescription(eyebiscus, eyebiscus.mutation!)!;
    expect(text).toContain("+23 Speed");
    expect(text).not.toContain("Carrot-eyed");
  });

  it("gives a bit-sharing pair the same displayed gain, since the flag is the same", () => {
    // Normalization is linear, so the gain is a property of the mutation, not the
    // species carrying it — even though their base stats differ sharply.
    const cauli = row("ZombieActorRegularTier2Cauliflower");
    const heartichoke = row("ZombieActorRegularTier4Heartichoke");
    expect(heartichoke.con).toBeGreaterThan(cauli.con);
    expect(mutationDisplayGains(cauli, 512)).toEqual([
      { stat: "con", label: "Life", delta: 7 },
      { stat: "focus", label: "Focus", delta: 13 },
    ]);
    expect(mutationDisplayGains(heartichoke, 512)).toEqual([
      { stat: "con", label: "Life", delta: 6 },
      { stat: "focus", label: "Focus", delta: 13 },
    ]);
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
