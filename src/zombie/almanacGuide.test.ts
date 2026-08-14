import { describe, expect, it } from "vitest";
import { almanacGuide, type AlmanacGuideFacts } from "./almanacGuide";
import { COMBINE_SPECIAL_BY_GROUP, COMBINE_SPECIAL_LEVEL } from "./combineSpecies";
import { ELITE_BRAIN_LUCK } from "../raid/eliteInvasion";
import { MAX_ZOMBIE_POTS } from "../placementLimit";

const FACTS: AlmanacGuideFacts = {
  brainTicket: { cost: 10000, level: 20 },
  epic: {
    count: 8, firstLevel: 24, lastLevel: 42, minBrains: 3, maxBrains: 5, rungs: 10, days: 14,
  },
  rareZombieRaids: ["Old McDonnell's Farm", "Summer Break", "Tree World"],
  speciesName: (key) => (key === "ZombieActorLargeTier5" ? "Zomviking" : `Name(${key})`),
};

const topicById = (id: string, facts: AlmanacGuideFacts = FACTS) => {
  const topic = almanacGuide(facts).find((entry) => entry.id === id);
  if (!topic) throw new Error(`no topic ${id}`);
  return topic;
};
const textOf = (id: string, facts: AlmanacGuideFacts = FACTS) =>
  topicById(id, facts).paragraphs.join(" ");

describe("almanacGuide", () => {
  it("returns the three field notes in Pot, Ticket, Epic order", () => {
    expect(almanacGuide(FACTS).map((topic) => topic.id)).toEqual(["pot", "ticket", "epic"]);
  });

  it("gives every topic a title, a chip blurb and a non-empty body", () => {
    for (const topic of almanacGuide(FACTS)) {
      expect(topic.title, topic.id).toBeTruthy();
      expect(topic.blurb, topic.id).toBeTruthy();
      expect(topic.paragraphs.length, topic.id).toBeGreaterThan(0);
      for (const paragraph of topic.paragraphs) expect(paragraph.trim(), topic.id).toBeTruthy();
    }
  });

  // The point of building this from the live constants: a balance change must not be
  // able to leave the guide quoting a number the game no longer uses.
  it("quotes the Pot's real timer, pot limit and promotion level", () => {
    const pot = textOf("pot");
    expect(pot).toContain("60 minutes");
    expect(pot).toContain("15 minutes");
    expect(pot).toContain(`${MAX_ZOMBIE_POTS} pots`);
    expect(pot).toContain(`level ${COMBINE_SPECIAL_LEVEL}`);
  });

  it("explains the two routes to a species the Market does not sell", () => {
    const pot = textOf("pot");
    expect(pot).toMatch(/two of the SAME species/i); // the colour ladder
    expect(pot).toContain("Blue Grave");
    expect(pot).toContain("Red Grave");
    expect(pot).toContain("25%"); // COMBINE_SPECIAL_CHANCE, the tier-5 roll
  });

  it("names every tier-5 Special the Pot can promote to", () => {
    const pot = textOf("pot", { ...FACTS, speciesName: () => "Zomviking" });
    expect(pot).toContain("Zomviking");
    // One clause per body type, so no promotion target is left unnamed.
    expect(pot.match(/Zomviking/g)?.length).toBe(Object.keys(COMBINE_SPECIAL_BY_GROUP).length);
  });

  it("states the Brain Ticket's price, its multiplier and its cost in difficulty", () => {
    const ticket = textOf("ticket");
    expect(ticket).toContain("10,000 gold");
    expect(ticket).toContain("level 20");
    expect(ticket).toContain(String(ELITE_BRAIN_LUCK));
    expect(ticket).toContain("ELITE");
  });

  it("names the invasions that actually have a rare zombie", () => {
    expect(textOf("ticket")).toContain("Old McDonnell's Farm, Summer Break and Tree World");
  });

  it("describes the Epic events as the Epic group's only source", () => {
    const epic = textOf("epic");
    expect(epic).toContain("8");
    expect(epic).toContain("level 24");
    expect(epic).toContain("3-5 brains");
    expect(epic).toContain("10 rungs");
    expect(epic).toContain("14 days");
    expect(epic).toContain("Boss Token");
    expect(epic).toContain("Received"); // where a prize goes when the farm is full
  });

  // The dry-streak floors in raid/brainDrops.ts and raid/zombieDrops.ts are meant to be
  // invisible: a guaranteed drop must read as a lucky one. The guide is the most likely
  // place for one to leak into the UI, so assert it never does.
  it("never mentions the invisible pity guarantees", () => {
    const all = almanacGuide(FACTS).flatMap((topic) => [topic.blurb, ...topic.paragraphs]).join(" ");
    expect(all).not.toMatch(/pity|guaranteed after|dry (streak|run|spell)|wins in a row/i);
  });

  it("drops the catalog sentences rather than printing blanks when facts are missing", () => {
    const bare = almanacGuide();
    const all = bare.flatMap((topic) => topic.paragraphs).join(" ");
    expect(all).not.toContain("undefined");
    expect(all).not.toContain("NaN");
    // The systems still explain themselves from constants alone.
    expect(bare.find((t) => t.id === "pot")!.paragraphs.join(" ")).toContain("Slot 1");
    expect(bare.find((t) => t.id === "epic")!.paragraphs.join(" ")).toContain("a few brains");
  });
});
