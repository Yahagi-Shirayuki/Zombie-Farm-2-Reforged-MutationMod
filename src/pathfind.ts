// 8-neighbour A* on the tile grid. Placed objects and fence panels are the
// blockers (see Field.isPassable); plots and bare ground are walkable.
//
// Actors can end up STANDING on a blocked tile — a bought zombie lands on a tile
// an object already covers, or an object is moved on top of one that was standing
// there. A plain A* from such a tile finds nothing (every neighbour inside a
// multi-tile object is blocked too) and the actor is stuck for good. So a search
// that starts inside an obstruction first walks OUT through it, then paths
// normally from the open ground it reaches.
export interface Cell {
  col: number;
  row: number;
}

type Passable = (col: number, row: number) => boolean;

export interface PathOptions {
  /** Bounds the escape search when the start tile is blocked — without it the
   *  search drifts off the field, where nothing is ever walkable. */
  inBounds?: Passable;
  /** How far, in tiles, an escape may look for open ground. Comfortably clears
   *  the largest placeable (10x10) from anywhere inside it. */
  escapeRadius?: number;
}

const DEFAULT_ESCAPE_RADIUS = 16;

const NEIGHBORS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Cell key. The offset keeps negative coordinates (which the escape search can
// probe on its way around a corner) packing and unpacking correctly.
const KEY_SPAN = 100000;
const KEY_OFFSET = 50000;

function key(c: number, r: number) {
  return (c + KEY_OFFSET) * KEY_SPAN + (r + KEY_OFFSET);
}

function unkey(k: number): Cell {
  return { col: Math.floor(k / KEY_SPAN) - KEY_OFFSET, row: (k % KEY_SPAN) - KEY_OFFSET };
}

// Walk `came` back from `endK` to `startK`, returning the cells after the start
// in travel order (the start itself is where the actor already stands).
function reconstruct(came: Map<number, number>, startK: number, endK: number): Cell[] {
  const path: Cell[] = [];
  let k = endK;
  while (k !== startK) {
    path.push(unkey(k));
    const prev = came.get(k);
    if (prev === undefined) break;
    k = prev;
  }
  path.reverse();
  return path;
}

/** The shortest run of tiles from a blocked `start` to the nearest walkable tile,
 *  passing only through blocked tiles on the way. Empty when `start` is already
 *  walkable, or when no open ground lies within the escape radius. */
export function findEscape(
  start: Cell,
  passable: Passable,
  opts: PathOptions = {}
): Cell[] {
  if (passable(start.col, start.row)) return [];
  const inBounds = opts.inBounds ?? (() => true);
  const radius = opts.escapeRadius ?? DEFAULT_ESCAPE_RADIUS;
  const startK = key(start.col, start.row);
  const came = new Map<number, number>();
  const seen = new Set<number>([startK]);
  let frontier: Cell[] = [start];

  // Breadth-first, so the first walkable tile reached is the closest way out —
  // and every tile before it is blocked, i.e. still inside the obstruction.
  while (frontier.length) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      const ck = key(cell.col, cell.row);
      for (const [dc, dr] of NEIGHBORS) {
        const nc = cell.col + dc;
        const nr = cell.row + dr;
        if (Math.abs(nc - start.col) > radius || Math.abs(nr - start.row) > radius) continue;
        if (!inBounds(nc, nr)) continue;
        const nk = key(nc, nr);
        if (seen.has(nk)) continue;
        seen.add(nk);
        came.set(nk, ck);
        if (passable(nc, nr)) return reconstruct(came, startK, nk);
        next.push({ col: nc, row: nr });
      }
    }
    frontier = next;
  }
  return [];
}

// Plain A* between two walkable tiles.
function search(start: Cell, goal: Cell, passable: Passable): Cell[] {
  if (start.col === goal.col && start.row === goal.row) return [];

  const open = new Map<number, Cell>();
  const came = new Map<number, number>();
  const g = new Map<number, number>();
  const startK = key(start.col, start.row);
  open.set(startK, start);
  g.set(startK, 0);

  const h = (c: number, r: number) =>
    Math.max(Math.abs(c - goal.col), Math.abs(r - goal.row));

  while (open.size) {
    // pick lowest f = g + h
    let bestK = -1;
    let bestF = Infinity;
    let best: Cell | null = null;
    for (const [k, cell] of open) {
      const f = (g.get(k) ?? Infinity) + h(cell.col, cell.row);
      if (f < bestF) {
        bestF = f;
        bestK = k;
        best = cell;
      }
    }
    if (!best) break;

    if (best.col === goal.col && best.row === goal.row) {
      return reconstruct(came, startK, bestK);
    }

    open.delete(bestK);
    for (const [dc, dr] of NEIGHBORS) {
      const nc = best.col + dc;
      const nr = best.row + dr;
      if (!passable(nc, nr)) continue;
      // disallow cutting diagonally between two blocked orthogonals
      if (dc !== 0 && dr !== 0) {
        if (!passable(best.col + dc, best.row) || !passable(best.col, best.row + dr))
          continue;
      }
      const nk = key(nc, nr);
      const step = dc !== 0 && dr !== 0 ? 1.4142 : 1;
      const tentative = (g.get(bestK) ?? Infinity) + step;
      if (tentative < (g.get(nk) ?? Infinity)) {
        came.set(nk, bestK);
        g.set(nk, tentative);
        if (!open.has(nk)) open.set(nk, { col: nc, row: nr });
      }
    }
  }
  return [];
}

/** Route from `start` to `goal` as tile waypoints (excluding `start`). Empty when
 *  the goal is blocked or unreachable.
 *
 *  When `start` itself is blocked the route begins with an escape THROUGH the
 *  obstruction. If the goal still can't be reached from the far side, the escape
 *  alone is returned — getting the actor onto open ground beats leaving it stuck,
 *  and it can pick a fresh destination from there. */
export function findPath(
  start: Cell,
  goal: Cell,
  passable: Passable,
  opts: PathOptions = {}
): Cell[] {
  if (!passable(goal.col, goal.row)) return [];
  if (start.col === goal.col && start.row === goal.row) return [];

  if (!passable(start.col, start.row)) {
    const escape = findEscape(start, passable, opts);
    if (!escape.length) return [];
    const exit = escape[escape.length - 1];
    if (exit.col === goal.col && exit.row === goal.row) return escape;
    const rest = search(exit, goal, passable);
    return rest.length ? [...escape, ...rest] : escape;
  }

  return search(start, goal, passable);
}
