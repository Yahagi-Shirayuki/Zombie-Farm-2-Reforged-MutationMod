import { beforeEach, describe, expect, it, vi } from "vitest";
import { repairStaleArtCache } from "./artCacheRepair";

// The runtime art cache is CacheFirst on filenames that never change, so art that
// shipped BROKEN (the transparent Worm Hole placeholders) stays broken on every
// install that saw it — for the full 60-day expiry. This sweep is the way out.

const EPOCH_KEY = "zf.artEpoch";

/** Minimal Cache/CacheStorage stand-in: enough surface for the sweep, and it records
 *  exactly which entries were deleted. */
const makeCaches = (contents: Record<string, string[]>) => {
  const deleted: string[] = [];
  const store = new Map(Object.entries(contents).map(([name, urls]) => [name, [...urls]]));
  return {
    deleted,
    api: {
      keys: async () => [...store.keys()],
      open: async (name: string) => ({
        keys: async () => (store.get(name) ?? []).map((url) => ({ url })),
        delete: async (request: { url: string }) => {
          deleted.push(request.url);
          store.set(name, (store.get(name) ?? []).filter((url) => url !== request.url));
          return true;
        },
      }),
    },
  };
};

const ROOT = "https://zombiefarmreforged.com/assets/objects/";
const SUBPATH = "https://someone.github.io/zombiefarm/assets/objects/";

const localStore = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as unknown as Storage;
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("stale art cache repair", () => {
  it("drops the known-bad art and nothing else", async () => {
    const { api, deleted } = makeCaches({
      "zf-art": [
        `${ROOT}spaceWormHoleA.png`,
        `${ROOT}spaceWormHoleB.png`,
        `${ROOT}windmill.png`,
      ],
      "zf-audio": [`${ROOT}../audio/theme.mp3`],
    });
    vi.stubGlobal("caches", api);
    vi.stubGlobal("window", { localStorage: localStore() });

    await repairStaleArtCache();

    expect(deleted.sort()).toEqual([`${ROOT}spaceWormHoleA.png`, `${ROOT}spaceWormHoleB.png`]);
  });

  it("drops the flat tiles that shipped with a dark seam along every join", async () => {
    // Epoch 2. Ponds and roads are laid edge to edge and overlap by design, so the
    // doubled premultiply drew a line along every join; the corrected art ships under
    // the same filenames, which is exactly the case CacheFirst cannot deliver on its
    // own. A neighbouring object that did NOT change must be left alone.
    const { api, deleted } = makeCaches({
      "zf-art": [
        `${ROOT}pond5.png`,
        `${ROOT}roadBend_01.png`,
        `${ROOT}cobblestoneRoadIntersection.png`,
        `${ROOT}rocks.png`,
        `${ROOT}soil_zombiePatch.png`,
        `${ROOT}windmill.png`,
      ],
    });
    vi.stubGlobal("caches", api);
    vi.stubGlobal("window", { localStorage: localStore() });

    await repairStaleArtCache();

    expect(deleted.sort()).toEqual([
      `${ROOT}cobblestoneRoadIntersection.png`,
      `${ROOT}pond5.png`,
      `${ROOT}roadBend_01.png`,
      `${ROOT}rocks.png`,
      `${ROOT}soil_zombiePatch.png`,
    ]);
  });

  it("matches on the path, so a GitHub Pages subpath install is repaired too", async () => {
    // base is "./", so the same deploy is reachable under a bare domain and a project
    // subpath. Matching whole URLs would silently skip half the installs.
    const { api, deleted } = makeCaches({ "zf-art": [`${SUBPATH}spaceWormHoleA.png`] });
    vi.stubGlobal("caches", api);
    vi.stubGlobal("window", { localStorage: localStore() });

    await repairStaleArtCache();

    expect(deleted).toEqual([`${SUBPATH}spaceWormHoleA.png`]);
  });

  it("runs once per epoch, not on every boot", async () => {
    const storage = localStore();
    const first = makeCaches({ "zf-art": [`${ROOT}spaceWormHoleA.png`] });
    vi.stubGlobal("caches", first.api);
    vi.stubGlobal("window", { localStorage: storage });
    await repairStaleArtCache();
    expect(storage.getItem(EPOCH_KEY)).toBeTruthy();

    const second = makeCaches({ "zf-art": [`${ROOT}spaceWormHoleA.png`] });
    vi.stubGlobal("caches", second.api);
    await repairStaleArtCache();
    expect(second.deleted).toEqual([]);
  });

  it("is a no-op where there is no Cache API", async () => {
    const storage = localStore();
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("window", { localStorage: storage });
    await expect(repairStaleArtCache()).resolves.toBeUndefined();
    expect(storage.getItem(EPOCH_KEY)).toBeTruthy(); // still recorded: nothing to retry
  });

  it("survives a browser that refuses storage entirely", async () => {
    const { api, deleted } = makeCaches({ "zf-art": [`${ROOT}spaceWormHoleA.png`] });
    vi.stubGlobal("caches", api);
    vi.stubGlobal("window", {
      get localStorage(): Storage { throw new Error("blocked"); },
    });
    await expect(repairStaleArtCache()).resolves.toBeUndefined();
    expect(deleted).toEqual([]); // no way to run it once, so it does not run at all
  });
});
