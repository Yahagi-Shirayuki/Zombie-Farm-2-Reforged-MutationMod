import { describe, expect, it } from "vitest";
import { mintObjectId, objectIdFloor, objectIdNumber } from "./objectIds";

describe("objectIdNumber", () => {
  it("reads minted ids and ignores everything else", () => {
    expect(objectIdNumber("o48")).toBe(48);
    expect(objectIdNumber("o1")).toBe(1);
    // Server instance ids and claim ids were never minted here.
    expect(objectIdNumber("2b558a48-f339-4e28-bb67-3278f4b9bd61")).toBe(0);
    expect(objectIdNumber("reward-sale-a9a4a276-4cf5-43f1-80e8-9a2a4a245a98")).toBe(0);
    expect(objectIdNumber("o12x")).toBe(0);
    expect(objectIdNumber("")).toBe(0);
  });
});

describe("objectIdFloor", () => {
  it("clears the highest restored id", () => {
    expect(objectIdFloor(1, ["o3", "o47", "o12"])).toBe(48);
  });

  it("NEVER drops below the floor when restored ids are all server-issued", () => {
    // The live defect: an online save's objects have all been renamed to server
    // instance ids, so the scan finds nothing. Resetting to 1 re-issues ids the
    // session already handed out and aliased to live server objects.
    const serverOwned = [
      "2b558a48-f339-4e28-bb67-3278f4b9bd61",
      "07491a09-60d9-4b56-bc04-d0d698687acd",
    ];
    expect(objectIdFloor(49, serverOwned)).toBe(49);
    expect(objectIdFloor(49, [])).toBe(49);
  });

  it("takes the higher of the floor and the restored scan", () => {
    expect(objectIdFloor(49, ["o60"])).toBe(61);
    expect(objectIdFloor(70, ["o60"])).toBe(70);
  });
});

describe("mintObjectId", () => {
  it("issues from the counter and advances it", () => {
    expect(mintObjectId(48, new Set())).toEqual({ id: "o48", next: 49 });
  });

  it("skips ids already in play", () => {
    // Ids also arrive from saves and the server, so a bare increment can still land
    // on one that is taken.
    expect(mintObjectId(48, new Set(["o48", "o49"]))).toEqual({ id: "o50", next: 51 });
  });

  it("never issues the same id twice in a row of purchases", () => {
    const placed = new Set<string>(["o1", "o2"]);
    const issued: string[] = [];
    let next = 1;
    for (let i = 0; i < 6; i++) {
      const mint = mintObjectId(next, placed);
      issued.push(mint.id);
      next = mint.next;
      placed.add(mint.id);
    }
    expect(issued).toEqual(["o3", "o4", "o5", "o6", "o7", "o8"]);
    expect(new Set(issued).size).toBe(issued.length);
  });

  it("stays valid when the counter is behind the placed set", () => {
    expect(mintObjectId(0, new Set())).toEqual({ id: "o1", next: 2 });
    expect(mintObjectId(1, new Set(["o1", "o2", "o3"]))).toEqual({ id: "o4", next: 5 });
  });
});
