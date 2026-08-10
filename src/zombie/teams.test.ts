import { describe, expect, it } from "vitest";
import {
  assembleReport, MAX_TEAMS, nextTeamId, normalizeTeamName, planTeamAssembly, sanitizeTeams,
  settleTeamMembers, shortfallNotice, type TeamAssembleResult, type TeamRosterUnit,
} from "./teams";

const farm = (ids: string[], crypt: string[] = []): TeamRosterUnit[] => [
  ...ids.map((id) => ({ id, stored: false })),
  ...crypt.map((id) => ({ id, stored: true })),
];

describe("normalizeTeamName", () => {
  it("trims, collapses whitespace and strips control characters", () => {
    expect(normalizeTeamName("  Garden \n Crew  ")).toBe("Garden Crew");
    expect(normalizeTeamName("RaidSquad")).toBe("RaidSquad");
  });

  it("rejects empty and non-string names", () => {
    expect(normalizeTeamName("   ")).toBeNull();
    expect(normalizeTeamName(undefined)).toBeNull();
  });

  it("caps the length", () => {
    expect(normalizeTeamName("x".repeat(80))).toHaveLength(24);
  });
});

describe("sanitizeTeams", () => {
  it("keeps well-formed teams and drops malformed ones", () => {
    expect(sanitizeTeams([
      { id: "t1", name: "Garden", members: ["z1", "z2"] },
      { id: "t2", name: "   ", members: [] },        // no usable name
      { id: "!!", name: "Bad id", members: [] },     // id is not addressable
      { id: "t1", name: "Duplicate", members: [] },  // id already used
      "nope",
    ])).toEqual([{ id: "t1", name: "Garden", members: ["z1", "z2"] }]);
  });

  it("drops non-id members and de-duplicates the rest", () => {
    expect(sanitizeTeams([{ id: "t1", name: "A", members: ["z1", "z1", 7, "bad id", "z2"] }]))
      .toEqual([{ id: "t1", name: "A", members: ["z1", "z2"] }]);
  });

  it("bounds the team count", () => {
    const many = Array.from({ length: MAX_TEAMS + 5 }, (_, i) => ({ id: `t${i + 1}`, name: `T${i}`, members: [] }));
    expect(sanitizeTeams(many)).toHaveLength(MAX_TEAMS);
  });

  it("reads a missing or hostile blob as no teams", () => {
    expect(sanitizeTeams(undefined)).toEqual([]);
    expect(sanitizeTeams({ id: "t1" })).toEqual([]);
  });
});

describe("nextTeamId", () => {
  it("fills the first free slot", () => {
    expect(nextTeamId([])).toBe("t1");
    expect(nextTeamId([{ id: "t1", name: "A", members: [] }, { id: "t3", name: "B", members: [] }])).toBe("t2");
  });
});

describe("settleTeamMembers", () => {
  it("rewrites optimistic ids and de-duplicates a collision", () => {
    const teams = [{ id: "t1", name: "A", members: ["local1", "z2", "z2b"] }];
    const settled = settleTeamMembers(teams, (id) => (id === "local1" ? "z9" : id === "z2b" ? "z2" : id));
    expect(settled[0].members).toEqual(["z9", "z2"]);
  });

  it("returns the same object when nothing moved", () => {
    const teams = [{ id: "t1", name: "A", members: ["z1"] }];
    expect(settleTeamMembers(teams, (id) => id)[0]).toBe(teams[0]);
  });
});

describe("planTeamAssembly", () => {
  it("stores non-members and deploys the team", () => {
    const plan = planTeamAssembly(["z3", "z4"], farm(["z1", "z2"], ["z3", "z4"]), 16, 15);
    expect(plan.store).toEqual(["z1", "z2"]);
    expect(plan.deploy).toEqual(["z3", "z4"]);
    expect(plan.missing).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  it("leaves members that are already on the farm alone", () => {
    const plan = planTeamAssembly(["z1", "z3"], farm(["z1", "z2"], ["z3"]), 16, 15);
    expect(plan.present).toEqual(["z1"]);
    expect(plan.store).toEqual(["z2"]);
    expect(plan.deploy).toEqual(["z3"]);
  });

  it("assembles what is left of a team whose members are gone", () => {
    const plan = planTeamAssembly(["gone", "z3", "alsogone"], farm(["z1"], ["z3"]), 16, 15);
    expect(plan.missing).toEqual(["gone", "alsogone"]);
    expect(plan.deploy).toEqual(["z3"]);
    expect(plan.store).toEqual(["z1"]);
  });

  it("ignores a duplicated member id", () => {
    const plan = planTeamAssembly(["z2", "z2"], farm([], ["z2"]), 16, 15);
    expect(plan.deploy).toEqual(["z2"]);
  });

  it("deploys in team order, and only as far as the army cap allows", () => {
    const plan = planTeamAssembly(["z3", "z2", "z1"], farm([], ["z1", "z2", "z3"]), 2, 15);
    expect(plan.deploy).toEqual(["z3", "z2"]);
    expect(plan.blocked).toEqual(["z1"]);
  });

  it("interleaves when the Mausoleum is full: a deploy frees the slot the store needs", () => {
    // Army cap 2, both slots held by non-members; the crypt holds exactly one
    // member and has no free slot. Nothing can be stored until z3 comes out.
    const plan = planTeamAssembly(["z3"], farm(["z1", "z2"], ["z3"]), 2, 1);
    expect(plan.deploy).toEqual([]);
    expect(plan.store).toEqual([]);
    expect(plan.blocked).toEqual(["z3"]);

    // One free army slot changes everything: z3 deploys, freeing the crypt slot
    // that then takes z1 and (after that) z2.
    const roomy = planTeamAssembly(["z3"], farm(["z1"], ["z3"]), 2, 1);
    expect(roomy.deploy).toEqual(["z3"]);
    expect(roomy.store).toEqual(["z1"]);
    expect(roomy.operations).toEqual([
      { type: "deploy", id: "z3" },
      { type: "store", id: "z1" },
    ]);
  });

  it("swaps a whole farm through a SINGLE free slot, both sides otherwise full", () => {
    // 3 out, 3 in, an army with no spare room and a crypt with exactly one slot:
    // store/deploy ping-pong through that one slot until the swap is complete.
    // This is the ordinary case for a player whose Mausoleum is nearly full.
    const plan = planTeamAssembly(["x", "y", "z"], farm(["a", "b", "c"], ["x", "y", "z"]), 3, 4);
    expect(plan.store).toEqual(["a", "b", "c"]);
    expect(plan.deploy).toEqual(["x", "y", "z"]);
    expect(plan.operations).toEqual([
      { type: "store", id: "a" }, { type: "deploy", id: "x" },
      { type: "store", id: "b" }, { type: "deploy", id: "y" },
      { type: "store", id: "c" }, { type: "deploy", id: "z" },
    ]);
    expect(plan.shortfall).toBe("none");
    expect(plan.blocked).toEqual([]);
    expect(plan.left).toEqual([]);
  });

  it("stores as many non-members as the Mausoleum can take and no more", () => {
    const plan = planTeamAssembly(["z1"], farm(["z1", "z2", "z3", "z4"]), 16, 2);
    expect(plan.store).toEqual(["z2", "z3"]);
    expect(plan.deploy).toEqual([]);
    // The team IS fielded — it just is not alone out there.
    expect(plan.left).toEqual(["z4"]);
    expect(plan.shortfall).toBe("mausoleum_full");
  });

  it("does nothing at all with no Mausoleum and a full farm", () => {
    const plan = planTeamAssembly(["z1"], farm(["z1", "z2"]), 2, 0);
    expect(plan.store).toEqual([]);
    expect(plan.deploy).toEqual([]);
    expect(plan.present).toEqual(["z1"]);
    expect(plan.left).toEqual(["z2"]);
    expect(plan.shortfall).toBe("no_mausoleum");
  });

  it("blames the ARMY CAP, not the Mausoleum, when the team itself is too big", () => {
    // Every non-member is already gone; the farm is full of the team, and the rest
    // of the team is still in the crypt. A bigger Mausoleum would not help.
    const plan = planTeamAssembly(["z1", "z2", "z3"], farm(["z1", "z2"], ["z3"]), 2, 15);
    expect(plan.blocked).toEqual(["z3"]);
    expect(plan.shortfall).toBe("army_cap");
  });

  it("blames the Mausoleum when a member is stuck behind an un-evictable stranger", () => {
    // Farm full (cap 2) with one member + one stranger, crypt full: the stranger
    // cannot leave, so the last member cannot arrive.
    const plan = planTeamAssembly(["z1", "z3"], farm(["z1", "other"], ["z3", "z4"]), 2, 2);
    expect(plan.deploy).toEqual([]);
    expect(plan.blocked).toEqual(["z3"]);
    expect(plan.left).toEqual(["other"]);
    expect(plan.shortfall).toBe("mausoleum_full");
  });

  it("reports no shortfall when the team is already exactly assembled", () => {
    const plan = planTeamAssembly(["z1", "z2"], farm(["z1", "z2"]), 16, 0);
    expect(plan.shortfall).toBe("none");
    expect(plan.store).toEqual([]);
    expect(plan.deploy).toEqual([]);
  });

  it("treats a Mausoleum overflowed by reward zombies as simply full", () => {
    // A protected Epic reward can push the crypt past its cap; the free-slot maths
    // must clamp at zero rather than going negative and planning phantom stores.
    const plan = planTeamAssembly(["z1"], farm(["z1", "z2"], ["a", "b", "c"]), 16, 2);
    expect(plan.store).toEqual([]);
    expect(plan.left).toEqual(["z2"]);
    expect(plan.shortfall).toBe("mausoleum_full");
  });

  it("treats an empty team as 'store the whole farm'", () => {
    const plan = planTeamAssembly([], farm(["z1", "z2"]), 16, 15);
    expect(plan.store).toEqual(["z1", "z2"]);
  });
});

describe("assembleReport / shortfallNotice", () => {
  const result = (over: Partial<TeamAssembleResult> = {}): TeamAssembleResult => ({
    deployed: 0, stored: 0, missing: 0, blocked: 0, left: 0, present: 0, shortfall: "none", ...over,
  });

  it("reports a clean swap", () => {
    expect(assembleReport("Garden Crew", result({ deployed: 4, stored: 3 })))
      .toBe("Garden Crew: 4 deployed, 3 sent to rest.");
  });

  it("says nothing moved rather than implying it worked", () => {
    expect(assembleReport("Raid Squad", result({ blocked: 2, shortfall: "mausoleum_full" })))
      .toBe("Raid Squad: nothing could be moved. 2 could not come out — your Mausoleum is full.");
  });

  it("names the army cap when the team is too big for the farm", () => {
    expect(assembleReport("Big Squad", result({ deployed: 2, present: 14, blocked: 4, shortfall: "army_cap" })))
      .toContain("your farm is full at 16");
  });

  it("tells a player with no Mausoleum what to build", () => {
    expect(assembleReport("Garden Crew", result({ left: 3, shortfall: "no_mausoleum" })))
      .toContain("build a Mausoleum");
  });

  it("still mentions missing members alongside a shortfall", () => {
    const line = assembleReport("Old Team", result({ deployed: 1, blocked: 1, missing: 2, shortfall: "army_cap" }));
    expect(line).toContain("2 no longer in your roster");
  });

  it("has no notice for a team that can be assembled as-is", () => {
    expect(shortfallNotice(planTeamAssembly(["z1"], farm(["z1"]), 16, 15))).toBeNull();
  });

  it("warns before the tap, naming the same cause", () => {
    expect(shortfallNotice(planTeamAssembly(["z1", "z2", "z3"], farm(["z1", "z2"], ["z3"]), 2, 15)))
      .toBe("Too big for your farm — 1 would stay in the Mausoleum.");
    expect(shortfallNotice(planTeamAssembly(["z1"], farm(["z1", "z2"]), 4, 0)))
      .toBe("Needs a Mausoleum — 1 would stay on the farm.");
  });
});
