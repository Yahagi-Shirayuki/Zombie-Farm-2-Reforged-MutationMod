// Isometric painter's-order sorting for the shared entity layer (crops, placed
// objects, foliage, the farmer, wandering zombies).
//
// GROUND TRUTH (recovered from the ZF2 iOS binary): the original does NOT sort by
// a single depth scalar. Static tiles are keyed at their FRONT (south) corner
// depth = tileX + tileY, but the game then SCANS the tiles neighbouring an
// object's footprint and splices the sprite into the layer at the exact child
// index that keeps footprints ordered (`-[ZFTileManager addTile:toTileCoordinate:]`
// -> `insertChild:atIndex:z:`). A lone scalar can't express that, which is why a
// character standing on/near a multi-tile object used to be painted over.
//
// We reproduce the footprint ordering directly: every entity registers the tile
// RANGE it occupies, and each frame we topologically sort the layer using the
// standard isometric separating rule (A is behind B if A lies entirely on the far
// side of B along either grid axis). Non-separated (overlapping) pairs fall back
// to a depth key so a character on an object's own tiles draws in front of it.
import { Container } from "pixi.js";

export interface Footprint {
  c0: number; // min tile column (north-west corner)
  r0: number; // min tile row
  c1: number; // max tile column (south-east / front corner)
  r1: number; // max tile row
  bias: number; // tie-break nudge for overlapping footprints (actors > statics)
}

const FP = Symbol("depthFootprint");
// Bumped whenever any footprint actually CHANGES (moved tile, re-laid-out, or a
// fresh entity registering). sortLayer skips its whole O(n²) pass while a layer's
// last-sorted epoch still matches — on an idle farm (actors between tile
// crossings) that makes the per-frame sort free.
let footprintEpoch = 1;
const SORTED_EPOCH = Symbol("depthSortedEpoch");
const SORTED_COUNT = Symbol("depthSortedCount");

/** Register the tile footprint an entity occupies (call whenever it moves/relays).
 *  A point entity (actor/zombie) passes the same tile for both corners. Callers
 *  pass rounded tile coords, so per-frame calls for an actor mid-tile are no-ops
 *  here and don't dirty the sort. */
export function setFootprint(
  node: Container, c0: number, r0: number, c1: number, r1: number, bias = 0
) {
  const holder = node as unknown as { [FP]?: Footprint };
  const prev = holder[FP];
  if (prev && prev.c0 === c0 && prev.r0 === r0 && prev.c1 === c1 && prev.r1 === r1
    && prev.bias === bias) return;
  holder[FP] = { c0, r0, c1, r1, bias };
  footprintEpoch++;
}

function getFootprint(node: Container): Footprint | undefined {
  return (node as unknown as { [FP]?: Footprint })[FP];
}

// The two relations the sort is built on. Both are inlined over the scratch arrays
// below (this pass is the farm's hottest loop), so they live here as prose:
//
// BEHIND — A is behind B (must be drawn first) when A sits entirely on the far,
// camera-away side of B along one grid axis: `a.c1 < b.c0 || a.r1 < b.r0`. The
// isometric separating-axis test, on inclusive ranges, so touching footprints
// (shared edge) count as overlapping and fall to the depth-key tie-break rather
// than being forced apart.
//
// BEFORE — deterministic paint order among entities the topo-sort leaves ambiguous
// (overlapping or perpendicular footprints, and any cycle leftovers). Back-to-front
// by depth key (`c0 + r0 + bias`, the isometric anti-diagonal), then TOP-TO-BOTTOM
// (north row first), then LEFT-TO-RIGHT (west column first). This is the reading
// order of the grid, so a crop patch and a placed object on the same diagonal always
// stack the same way frame to frame — no popping when a plot relays or an object is
// added. Sorting `a` before `b` means `a` is painted first (further back).

/** Assign zIndex to every footprint-registered child of `layer` so painter's order
 *  respects isometric footprints (multi-tile objects and moving actors alike).
 *  Children without a footprint are ignored (they keep whatever zIndex they had).
 *
 *  Cheap when nothing changed: the whole pass is skipped while no footprint has
 *  changed since this layer was last sorted (and its child count is stable — a
 *  child re-added with an unchanged footprint keeps its still-valid zIndex), and
 *  even when it runs, zIndexes are only written when the paint order actually
 *  moved. That matters beyond CPU: a zIndex write sets Pixi v8's
 *  `structureDidChange`, which throws away the retained render-instruction set
 *  and re-batches the layer, so no-op frames must not touch zIndex at all. */
export function sortLayer(layer: Container) {
  const stamps = layer as unknown as { [SORTED_EPOCH]?: number; [SORTED_COUNT]?: number };
  if (stamps[SORTED_EPOCH] === footprintEpoch
    && stamps[SORTED_COUNT] === layer.children.length) return;
  const kids = layer.children as Container[];
  grow(kids.length);
  let n = 0;
  for (const k of kids) {
    const fp = getFootprint(k);
    if (!fp) continue;
    NODES[n] = k;
    C0[n] = fp.c0; R0[n] = fp.r0; C1[n] = fp.c1; R1[n] = fp.r1;
    KEY[n] = fp.c0 + fp.r0 + fp.bias;
    n++;
  }
  stamps[SORTED_EPOCH] = footprintEpoch;
  stamps[SORTED_COUNT] = layer.children.length;
  if (n === 0) return;

  // How many entities must still be drawn before each one. Exactly the graph the
  // old adjacency-list build produced: for a pair (a<b) the a->b edge wins, so a
  // perpendicular pair (a west of b AND b north of a — both `behind` tests true)
  // contributes a single edge in child order, never a two-cycle.
  for (let i = 0; i < n; i++) INDEG[i] = 0;
  for (let a = 0; a < n; a++) {
    const ac0 = C0[a], ar0 = R0[a], ac1 = C1[a], ar1 = R1[a];
    for (let b = a + 1; b < n; b++) {
      if (ac1 < C0[b] || ar1 < R0[b]) INDEG[b]++;
      else if (C1[b] < ac0 || R1[b] < ar0) INDEG[a]++;
    }
  }

  // Rank every entity by `before` once (depth key, then top-to-bottom, then
  // left-to-right, then child order). Kahn then only ever wants the LOWEST-ranked
  // member of a set, so the per-pick linear scan the old loop did — the dominant
  // cost, ~2/3 of the pass on a 900-entity farm — becomes a find-first-set-bit over
  // two bitsets: `ready` (indegree zero) and `alive` (not yet placed).
  const rank = RANK.subarray(0, n);
  for (let i = 0; i < n; i++) rank[i] = i;
  rank.sort(compareBefore);
  const words = (n + 31) >>> 5;
  for (let w = 0; w < words; w++) { READY[w] = 0; ALIVE[w] = 0; }
  for (let s = 0; s < (words + 31) >>> 5; s++) { READY_SUM[s] = 0; ALIVE_SUM[s] = 0; }
  for (let p = 0; p < n; p++) {
    const i = rank[p];
    POS[i] = p;
    SLOT[i] = p;
    ALIVE_LIST[p] = i;
    setBit(ALIVE, ALIVE_SUM, p);
    if (INDEG[i] === 0) setBit(READY, READY_SUM, p);
  }

  // Kahn's algorithm; among the currently-drawable set pick the one that loads first
  // by `before` (depth key, then top-to-bottom, then left-to-right) so overlapping/
  // perpendicular ties resolve deterministically back-to-front. If a cycle remains
  // (interlocking footprints — rare on a farm) we break it by the same order among
  // all leftovers.
  let aliveN = n;
  for (let out = 0; out < n; out++) {
    let p = firstBit(READY, READY_SUM, words);
    // cycle: force-place the most-behind leftover
    if (p < 0) p = firstBit(ALIVE, ALIVE_SUM, words);
    const pick = rank[p];
    ORDER[out] = pick;
    clearBit(READY, READY_SUM, p);
    clearBit(ALIVE, ALIVE_SUM, p);
    // Swap-remove from the unordered scan list. Its order never matters (the
    // ranking bitsets decide who is picked), only its membership.
    const slot = SLOT[pick];
    const moved = ALIVE_LIST[--aliveN];
    ALIVE_LIST[slot] = moved;
    SLOT[moved] = slot;
    // Release the successors. Recomputing "is there an edge" against the survivors
    // costs the same pair test the adjacency list stored, and saves building (and
    // re-allocating every frame) a list that grows with the square of the farm.
    const pc0 = C0[pick], pr0 = R0[pick], pc1 = C1[pick], pr1 = R1[pick];
    for (let q = 0; q < aliveN; q++) {
      const j = ALIVE_LIST[q];
      if (!(pc1 < C0[j] || pr1 < R0[j])) continue;
      // A perpendicular pair only carries the edge the build above gave it.
      if (pick > j && (C1[j] < pc0 || R1[j] < pr0)) continue;
      if (--INDEG[j] === 0) setBit(READY, READY_SUM, POS[j]);
    }
  }

  // If the current zIndexes already realise this paint order (strictly increasing
  // along it), leave them untouched — writing would needlessly re-batch the layer.
  let increasing = true;
  let last = -Infinity;
  for (let out = 0; out < n; out++) {
    const zi = NODES[ORDER[out]].zIndex;
    if (zi <= last) { increasing = false; break; }
    last = zi;
  }
  if (increasing) return;
  for (let out = 0; out < n; out++) NODES[ORDER[out]].zIndex = out;
}

// ---------------------------------------------------------------------------
// Scratch buffers. sortLayer runs on every frame a footprint moved, so the pass
// allocates nothing: the buffers are grown to the largest layer ever sorted and
// then reused. Only the Container refs are cleared on shrink (a stale reference
// would pin a destroyed sprite); the numeric arrays are fully rewritten each pass.
// ---------------------------------------------------------------------------
let capacity = 0;
let NODES: Container[] = [];
let C0 = new Int32Array(0), R0 = new Int32Array(0);
let C1 = new Int32Array(0), R1 = new Int32Array(0);
let KEY = new Float64Array(0);           // depth key carries the fractional bias
let INDEG = new Int32Array(0);
let ORDER = new Int32Array(0);
let RANK = new Int32Array(0);            // rank -> node index, sorted by `before`
let POS = new Int32Array(0);             // node index -> rank
let SLOT = new Int32Array(0);            // node index -> its ALIVE_LIST slot
let ALIVE_LIST = new Int32Array(0);
let READY = new Uint32Array(0), ALIVE = new Uint32Array(0);
let READY_SUM = new Uint32Array(0), ALIVE_SUM = new Uint32Array(0);

function grow(n: number) {
  if (n <= capacity) {
    for (let i = n; i < NODES.length; i++) NODES[i] = undefined as unknown as Container;
    return;
  }
  capacity = n;
  NODES = new Array<Container>(n);
  C0 = new Int32Array(n); R0 = new Int32Array(n);
  C1 = new Int32Array(n); R1 = new Int32Array(n);
  KEY = new Float64Array(n);
  INDEG = new Int32Array(n);
  ORDER = new Int32Array(n);
  RANK = new Int32Array(n);
  POS = new Int32Array(n);
  SLOT = new Int32Array(n);
  ALIVE_LIST = new Int32Array(n);
  const words = (n + 31) >>> 5;
  READY = new Uint32Array(words); ALIVE = new Uint32Array(words);
  const summary = (words + 31) >>> 5;
  READY_SUM = new Uint32Array(summary); ALIVE_SUM = new Uint32Array(summary);
}

/** `before` over the scratch arrays, as a sort comparator. The final child-order
 *  tie-break is what the old index-ascending scan gave equal-ranked entities. */
function compareBefore(a: number, b: number): number {
  const ka = KEY[a], kb = KEY[b];
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (R0[a] !== R0[b]) return R0[a] - R0[b];
  if (C0[a] !== C0[b]) return C0[a] - C0[b];
  return a - b;
}

function setBit(bits: Uint32Array, summary: Uint32Array, p: number) {
  const w = p >>> 5;
  bits[w] |= 1 << (p & 31);
  summary[w >>> 5] |= 1 << (w & 31);
}

function clearBit(bits: Uint32Array, summary: Uint32Array, p: number) {
  const w = p >>> 5;
  bits[w] &= ~(1 << (p & 31));
  if (bits[w] === 0) summary[w >>> 5] &= ~(1 << (w & 31));
}

/** Lowest set bit, or -1 when empty. The summary layer keeps this O(1) in practice:
 *  one 32-bit word of it covers 1024 entities. */
function firstBit(bits: Uint32Array, summary: Uint32Array, words: number): number {
  const summaries = (words + 31) >>> 5;
  for (let s = 0; s < summaries; s++) {
    const sv = summary[s];
    if (sv === 0) continue;
    const w = (s << 5) + 31 - Math.clz32(sv & -sv);
    const bv = bits[w];
    return (w << 5) + 31 - Math.clz32(bv & -bv);
  }
  return -1;
}
