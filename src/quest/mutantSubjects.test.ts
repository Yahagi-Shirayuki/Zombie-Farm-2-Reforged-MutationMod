import { describe, expect, it } from "vitest";
import zombieRows from "../../public/assets/zombies.json";
import questDefs from "../../public/assets/quests.json";
import {
  combineSubject, combineSubjectAliases, mutantSubjectIndex, unitQuestSubjects,
  unitSubjectAliases,
} from "./mutantSubjects";
import { questSubjectMatches } from "./matching";

const index = mutantSubjectIndex(zombieRows as { name: string; mutation?: number }[]);

const REGULAR = "Zombie";
const TOMATO_BIT = 1;
const CARROT_BIT = 4;
const CAULI_BIT = 512;
const EYEBISCUS_BIT = 16384;
const HEARTICHOKE_BIT = 32768;

/** Quest 55 "Mutation Nation" — harvest a Tomato + a Carrot Zombie. */
const QUEST_55 = (questDefs as Record<string, { requirements: { notificationObject: string }[] }>)["55"];
/** Quest 56 "It's Alive!" — combine a Tomato and a Carrot mutant. */
const QUEST_56 = (questDefs as Record<string, { requirements: { notificationObject: string }[] }>)["56"];

describe("mutantSubjectIndex", () => {
  it("maps each mutation bit to the Market mutant that carries it", () => {
    expect(index.get(TOMATO_BIT)).toEqual(["Tomato Zombie"]);
    expect(index.get(CARROT_BIT)).toContain("Carrot Zombie");
  });

  it("gives the Tier-4 mutants their own entry, not a share of a lower tier's", () => {
    // They used to: Eyebiscus rode Carrot's bit 4 and Heartichoke Cauliflower's 512,
    // so each of those bits named two species. Both are catalogued mutations now.
    expect(index.get(CARROT_BIT)).toEqual(["Carrot Zombie"]);
    expect(index.get(CAULI_BIT)).toEqual(["Cauliflower Zombie"]);
    expect(index.get(EYEBISCUS_BIT)).toEqual(["Eyebiscus Zombie"]);
    expect(index.get(HEARTICHOKE_BIT)).toEqual(["Heartichoke Zombie"]);
  });

  it("still maps one bit to every species carrying it", () => {
    // The many-names-per-bit path is what makes a field-grown mutant answer to the
    // Market species' name. Nothing shipped shares a bit now, so it is covered here.
    const shared = mutantSubjectIndex([
      { name: "Carrot Zombie", mutation: CARROT_BIT },
      { name: "Baby Carrot Zombie", mutation: CARROT_BIT },
    ]);
    expect(shared.get(CARROT_BIT)).toEqual(["Carrot Zombie", "Baby Carrot Zombie"]);
  });

  it("ignores unmutated species so they never become an alias", () => {
    expect([...index.values()].flat()).not.toContain(REGULAR);
  });
});

describe("unit quest subjects", () => {
  it("leaves an unmutated zombie with no aliases", () => {
    expect(unitSubjectAliases(REGULAR, 0, index)).toEqual([]);
  });

  it("makes a field-mutated Regular Zombie count as the Market mutant", () => {
    const requirement = QUEST_55.requirements[0].notificationObject; // "Tomato Zombie"
    const aliases = unitSubjectAliases(REGULAR, TOMATO_BIT, index);
    expect(questSubjectMatches(requirement, REGULAR)).toBe(false); // the reported bug
    expect(questSubjectMatches(requirement, REGULAR, aliases)).toBe(true);
  });

  it("still matches the species requirements it always did", () => {
    const aliases = unitSubjectAliases(REGULAR, TOMATO_BIT, index);
    expect(questSubjectMatches("Zombie", REGULAR, aliases)).toBe(true);
    expect(questSubjectMatches("", REGULAR, aliases)).toBe(true); // the "any zombie" wildcard
    expect(questSubjectMatches("Girl Zombie", REGULAR, aliases)).toBe(false);
  });

  it("does not duplicate the name of a bought mutant", () => {
    expect(unitQuestSubjects("Carrot Zombie", CARROT_BIT, index)).toEqual(["Carrot Zombie"]);
  });
});

describe("combine subjects", () => {
  const requirement = QUEST_56.requirements[0].notificationObject; // "Carrot Zombie Tomato Zombie"

  it("matches two bought mutants, as it did before", () => {
    const a = unitQuestSubjects("Tomato Zombie", TOMATO_BIT, index);
    const b = unitQuestSubjects("Carrot Zombie", CARROT_BIT, index);
    expect(questSubjectMatches(requirement, combineSubject(a[0], b[0]), combineSubjectAliases(a, b)))
      .toBe(true);
  });

  it("matches two field-mutated Regular Zombies", () => {
    const a = unitQuestSubjects(REGULAR, TOMATO_BIT, index);
    const b = unitQuestSubjects(REGULAR, CARROT_BIT, index);
    const subject = combineSubject(a[0], b[0]);
    expect(subject).toBe("Zombie Zombie");
    expect(questSubjectMatches(requirement, subject)).toBe(false); // the reported bug
    expect(questSubjectMatches(requirement, subject, combineSubjectAliases(a, b))).toBe(true);
  });

  it("matches one bought and one field-mutated parent", () => {
    const a = unitQuestSubjects("Tomato Zombie", TOMATO_BIT, index);
    const b = unitQuestSubjects(REGULAR, CARROT_BIT, index);
    expect(questSubjectMatches(requirement, combineSubject(a[0], b[0]), combineSubjectAliases(a, b)))
      .toBe(true);
  });

  it("does not match an unrelated mutation pair", () => {
    const a = unitQuestSubjects(REGULAR, TOMATO_BIT, index);
    const b = unitQuestSubjects(REGULAR, CAULI_BIT, index);
    expect(questSubjectMatches(requirement, combineSubject(a[0], b[0]), combineSubjectAliases(a, b)))
      .toBe(false);
  });

  it("never repeats the primary subject in the alias list", () => {
    const a = unitQuestSubjects(REGULAR, 0, index);
    const b = unitQuestSubjects(REGULAR, 0, index);
    expect(combineSubjectAliases(a, b)).toEqual([]);
  });
});
