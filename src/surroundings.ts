// What the land AROUND the farm looks like, derived from the applied ground skin.
//
// A Market -> Upgrade -> Ground purchase repaints every terrain tile inside the
// farm (see Field.setClimate). Everything outside it — the decorative ring of
// trees/props scattered on the surrounding land, the hills-and-sky backdrop, and
// the viewport filler colour beyond that backdrop — used to stay resolutely
// temperate green, so a beach farm sat in the middle of a meadow. Each climate
// now names its own set of surroundings here, and main rebuilds the ring and
// swaps the backdrop whenever the skin changes.
//
// The pieces are ordinary /assets/objects art (the same files the player can buy
// and place), drawn at their native object scale. That keeps a scenery palm the
// exact size of a placed one, and costs no new artwork. The one exception is the
// grass theme, which keeps the four dedicated /assets/scenery images so the
// default farm looks exactly as it always has.

/** One scatterable piece of scenery. */
export interface SceneryPiece {
  /** Filename under /assets/objects/, or /assets/scenery/ when `scenery` is set. */
  file: string;
  /** Load from /assets/scenery/ (preloaded at boot) instead of /assets/objects/. */
  scenery?: boolean;
  /** Multiplier on the piece's native object size. 1 = exactly as a placed object. */
  scale?: number;
}

export interface SurroundingsTheme {
  /** ground_index terrain key this theme dresses. */
  key: string;
  /** Big silhouettes. Only placed well clear of the farm (see TREE_CLEARANCE). */
  trees: SceneryPiece[];
  /** Smaller clutter, allowed right up to the edge of the farm's clearing. */
  props: SceneryPiece[];
  /** Backdrop image under /assets/ (see tools/prep_backgrounds.py). */
  background: string;
  /**
   * Viewport filler: what the renderer clears to beyond the backdrop's edges.
   * Must be the backdrop's mid-hill colour, so the two read as one continuous
   * surface — including at night, when the darkness overlay dims both equally.
   */
  filler: number;
  /**
   * Multiplier on how much of the scatter lattice this theme populates, on top of
   * the player's Farm Background setting. Default 1 = as dense as the temperate
   * forest. A forest wants to be thick; a paved lot or an airless moon does not,
   * and at woodland density their man-made pieces read as clutter rather than
   * landscape — so those themes dial the whole ring down (see URBAN/LUNAR).
   */
  density?: number;
  /**
   * Fraction of the far band drawn from `trees` rather than `props` (default 0.5).
   * Themes whose big pieces are actual trees carry a higher share: a treeline is
   * what makes the surroundings read as landscape, and the props are dressing
   * scattered through it. Themes whose "trees" are street lights or rocket wrecks
   * stay at the even split — more of those would read as an installation.
   */
  treeShare?: number;
}

/** Repeat a piece `n` times so the scatter picks it that much more often. */
const rep = (n: number, piece: SceneryPiece): SceneryPiece[] =>
  Array.from({ length: n }, () => piece);

/**
 * Theme `density` for the built environments (Urban, Lunar). A street-light grid
 * or a field of rocket wrecks at forest density reads as an installation, not as
 * land the farm happens to sit on — both want to feel EMPTY. This is set so their
 * lushest Farm Background setting lands near the SPARSEST setting of the natural
 * themes: 0.12 x Deep Forest (1) ≈ Light Meadow (0.1). See FARM_BG_DENSITY.
 */
const SPARSE_THEME_DENSITY = 0.12;

// The temperate default: the original four scenery images, at the scales that
// reproduce the pre-theme look exactly.
const GRASS: SurroundingsTheme = {
  key: "grass",
  trees: [{ file: "tree.png", scenery: true, scale: 0.84 }],
  props: [
    { file: "shrub1.png", scenery: true, scale: 0.72 },
    { file: "shrub2.png", scenery: true, scale: 0.72 },
    { file: "shrub3.png", scenery: true, scale: 0.72 },
  ],
  background: "farm_background.png",
  filler: 0x67bb4e,
  treeShare: 0.7,
};

// "Sandy Ground" (terrain key `dirt`): a tropical island cove. Palms and bamboo
// stand back from the farm; the beach between is strewn with a shipwrecked
// pirate's cargo, tiki carvings, and shells washed up on the sand.
const SANDY: SurroundingsTheme = {
  key: "dirt",
  trees: [
    ...rep(4, { file: "palmTree.png", scale: 1.05 }),
    ...rep(4, { file: "coconutTree.png", scale: 0.95 }),
    ...rep(2, { file: "bambooTree.png", scale: 0.85 }),
    { file: "pirateBanner.png", scale: 1 },
    { file: "shipWheel.png", scale: 1 },
  ],
  props: [
    // Young palms keep the near band from being pure clutter.
    ...rep(3, { file: "coconutTree.png", scale: 0.55 }),
    // Shipwrecked cargo.
    ...rep(2, { file: "pirateBarrel.png", scale: 1 }),
    ...rep(2, { file: "pirateCrate.png", scale: 1 }),
    { file: "pirateCratePlain.png", scale: 1 },
    { file: "pirateSack.png", scale: 1 },
    { file: "pirateBag.png", scale: 1 },
    { file: "rumBarrel.png", scale: 1 },
    { file: "powderKeg.png", scale: 1 },
    { file: "cannon.png", scale: 0.85 },
    { file: "cannonBalls.png", scale: 1 },
    { file: "treasureChest.png", scale: 0.8 },
    { file: "parrot.png", scale: 0.9 },
    // Island dressing.
    ...rep(2, { file: "tikiTorch.png", scale: 1 }),
    { file: "tikiHeadSmall.png", scale: 1 },
    { file: "tikiHeadLarge.png", scale: 1 },
    { file: "sandCastle.png", scale: 0.8 },
    // Washed up on the sand — small, so they read as litter, not landmarks.
    ...rep(2, { file: "starfish.png", scale: 1.2 }),
    { file: "shellScallop.png", scale: 1.2 },
    { file: "shellTrumpet.png", scale: 1.2 },
    { file: "sandDollar.png", scale: 1.2 },
    { file: "giantClamClosed.png", scale: 1 },
    { file: "rockLobster.png", scale: 0.8 },
    { file: "rocks.png", scale: 0.9 },
  ],
  background: "farm_background_dirt.png",
  filler: 0xe6cc91,
  treeShare: 0.7,
};

// "Snowy Ground": a frozen clearing in an evergreen forest.
const SNOWY: SurroundingsTheme = {
  key: "snow",
  // One species, two sizes: a stand of firs with saplings between them. (The
  // other winter art in the library is Christmas-themed, which would date the
  // whole farm to December.)
  trees: [
    ...rep(3, { file: "evergreenTree.png", scale: 0.95 }),
    ...rep(2, { file: "evergreenTree.png", scale: 0.65 }),
  ],
  props: [
    ...rep(3, { file: "snowHedge_01.png", scale: 1 }),
    ...rep(2, { file: "snowBalls.png", scale: 1.2 }),
    ...rep(2, { file: "snowFort.png", scale: 1 }),
    { file: "snowMan.png", scale: 0.75 },
    { file: "igloo.png", scale: 1 },
    { file: "iceSculpture.png", scale: 1 },
    { file: "rocks.png", scale: 0.9 },
    { file: "boulder.png", scale: 0.7 },
  ],
  background: "farm_background_snow.png",
  filler: 0xe7f1fa,
  treeShare: 0.75,
};

// "Urban Ground": the farm as a lot in a paved-over city block. Deliberately the
// emptiest theme alongside LUNAR — see `density`.
const URBAN: SurroundingsTheme = {
  key: "stone",
  trees: [
    ...rep(3, { file: "streetLight.png", scale: 0.95 }),
    ...rep(2, { file: "telephonePole.png", scale: 0.95 }),
    ...rep(3, { file: "cityLamp.png", scale: 1 }),
  ],
  props: [
    ...rep(2, { file: "crate.png", scale: 1 }),
    ...rep(2, { file: "barrelNormal.png", scale: 1 }),
    ...rep(2, { file: "hazardFence.png", scale: 0.8 }),
    { file: "toxicDrum.png", scale: 0.8 },
    { file: "hotdogCart.png", scale: 0.85 },
    { file: "bike.png", scale: 0.9 },
    { file: "rocks.png", scale: 0.9 },
  ],
  background: "farm_background_stone.png",
  filler: 0x9fa3a7,
  density: SPARSE_THEME_DENSITY,
};

// "Dead Ground": parched wasteland — bare trees, cacti, and old graves.
const DEAD: SurroundingsTheme = {
  key: "sand",
  // Only genuinely bare/arid art here — the library's other trees are in full
  // green or autumn leaf, which would undo the parched look at a glance.
  trees: [
    ...rep(4, { file: "treeSpooky.png", scale: 0.85 }),
    ...rep(3, { file: "tallCactus.png", scale: 1 }),
    { file: "gallows.png", scale: 0.85 },
  ],
  props: [
    ...rep(3, { file: "smallCactus.png", scale: 1 }),
    ...rep(2, { file: "desertSkull.png", scale: 1.1 }),
    ...rep(2, { file: "rocks.png", scale: 1 }),
    { file: "boulder.png", scale: 0.7 },
    { file: "graveOld.png", scale: 1 },
    { file: "gravestoneNormal.png", scale: 1 },
    { file: "urn.png", scale: 1.1 },
    { file: "skullWithSnake.png", scale: 1.1 },
    { file: "brokenWagon.png", scale: 0.8 },
    { file: "brokenTractor.png", scale: 0.8 },
    { file: "haystack.png", scale: 0.8 },
    { file: "leafPile.png", scale: 1 },
  ],
  background: "farm_background_sand.png",
  filler: 0xbda553,
  treeShare: 0.65,
};

// "Lunar Ground": cratered regolith, wrecked hardware, nothing alive.
const LUNAR: SurroundingsTheme = {
  key: "water",
  trees: [
    ...rep(2, { file: "crashedUFO.png", scale: 0.9 }),
    ...rep(2, { file: "spaceLunarLander.png", scale: 0.85 }),
    ...rep(2, { file: "setiDish.png", scale: 0.9 }),
    ...rep(2, { file: "alienBanner.png", scale: 1 }),
    { file: "spaceRocketShip.png", scale: 0.9 },
    { file: "teleporter.png", scale: 0.8 },
  ],
  props: [
    ...rep(4, { file: "spaceCrater.png", scale: 0.9 }),
    ...rep(4, { file: "rocks.png", scale: 1 }),
    ...rep(2, { file: "boulder.png", scale: 0.7 }),
    { file: "spaceWormHoleA.png", scale: 0.7 },
    { file: "desertSkull.png", scale: 1.1 },
  ],
  background: "farm_background_water.png",
  filler: 0x9195a5,
  density: SPARSE_THEME_DENSITY,
};

const THEMES: Record<string, SurroundingsTheme> = {
  grass: GRASS, dirt: SANDY, snow: SNOWY, stone: URBAN, sand: DEAD, water: LUNAR,
};

/** The surroundings for a ground skin. Unknown terrain keys stay temperate. */
export function surroundingsTheme(terrain: string): SurroundingsTheme {
  return THEMES[terrain] ?? GRASS;
}

/** Every /assets/objects/ file a theme scatters (its scenery/*.png pieces are
 *  already preloaded at boot, so they are not listed). */
export function themeObjectFiles(theme: SurroundingsTheme): string[] {
  const files = new Set<string>();
  for (const p of [...theme.trees, ...theme.props]) if (!p.scenery) files.add(p.file);
  return [...files];
}

/** Deterministically choose a piece for a lattice point. Deliberately hashed off
 *  the point rather than drawn from the scatter RNG: the RNG's draws also set the
 *  piece's SIZE, and reusing one for both makes every big piece the same object.
 *
 *  The avalanche step is not optional. The scatter walks its lattice in steps of
 *  two, so u and v are always EVEN — and `even * odd ^ even * odd` is even too,
 *  which left `% list.length` able to reach only the even slots of any
 *  even-length list. Mixing the low bits up into the high ones fixes that. */
export function pickPiece(list: SceneryPiece[], u: number, v: number): SceneryPiece {
  let h = Math.imul(u, 0x27d4eb2d) ^ Math.imul(v, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16;
  return list[(h >>> 0) % list.length];
}
