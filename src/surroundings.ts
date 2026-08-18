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
  /** Draw this piece mirrored about its own vertical axis.
   *
   *  A theme with few distinct pieces reads as one stamp repeated, and the scatter
   *  cannot hide that — it only varies size. Listing a piece twice, once flipped,
   *  doubles the silhouettes for no new art: a tree leaning left and the same tree
   *  leaning right are not obviously the same tree.
   *
   *  The theme author is responsible for only flipping art that CAN be flipped —
   *  the same rule `noMirror` enforces for placed objects (see canMirrorObject).
   *  Anything with baked-in lettering reads backwards. */
  flip?: boolean;
}

/**
 * A street laid through the surrounding land, with its two verges dressed.
 *
 * The scatter can only ever produce a FIELD of things — it walks a lattice and
 * rolls for each point, which is right for a wood or a beach and cannot express a
 * line. A street is a line, and the things beside a street are lined up along it
 * too: lights march at an even spacing down one kerb, and what is dumped on the far
 * side sits on the other. Laying that as a separate pass is what makes the urban
 * skin read as a lot beside a road rather than as street furniture in a meadow.
 */
export interface RoadSpec {
  /** Catalog key of the road piece. Must be a 2x2 flat tile whose art runs along
   *  +col — the surface is laid end to end down a single row. The branch off the
   *  crossing reuses it MIRRORED, which in iso swaps the two axes and turns the lane
   *  markings through ninety degrees (the same trick "rotate" plays on placed art). */
  key: string;
  /** Catalog key of the four-way crossing dropped into the run. */
  crossingKey: string;
  /** Tiles beyond the farm's near edge that the road runs, clear of the scatter's
   *  own MARGIN so the street never crowds the fence. */
  offset: number;
  /** Lamps marching down the kerb nearer the farm, and the tiles between them.
   *  That even stride is most of what makes a line of them read as a street. */
  lamps: SceneryPiece[];
  lampSpacing: number;
  /** What has been dumped on the far side. Dropped in CLUMPS at random rather than
   *  marched like the lamps: waste collects where someone tipped it, and an evenly
   *  spaced row of barrels reads as a barricade someone installed. */
  litter: SceneryPiece[];
  litterClumps: number;
  litterPerClump: number;
}

/** A line of tall pieces marching across the screen just below the hills. */
export interface SkylineSpec {
  pieces: SceneryPiece[];
  /** Tiles along the line between successive pieces. */
  spacing: number;
}

/**
 * A handful of landmarks placed with room kept around them.
 *
 * The scatter has no idea what it is placing, so a pond comes out wedged between two
 * trees like any other prop — and a pond is the one thing in a wood you can see
 * across. Placing these first and holding a clearing open around each is what makes
 * them read as somewhere the trees stop rather than as scenery in a gap.
 */
export interface SpringSpec {
  pieces: SceneryPiece[];
  count: number;
  /** Tiles of clear ground around each; the scatter drops anything inside. */
  clearing: number;
  /** Tiles beyond the farm's edge before one may sit. */
  minDistance: number;
}

/**
 * Stones laid as meandering trails rather than strewn at random.
 *
 * Same limit as the road (see RoadSpec): the scatter can make a field of stones and
 * never a path. A trail is a walk — a heading that wanders a little at each step —
 * so it has to be generated as one.
 */
export interface PathSpec {
  pieces: SceneryPiece[];
  /** How many separate trails. */
  count: number;
  /** World px between successive stones. */
  step: number;
  /** Stones per trail. */
  length: number;
  /** Radians the heading may turn per step. Small enough to read as a curve. */
  wander: number;
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
   * Seamless ground image under /assets/, tiled over the land AROUND the farm.
   *
   * Absent by default, and that is the right answer for most skins: the surrounding
   * land is normally just `filler` showing through, which nobody can tell from real
   * ground while the terrain is a flat wash. A terrain with visible TEXTURE breaks
   * that illusion — the farm becomes a detailed diamond on a blank sheet — so those
   * skins ship a tile of themselves here. See build_ground_fill in prep_assets.py.
   */
  groundFill?: string;
  /** A street through the surrounding land. Absent for every theme but Urban —
   *  see RoadSpec for why it is a separate pass from the scatter. */
  road?: RoadSpec;
  /** A line of pieces along the far edge of the land, under the hills. */
  skyline?: SkylineSpec;
  /** Landmarks placed first, with the scatter held off around them. */
  springs?: SpringSpec;
  /** Trails winding through the land, laid instead of scattered. */
  paths?: PathSpec;
  /**
   * An alternative horizon for the hours around nightfall (see isLocalDusk).
   *
   * Unlike every other backdrop here this one is NOT derived from the base art by a
   * ramp — a sunset is a gradient sky and warm rim light, which no per-pixel
   * luminance remap of a flat blue afternoon can produce. It is drawn as a finished
   * piece and shipped whole, so it carries its own filler and sky rather than
   * inheriting the theme's.
   */
  dusk?: { background: string; filler: number; sky: number };
  /**
   * Viewport filler: what the renderer clears to beyond the backdrop's edges.
   * Must be the backdrop's mid-hill colour, so the two read as one continuous
   * surface — including at night, when the darkness overlay dims both equally.
   */
  filler: number;
  /**
   * The backdrop's own top-row colour, used to close the seam at the top of the art.
   * Every shipped backdrop is 2800x560 with a perfectly flat top row, so a band of this
   * colour above it is indistinguishable from more sky — and the art is scaled by a
   * fractional factor to span the farm, so without one its top edge lands half a pixel
   * short and draws a filler-coloured line across the sky (see SKY_EXTENSION in main.ts).
   */
  sky: number;
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
  sky: 0x96d0ec,
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
  sky: 0x74c6f2,
  treeShare: 0.7,
};

// "Autumn Ground": the temperate farm in late October — the same woodland as
// GRASS, but turned. The terrain itself is the grass tile recoloured (see
// DERIVED_GROUND_ROWS in tools/prep_assets.py), so this theme keeps the same
// SHAPE of surroundings — a wood with clutter under it — and only changes what
// season it is. Harvest dressing rather than Halloween: pumpkins earn their place
// on a farm in autumn, but nothing carved or spooky.
const AUTUMN: SurroundingsTheme = {
  key: "autumn",
  trees: [
    ...rep(3, { file: "treeAutumn1.png", scale: 0.85 }),
    ...rep(3, { file: "treeAutumn2.png", scale: 0.85 }),
    ...rep(3, { file: "treeAutumn3.png", scale: 0.85 }),
  ],
  props: [
    ...rep(4, { file: "leafPile.png", scale: 1.1 }),
    ...rep(2, { file: "pumpkin.png", scale: 1 }),
    ...rep(2, { file: "toadStool.png", scale: 1 }),
    { file: "cornucopia.png", scale: 0.9 },
    { file: "rocks.png", scale: 0.9 },
  ],
  background: "farm_background_autumn.png",
  filler: 0xdea967,
  sky: 0x96d0ec,
  treeShare: 0.7,
  dusk: {
    background: "farm_background_autumn_dusk.png",
    filler: 0xa37047,
    sky: 0x8288b4,
  },
};

// "Sakura Ground": a farm cleared inside a cherry grove in bloom. The one theme
// built around art drawn FOR this project — both sakura are LennyFaze's (see
// tools/contributed_art.py), and the player can buy the same two trees from the
// Market to carry the grove inside the fence.
//
// The brief is deliberately narrow: blossom, and then almost nothing else. Rocks
// and water are the only other things out there, and the ponds are kept to one
// entry each so they read as the occasional feature of the valley rather than as
// scenery the ring is made of — a pond every few tiles would turn a grove into a
// water garden. Bamboo is the single note of green, at low weight, so the pink has
// something to be pink AGAINST; drop it and the whole ring flattens into one wash.
// Full-grown cherries are drawn at exactly their placed size — scale 1, the rule
// this file's header describes and the one thing that stops a bought tree from
// towering over the grove it came out of. Both sakura ship the same height (see
// SAKURA_HEIGHT in tools/contributed_art.py), so ONE constant covers both; the
// upright and the weeping are told apart by width now, not by height. That authored
// height is the only place the grove's size lives — this stays 1 and follows it.
const SAKURA_TREE = 1;

const SAKURA: SurroundingsTheme = {
  key: "sakura",
  // All three cuts appear mirrored as well as upright: three pieces of art, six
  // silhouettes. None has any lettering or asymmetric detail that reads as wrong
  // reversed — a cherry leaning the other way is just another cherry.
  trees: [
    ...rep(4, { file: "sakuraTree.png", scale: SAKURA_TREE }),
    ...rep(4, { file: "sakuraTree.png", scale: SAKURA_TREE, flip: true }),
    ...rep(3, { file: "sakuraTreeWeeping.png", scale: SAKURA_TREE }),
    ...rep(3, { file: "sakuraTreeWeeping.png", scale: SAKURA_TREE, flip: true }),
    // The pale one, at a slightly lower weight: it is the lightest of the three, so
    // a even share of it washes the treeline out.
    ...rep(3, { file: "sakuraTreeFlowering.png", scale: SAKURA_TREE }),
    ...rep(2, { file: "sakuraTreeFlowering.png", scale: SAKURA_TREE, flip: true }),
    // The only green in the theme, and deliberately the rarest thing in the list:
    // one stand in 25 trees. Enough to stop the ring being one flat pink wash,
    // few enough that the valley is unmistakably a cherry wood and not a mixed one.
    { file: "bambooTree.png", scale: 0.78 },
  ],
  // Every tree in this wood is full grown: no seedlings or half-height saplings, and
  // no boulders either. What is strewn between them is the SAME little rocks the
  // trails are made of, so a trail is just where they happen to run together — the
  // stones on and off the path are one kind of thing, not two.
  props: [
    ...rep(3, { file: "rocks.png", scale: 0.9 }),
    ...rep(3, { file: "rocks.png", scale: 0.9, flip: true }),
    ...rep(2, { file: "rocks.png", scale: 0.72 }),
    ...rep(2, { file: "rocks.png", scale: 0.72, flip: true }),
  ],
  // Two springs, well out from the fence and with the wood held back around each.
  springs: {
    pieces: [{ file: "koiPond.png", scale: 0.85 }],
    count: 2,
    clearing: 7,
    minDistance: 14,
  },
  // Stone trails winding between the trees, laid as a SUGGESTION of a path rather
  // than a paved one: the step is roughly twice a stone's own width, so the eye joins
  // them up instead of reading a gravel strip. Many short trails rather than a few
  // long ones, one per cell of the stratified grid, so they turn up all over the wood
  // instead of in the handful of places a few long walks happen to reach.
  //
  // `wander` is low for the same reason. At 0.42 a walk coiled back over itself often
  // enough to leave dense knots — which is exactly the concentration the spread is
  // meant to avoid, arriving by a different route.
  paths: {
    // SMALL stones, close together. `rocks.png` is not one stone, it is a little pile
    // of them — so spacing it out can only ever give a row of piles, however straight
    // the walk. Two passes at making it read as a path failed on that: at 50px the
    // piles merged into a paved gravel strip, at 74-108 they read as separate heaps.
    // Shrunk to about half, they stop looking like heaps at all, and laid nearly
    // touching they join into one narrow line — light, but continuous, which is what
    // separates a path from things that happen to lie in a row.
    pieces: [
      { file: "rocks.png", scale: 0.44 },
      { file: "rocks.png", scale: 0.44, flip: true },
      { file: "rocks.png", scale: 0.37 },
      { file: "rocks.png", scale: 0.37, flip: true },
    ],
    count: 12,
    step: 36,
    length: 34,
    wander: 0.18,
  },
  background: "farm_background_sakura.png",
  // The one skin whose terrain is textured rather than a wash, so the one that
  // needs its ground continued past the fence.
  groundFill: "ground/sakura_fill.png",
  filler: 0xe6b7ca,
  // The one skin whose sky is not the base art's afternoon blue — see SKY_RAMPS in
  // prep_backgrounds.py. Flat, so the band above it continues it exactly.
  sky: 0xf4bc97,
  // A blossom wood stands in open ground, not packed shoulder to shoulder like the
  // temperate forest — and with pieces this large a full-density ring closes the
  // horizon off entirely. The floor here is the built themes' contract, not taste:
  // Urban and Lunar at their lushest must still land near the NATURAL themes at
  // their sparsest (see the density test in surroundings.test.ts).
  density: 0.75,
  // High, and it is the trails that push it there rather than the treeline. Every
  // prop in this theme is a rock, so props scattered at random are rocks lying in
  // exactly the places a trail is trying to be legible against — camouflage for the
  // very thing they are made of. Thinning them is most of what makes a path read as
  // a path; the loose stones that remain sit near the fence, where the near band is
  // always props and no trail runs anyway.
  treeShare: 0.88,
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
  // Weighted toward what the WEATHER made rather than what somebody built. The
  // first pass ran the other way — two thirds of the list was hedging, forts,
  // igloos and carved ice — and a clearing where every third object is a snow
  // fort reads as a play park rather than as a frozen wood. The built pieces are
  // all still here, each roughly halved, so coming across one is an event.
  props: [
    // Drifts and snowed-under rock: the natural floor of the clearing.
    ...rep(4, { file: "snowBalls.png", scale: 1.2 }),
    ...rep(3, { file: "rocks.png", scale: 0.9 }),
    ...rep(2, { file: "boulder.png", scale: 0.7 }),
    // Young firs seeded out of the treeline. The near band is props only, so
    // without these the only greenery in the clearing is the far band's.
    ...rep(2, { file: "evergreenTree.png", scale: 0.45 }),
    ...rep(2, { file: "snowHedge_01.png", scale: 1 }),
    { file: "snowMan.png", scale: 0.75 },
    { file: "snowFort.png", scale: 0.85 },
    { file: "igloo.png", scale: 1 },
    { file: "iceSculpture.png", scale: 1 },
  ],
  background: "farm_background_snow.png",
  filler: 0xe6f1f9,
  // The no-tree base's own sky, a shade off the original's — this theme has no
  // SKY_RAMPS entry, so the backdrop carries the base's blue through verbatim.
  sky: 0x93cbe8,
  treeShare: 0.75,
};

// "Urban Ground": the farm as a lot in a paved-over city block. Deliberately the
// emptiest theme alongside LUNAR — see `density`.
const URBAN: SurroundingsTheme = {
  key: "stone",
  // NOTHING that belongs to infrastructure is scattered here any more. Every upright
  // this theme owns has moved to a structure that explains it — street lights onto the
  // road, barrels into the tipped clumps beside it, the telephone line onto the
  // skyline — because the scatter cannot place any of them honestly: a street light
  // exists to light a road, and a pole carrying no line is just a post. The loose
  // City Lamps went first, then the stray poles, and the lot is better for it: the
  // line of poles under the hills reads as a line only while it is the ONLY line.
  //
  // What is left is a dumping ground, so both lists are junk. `trees` is only "the
  // bigger junk" — the far band still gets the pieces that stand up, so the depth
  // cue survives without a single tree in a theme that should not have one.
  trees: [
    // A lump of broken concrete, at the size that stands up. Rubble is the theme of
    // both lists — this is just the rubble big enough to read from the back band.
    ...rep(3, { file: "boulder.png", scale: 0.75 }),
    ...rep(2, { file: "barbWireFence_01.png", scale: 0.9 }),
    { file: "hazardFence.png", scale: 0.85 },
    { file: "bike.png", scale: 0.9 },
    { file: "hotdogCart.png", scale: 0.85 },
    { file: "zombieXingSign.png", scale: 0.9 },
  ],
  // Rubble, then crates, then a thin tail of everything else. Two rules hold this
  // list together, and both were learnt the wrong way round first:
  //
  // - It is RUBBLE. Broken stone and dumped crates are what a derelict lot is covered
  //   in; a bench or a postbox is somebody's deliberate street furniture, and a lot
  //   with a scattering of those reads as a park nobody mows. Both are out of the
  //   list altogether — one slot in twenty-four sounds rare and is not, because the
  //   lot draws about a hundred pieces at the zoom it is usually seen at, and a warm
  //   brown bench on grey ground is picked out by the eye every single time.
  // - The loud pieces get one slot each. The Hazard Fence is the most obviously urban
  //   thing in the library and easily the most saturated, so at any generous weight
  //   the lot becomes a field of yellow chevrons. Grey carries the count instead and
  //   reads as nothing in particular, which is what most litter looks like.
  //
  // Both rubble pieces appear at two sizes, as LUNAR's craters do: one stamp repeated
  // at one size is a pattern however many of it there are. The Toxic Drum is scaled to
  // the plain Barrel rather than to its own 128x128 art, the correction the road's
  // clumps make too.
  props: [
    ...rep(5, { file: "rocks.png", scale: 0.9 }),
    ...rep(4, { file: "rocks.png", scale: 0.6 }),
    ...rep(3, { file: "boulder.png", scale: 0.45 }),
    ...rep(3, { file: "crate.png", scale: 1 }),
    ...rep(2, { file: "boulder.png", scale: 0.3 }),
    ...rep(2, { file: "crate.png", scale: 0.7 }),
    { file: "barrelNormal.png", scale: 1 },
    { file: "toxicDrum.png", scale: 0.5 },
    { file: "barbWireFence_01.png", scale: 0.85 },
    { file: "hazardFence.png", scale: 0.8 },
  ],
  background: "farm_background_stone.png",
  filler: 0x9ea2a6,
  sky: 0x93cbe8,
  density: SPARSE_THEME_DENSITY,
  // Well under the 0.5 default. The far band is junk rather than trees, so there is
  // no treeline to establish and no reason to favour the bigger pieces — the split
  // survives only as a depth cue, putting the odd thing that stands up out at the
  // back. At the default the lot read as a lamp farm, and later as a pole farm.
  treeShare: 0.2,
  road: {
    key: "roadStraight",
    crossingKey: "roadIntersection",
    // Five tiles clear of the fence: past the scatter's own 2.5-tile margin, close
    // enough that the street is in shot at the zoom the farm is usually played at.
    offset: 5,
    // MIRRORED so the lamp head overhangs the carriageway. The art hangs its arm out
    // to the RIGHT of the pole, and on this kerb the road is to the pole's left — a
    // lamp lighting the empty lot behind it is the detail that gives a street away.
    lamps: [{ file: "streetLight.png", scale: 0.95, flip: true }],
    lampSpacing: 8,
    // The Toxic Drum's art is 128x128 — nearly three tiles wide at full size, where
    // the plain Barrel is 49x73 and reads as one. It is scaled to match rather than
    // to its own catalog size, or a single drum covers half the carriageway.
    litter: [
      { file: "toxicDrum.png", scale: 0.5 },
      { file: "barrelNormal.png", scale: 1 },
      { file: "toxicDrum.png", scale: 0.42 },
      { file: "barrelNormal.png", scale: 0.85 },
      { file: "crate.png", scale: 1 },
      { file: "hazardFence.png", scale: 0.7 },
    ],
    // Five heaps of three. Eight-of-four laid 32 drums down one verge, which at this
    // spacing is not fly-tipping any more, it is a row — and the clumps stopped
    // reading as clumps once they touched.
    litterClumps: 5,
    litterPerClump: 3,
  },
  // A telephone line running the width of the land under the hills. Wide apart: the
  // spacing is what reads as a line stretching away rather than as a fence.
  skyline: {
    pieces: [{ file: "telephonePole.png", scale: 0.95 }],
    spacing: 20,
  },
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
  filler: 0xbca453,
  sky: 0x93cbe8,
  // Under the natural themes' default 1. This one is a WASTELAND, and a wasteland
  // at the same fill as a temperate wood is just a wood with dead trees in it —
  // the empty ground between the pieces is the theme. Still comfortably a natural
  // density (the floor is a contract at roughly 0.7; see the density test) — and
  // 0.75, matching Sakura, keeps a clear margin on both of that test's bounds.
  density: 0.75,
  treeShare: 0.65,
};

// "Lunar Ground": cratered regolith. Craters ARE the landscape here — the wrecked
// hardware is punctuation, so this is the one theme weighted AWAY from its far
// band (treeShare well under the 0.5 default) and heavily toward a single prop.
const LUNAR: SurroundingsTheme = {
  key: "water",
  trees: [
    { file: "crashedUFO.png", scale: 0.9 },
    { file: "spaceLunarLander.png", scale: 0.85 },
    { file: "setiDish.png", scale: 0.9 },
    { file: "alienBanner.png", scale: 1 },
    { file: "spaceRocketShip.png", scale: 0.9 },
    { file: "teleporter.png", scale: 0.8 },
  ],
  props: [
    // Two crater sizes so a field of them still varies: wide shallow basins and
    // small impact pocks. Together they take three quarters of the prop list.
    ...rep(7, { file: "spaceCrater.png", scale: 0.95 }),
    ...rep(5, { file: "spaceCrater.png", scale: 0.55 }),
    ...rep(2, { file: "rocks.png", scale: 1 }),
    { file: "boulder.png", scale: 0.7 },
    { file: "spaceWormHoleA.png", scale: 0.7 },
  ],
  background: "farm_background_water.png",
  filler: 0x5b5e65,
  sky: 0x181831,
  density: SPARSE_THEME_DENSITY,
  treeShare: 0.2,
};

const THEMES: Record<string, SurroundingsTheme> = {
  grass: GRASS, dirt: SANDY, autumn: AUTUMN, sakura: SAKURA, snow: SNOWY,
  stone: URBAN, sand: DEAD, water: LUNAR,
};

/** Every shipped theme, for checks that must cover all of them. */
export const ALL_THEMES: SurroundingsTheme[] = Object.values(THEMES);

/** The surroundings for a ground skin. Unknown terrain keys stay temperate. */
export function surroundingsTheme(terrain: string): SurroundingsTheme {
  return THEMES[terrain] ?? GRASS;
}

/** Every /assets/objects/ file a theme scatters (its scenery/*.png pieces are
 *  already preloaded at boot, so they are not listed). */
export function themeObjectFiles(theme: SurroundingsTheme): string[] {
  const files = new Set<string>();
  for (const p of themePieces(theme)) if (!p.scenery) files.add(p.file);
  return [...files];
}

/** Every scenery piece a theme can draw — scatter, roadside and skyline alike. For
 *  checks that must cover all of them: a lamp is as easy to typo as a tree. */
export function themePieces(theme: SurroundingsTheme): SceneryPiece[] {
  return [...theme.trees, ...theme.props, ...(theme.road?.lamps ?? []),
    ...(theme.road?.litter ?? []), ...(theme.skyline?.pieces ?? []),
    ...(theme.springs?.pieces ?? []), ...(theme.paths?.pieces ?? [])];
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
