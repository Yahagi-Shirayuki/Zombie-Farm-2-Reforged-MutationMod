import { describe, it, expect } from "vitest";
import { GameState } from "./GameState";

// The shed's contents are owned by the OBJECT projection: a packed decoration is a
// server object with status "stored", adopted through syncObjectStorage. The legacy
// `storage.stored` bucket that syncStorage carries is empty for every account that
// packs things away that way, and syncStorage runs FIRST on every authoritative
// response — so adopting it verbatim emptied the shed and relied on the (async,
// supersedable) object reconcile to put it back. These pin that it no longer can.

describe("GameState item storage projections", () => {
  it("does not empty the shed when the legacy storage bucket is empty", () => {
    const s = new GameState();
    s.syncObjectStorage({ beachBall: 2, windmill: 1 });
    expect(s.storedItemTotal()).toBe(3);

    // A later authoritative response (balance change, raid settle, upgrade...).
    s.syncStorage({ "Rusty Fragment": 1 }, {});

    expect(s.storedItems).toEqual([{ key: "beachBall", count: 2 }, { key: "windmill", count: 1 }]);
    expect(s.received).toEqual(["Rusty Fragment"]);
  });

  it("still adopts a legacy bucket that actually holds items", () => {
    const s = new GameState();
    s.syncObjectStorage({ beachBall: 2 });
    s.syncStorage({}, { windmill: 3 });
    expect(s.storedItems).toEqual([{ key: "windmill", count: 3 }]);
  });

  it("lets the object projection empty the shed when the last item is retrieved", () => {
    const s = new GameState();
    s.syncObjectStorage({ beachBall: 1 });
    s.syncObjectStorage({});
    expect(s.storedItems).toEqual([]);
  });

  it("keeps the shed intact across a capacity upgrade", () => {
    const s = new GameState();
    s.syncObjectStorage({ beachBall: 1 });
    s.upgradeStorage(16);
    s.syncCapacities(16, 16);
    expect(s.storageItemCap).toBe(16);
    expect(s.storedItems).toEqual([{ key: "beachBall", count: 1 }]);
  });
});
