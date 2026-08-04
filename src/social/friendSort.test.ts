import { describe, it, expect } from "vitest";
import { sortFriends, isFriendSort, DEFAULT_FRIEND_SORT, FRIEND_SORTS } from "./friendSort";
import type { Friend } from "./friends";

const f = (over: Partial<Friend> & { id: string }): Friend => ({
  name: over.id, addedAt: 0, giftsSent: 0, ...over,
});

const roster: Friend[] = [
  f({ id: "ada", name: "Ada", level: 12, giftsReceived: 3, giftOnCooldown: true }),
  f({ id: "boris", name: "boris", level: 41, giftsReceived: 0, giftOnCooldown: false }),
  f({ id: "cara", name: "Cara", level: 41, giftsReceived: 17, giftOnCooldown: false }),
  f({ id: "dev", name: "Dev", giftsReceived: 5, giftOnCooldown: true }),
];
const names = (rows: Friend[]) => rows.map((r) => r.name);
const giftable = (x: Friend) => !x.giftOnCooldown;

describe("sortFriends", () => {
  it("puts the friends you can still gift first by default", () => {
    expect(names(sortFriends(roster, "giftable", giftable))).toEqual(["boris", "Cara", "Ada", "Dev"]);
  });

  it("sorts by level, highest first", () => {
    expect(names(sortFriends(roster, "level", giftable))).toEqual(["boris", "Cara", "Ada", "Dev"]);
  });

  it("sinks an unknown level below a known one instead of treating it as zero", () => {
    const rows = sortFriends([f({ id: "x", name: "NoLevel" }), f({ id: "y", name: "Zero", level: 0 })],
      "level", giftable);
    expect(names(rows)).toEqual(["Zero", "NoLevel"]);
  });

  it("sorts by gifts received, most generous first", () => {
    expect(names(sortFriends(roster, "giftsReceived", giftable))).toEqual(["Cara", "Dev", "Ada", "boris"]);
  });

  it("sorts by name, case-insensitively", () => {
    expect(names(sortFriends(roster, "name", giftable))).toEqual(["Ada", "boris", "Cara", "Dev"]);
  });

  it("breaks every tie by name so equal rows never reshuffle on re-render", () => {
    // boris and Cara are both level 41 and both giftable.
    const once = names(sortFriends(roster, "level", giftable));
    const twice = names(sortFriends([...roster].reverse(), "level", giftable));
    expect(once).toEqual(twice);
    expect(once.indexOf("boris")).toBeLessThan(once.indexOf("Cara"));
  });

  it("sinks unnamed friends below named ones", () => {
    const rows = sortFriends([f({ id: "z", name: "  " }), f({ id: "a", name: "Zoe" })], "name", giftable);
    expect(names(rows)).toEqual(["Zoe", "  "]);
  });

  it("never mutates the caller's array", () => {
    const input = [...roster];
    sortFriends(input, "level", giftable);
    expect(input).toEqual(roster);
  });

  it("treats a missing gift count as zero", () => {
    const rows = sortFriends([f({ id: "a", name: "A" }), f({ id: "b", name: "B", giftsReceived: 1 })],
      "giftsReceived", giftable);
    expect(names(rows)).toEqual(["B", "A"]);
  });
});

describe("isFriendSort", () => {
  it("accepts every advertised mode and rejects anything else", () => {
    for (const s of FRIEND_SORTS) expect(isFriendSort(s.id)).toBe(true);
    expect(isFriendSort("bogus")).toBe(false);
    expect(isFriendSort(null)).toBe(false);
    expect(isFriendSort(undefined)).toBe(false);
  });
  it("has a default that is itself a valid mode", () => {
    expect(isFriendSort(DEFAULT_FRIEND_SORT)).toBe(true);
  });
});
