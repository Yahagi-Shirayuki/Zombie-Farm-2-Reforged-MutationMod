import { describe, expect, it } from "vitest";
import {
  MAX_REMEMBERED_FALLEN, fallenDateLabel, fallenToInfo, sanitizeFallen, sanitizeFallenUncapped,
  snapshotFallen, trimFallen,
} from "./memorial";
import { GameState } from "../GameState";
import type { ZombieDef } from "../assets";
import type { OwnedZombie } from "./types";

const owned = (id: string, over: Partial<OwnedZombie> = {}): OwnedZombie => ({
  id, key: "ZombieActorRegularTier1", name: "Bob", typeName: "Zombie", group: "Regular",
  className: "Green", classColor: "#7bd84a", mutation: 8, str: 3, dex: 2, con: 4, focus: 50,
  invasions: 5, col: 3, row: 4, ...over,
});

describe("snapshotFallen", () => {
  it("freezes the unit as it died, with no farm position", () => {
    const fallen = snapshotFallen(owned("z1", { color: [1, 2, 3] }), 1000);
    expect(fallen).toMatchObject({ id: "z1", name: "Bob", invasions: 5, mutation: 8, diedAt: 1000 });
    expect(fallen).not.toHaveProperty("col");
    expect(fallen).not.toHaveProperty("row");
  });

  it("copies the inherited tint instead of aliasing it", () => {
    const unit = owned("z1", { color: [1, 2, 3] });
    const fallen = snapshotFallen(unit, 0);
    unit.color![0] = 99;
    expect(fallen.color).toEqual([1, 2, 3]);
  });
});

const def = (over: Partial<ZombieDef> = {}): ZombieDef => ({
  key: "ZombieActorRegularTier1", name: "Zombie", group: "Regular", className: "Green",
  classColor: "#7bd84a", str: 3, dex: 2, con: 4, focus: 50,
  ...over,
} as ZombieDef);

describe("fallenToInfo", () => {
  it("omits the unit id, which is what makes the memorial card action-free", () => {
    // buildZombieActions is only attached when info.id is set (see panels/zombies),
    // so a missing id is the whole mechanism behind "look, but do nothing".
    const info = fallenToInfo(snapshotFallen(owned("z1"), 0), def(), "portrait.png");
    expect(info.id).toBeUndefined();
    expect(info).toMatchObject({ name: "Bob", invasions: 5, portrait: "portrait.png" });
  });

  it("derives the card from the catalog, mutation bonuses folded in", () => {
    // Same derivation a LIVING unit gets (makeOwned), so a memorial cannot drift
    // from what the species is worth — the record stores no stats of its own.
    const bare = fallenToInfo(snapshotFallen(owned("z1", { mutation: 0 }), 0), def(), "");
    const mutated = fallenToInfo(snapshotFallen(owned("z2", { mutation: 8 }), 0), def(), "");
    expect(bare).toMatchObject({ typeName: "Zombie", str: 3, dex: 2, con: 4, focus: 50 });
    expect(mutated.str + mutated.dex + mutated.con)
      .toBeGreaterThan(bare.str + bare.dex + bare.con);
  });

  it("falls back to the deterministic name when the unit was never renamed", () => {
    const info = fallenToInfo(snapshotFallen(owned("z9", { name: "" }), 0), def(), "");
    expect(info.name).toBeTruthy();
    expect(info.name).not.toBe("");
  });

  it("still builds a card for a species the catalog no longer has", () => {
    const info = fallenToInfo(snapshotFallen(owned("z1"), 0), undefined, "");
    expect(info.typeName).toBe("ZombieActorRegularTier1");
    expect(info.group).toBeTruthy();
  });
});

describe("sanitizeFallen", () => {
  it("drops entries with no identity and de-duplicates by id", () => {
    const clean = sanitizeFallen([
      snapshotFallen(owned("z1"), 5),
      snapshotFallen(owned("z1"), 9),
      { name: "no id" },
      null,
      "nonsense",
    ]);
    expect(clean.map((z) => z.id)).toEqual(["z1"]);
  });

  it("fills a partial record rather than building a half-drawn statue", () => {
    const [fallen] = sanitizeFallen([{ id: "z9", key: "ZombieActorRegularTier1" }]);
    expect(fallen).toMatchObject({ id: "z9", mutation: 0, invasions: 0, diedAt: 0 });
    expect(fallen.name).toBeUndefined(); // no name = the deterministic default
  });

  it("returns nothing for a non-array", () => {
    expect(sanitizeFallen(undefined)).toEqual([]);
    expect(sanitizeFallen({ z1: true })).toEqual([]);
  });

  it("caps at the graveyard limit, keeping the newest", () => {
    const many = Array.from({ length: MAX_REMEMBERED_FALLEN + 5 }, (_, i) =>
      snapshotFallen(owned(`z${i}`), i));
    expect(sanitizeFallen(many)).toHaveLength(MAX_REMEMBERED_FALLEN);
  });
});

describe("sanitizeFallenUncapped", () => {
  // The cap counts the GRAVEYARD — zombies waiting for a statue. Enshrined ones go
  // through the uncapped door, because a statue's occupant is exactly the record most
  // likely to be old: cap the two together and a memorial bought long ago comes back
  // as a bare plinth once sixty more zombies have died behind it.
  it("keeps every entry however far past the graveyard cap", () => {
    const many = Array.from({ length: MAX_REMEMBERED_FALLEN + 5 }, (_, i) =>
      snapshotFallen(owned(`z${i}`), i));
    const clean = sanitizeFallenUncapped(many);
    expect(clean).toHaveLength(many.length);
    expect(clean.map((z) => z.id)).toContain("z0"); // the oldest, which the cap would drop
  });

  it("still enforces the same shape rules", () => {
    expect(sanitizeFallenUncapped([{ name: "no id" }, null, "nonsense"])).toEqual([]);
    expect(sanitizeFallenUncapped(undefined)).toEqual([]);
  });
});

describe("trimFallen", () => {
  it("keeps the most recent losses when the graveyard overflows", () => {
    const many = Array.from({ length: MAX_REMEMBERED_FALLEN + 10 }, (_, i) =>
      snapshotFallen(owned(`z${i}`), i));
    const kept = trimFallen(many);
    expect(kept).toHaveLength(MAX_REMEMBERED_FALLEN);
    expect(kept[0].id).toBe(`z${MAX_REMEMBERED_FALLEN + 9}`); // newest first
    expect(kept.some((z) => z.id === "z0")).toBe(false);
  });

  // One settlement stamps every casualty with the same `now`, so equal ranks are the
  // normal case. The server's bootstrap query and its trim both end `DESC, unit_id`;
  // if the cap falls inside a tied group and the client breaks it the other way, the
  // picker offers a zombie the server has already deleted and enshrining it comes
  // back `not_owned`. Ascending id, byte-wise, exactly as SQLite orders it.
  it("breaks a tied timestamp on id the same way the server does", () => {
    const sameRaid = ["z-c", "z-a", "z-b"].map((id) => snapshotFallen(owned(id), 500));
    expect(trimFallen(sameRaid).map((z) => z.id)).toEqual(["z-a", "z-b", "z-c"]);
  });

  it("keeps the same members as the server when the cap splits a tied group", () => {
    // Every zombie died in one settlement, so the cap has to cut through the tie.
    const many = Array.from({ length: MAX_REMEMBERED_FALLEN + 5 }, (_, i) =>
      snapshotFallen(owned(`z${String(i).padStart(3, "0")}`), 500));
    const kept = trimFallen(many).map((z) => z.id);
    // `ORDER BY died_at DESC, unit_id LIMIT 60` — the sixty lowest ids survive.
    expect(kept).toEqual(many.map((z) => z.id).sort().slice(0, MAX_REMEMBERED_FALLEN));
  });
});

describe("fallenDateLabel", () => {
  it("is empty rather than 'Invalid Date' when the timestamp is junk", () => {
    expect(fallenDateLabel({ ...snapshotFallen(owned("z1"), 0), diedAt: NaN })).toBe("");
  });
});

describe("GameState graveyard", () => {
  it("records the dead once, newest first", () => {
    const state = new GameState();
    state.recordFallen([snapshotFallen(owned("z1"), 1), snapshotFallen(owned("z2"), 2)]);
    state.recordFallen([snapshotFallen(owned("z1"), 1)]); // a repeated raid settlement
    expect(state.fallenZombies.map((z) => z.id)).toEqual(["z2", "z1"]);
  });

  it("un-buries a zombie the player revived", () => {
    const state = new GameState();
    state.recordFallen([snapshotFallen(owned("z1"), 1), snapshotFallen(owned("z2"), 2)]);
    state.forgetFallen(["z1"]);
    expect(state.fallenZombies.map((z) => z.id)).toEqual(["z2"]);
  });

  it("hands a fallen zombie to exactly one statue", () => {
    const state = new GameState();
    state.recordFallen([snapshotFallen(owned("z1"), 1)]);
    expect(state.claimFallen("z1")?.id).toBe("z1");
    expect(state.claimFallen("z1")).toBeNull(); // a second statue cannot have them
    expect(state.fallenZombies).toEqual([]);
  });

  it("takes an enshrined zombie back when the statue lets go, without duplicating", () => {
    const state = new GameState();
    const fallen = snapshotFallen(owned("z1"), 1);
    state.recordFallen([fallen]);
    const claimed = state.claimFallen("z1")!;
    state.releaseFallen(claimed);
    state.releaseFallen(claimed);
    expect(state.fallenZombies.map((z) => z.id)).toEqual(["z1"]);
  });

  // Enshrining is what a player does with a loss they care about, which is usually an
  // OLD one — so ranking a released zombie by its date of death dropped it to the
  // bottom of the graveyard and, on a busy farm, off the end of it the moment the
  // statue was sold. The sell confirmation promises the opposite in so many words.
  it("puts a released zombie at the TOP of the graveyard, not at its date of death", () => {
    const state = new GameState();
    const veteran = snapshotFallen(owned("old-friend"), 1); // the very first loss
    state.recordFallen([veteran]);
    const claimed = state.claimFallen("old-friend")!;
    // A full graveyard of more recent losses accumulates while they stand on the statue.
    state.recordFallen(Array.from({ length: MAX_REMEMBERED_FALLEN }, (_, i) =>
      snapshotFallen(owned(`z${i}`), 1_000 + i)));
    expect(state.fallenZombies).toHaveLength(MAX_REMEMBERED_FALLEN);

    state.releaseFallen(claimed, 9_000);

    expect(state.fallenZombies[0].id).toBe("old-friend"); // top of the list…
    expect(state.fallenZombies).toHaveLength(MAX_REMEMBERED_FALLEN); // …and the cap holds
    expect(state.fallenZombies[0].diedAt).toBe(1); // the plaque's date is untouched
  });

  it("still ages a released zombie out behind later losses", () => {
    const state = new GameState();
    state.recordFallen([snapshotFallen(owned("old-friend"), 1)]);
    state.releaseFallen(state.claimFallen("old-friend")!, 9_000);
    // Everything that dies AFTER the release outranks it, exactly as it would a
    // zombie that had died at that moment — the reprieve is a place in the queue,
    // not permanence.
    state.recordFallen(Array.from({ length: MAX_REMEMBERED_FALLEN }, (_, i) =>
      snapshotFallen(owned(`z${i}`), 10_000 + i)));
    expect(state.fallenZombies.some((z) => z.id === "old-friend")).toBe(false);
  });
});
