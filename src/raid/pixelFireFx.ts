// The flame that sits on a zombie Zedzox has set alight (`pixelFire`, raid 9).
//
// Drawn entirely out of SQUARES, on a coarse grid, stepping on its own low frame rate —
// because the raid it belongs to is the Video Games one, whose whole cast is pre-rendered
// pixel art. A smooth particle plume would be the one thing on that stage that isn't made
// of blocks. Everything here is therefore quantised: cell positions to the grid, colours to
// a five-step ramp, and time to FIRE_FPS.
//
// No textures and no particle system: a Graphics per burning zombie, rebuilt each animation
// frame. At most a handful burn at once (pixelFire converts one zombie per cast and they
// burn for a few seconds), and a flame is ~30 rects, so this stays far below the cost of the
// rigs it sits on top of.
import { Container, Graphics, Rectangle } from "pixi.js";

/** The fire's own frame rate. Low and fixed — a pixel-art flame flips between drawn
 *  frames, it does not interpolate. */
const FIRE_FPS = 12;

/** Flame body: this many columns of squares, this many cells tall at full height. Seven
 *  rather than five because five drew a flame narrower than a zombie's head, which reads as
 *  a candle balanced on top of it; the two extra stubs widen the base so the head looks
 *  engulfed. */
const COLS = 7;
const MAX_ROWS = 9;

/** The colour ramp, hottest first. Cells pick from it by height AND by how far out from the
 *  middle they sit (see `edge` below), so the flame has a white-hot core running up its
 *  centre and cools to deep red at the tips and along the outside — the ramp an 8-bit fire
 *  is always drawn with. Colouring by height alone paints a solid white bar across the
 *  bottom row, which reads as a mound rather than a flame. */
const RAMP = [0xfff6c8, 0xffd23f, 0xff9421, 0xef4b1f, 0xa32116] as const;

/** Per-column shape. `base` is the resting height in cells, `speed`/`phase` set how its
 *  tongue licks up and down, and `edge` is how many steps down the ramp that column starts
 *  — 0 in the middle, so only the core ever runs white. The middle column is the tallest
 *  and slowest, the outer ones short and quick, which is what makes the silhouette read as
 *  fire rather than as a bar chart. Hand-set rather than random so every flame in the game
 *  animates identically — they are all the same authored effect. */
const COLUMNS: { base: number; amp: number; speed: number; phase: number; edge: number }[] = [
  { base: 1, amp: 1, speed: 8.1, phase: 5.2, edge: 3 },
  { base: 3, amp: 1, speed: 7.3, phase: 0.0, edge: 2 },
  { base: 5, amp: 2, speed: 5.1, phase: 1.7, edge: 1 },
  { base: 7, amp: 2, speed: 4.2, phase: 3.1, edge: 0 },
  { base: 5, amp: 2, speed: 5.9, phase: 4.6, edge: 1 },
  { base: 3, amp: 1, speed: 6.7, phase: 2.2, edge: 2 },
  { base: 1, amp: 1, speed: 7.7, phase: 3.9, edge: 3 },
];

/** Embers: single squares that break off the tip and drift up before winking out. Each is a
 *  fixed column + timing offset, so they too are the same every time. Kept over the middle
 *  three columns, where the flame is actually tall enough to be throwing any. */
const EMBERS: { col: number; period: number; phase: number; drift: number }[] = [
  { col: 2, period: 0.9, phase: 0.0, drift: -1 },
  { col: 4, period: 1.1, phase: 0.45, drift: 1 },
  { col: 3, period: 1.4, phase: 0.8, drift: 0 },
];

/** One zombie's fire. Owns its Graphics and is the tap target that puts it out — the whole
 *  flame is the button, which is the only reading a player will try. */
export class PixelFire {
  readonly view = new Container();
  private readonly g = new Graphics();
  /** Animation clock, advanced continuously but only ever SAMPLED on a frame boundary. */
  private time = 0;
  private drawnFrame = -1;
  private drawnCell = 0;

  constructor(onTap: () => void) {
    this.view.addChild(this.g);
    this.view.eventMode = "static";
    this.view.cursor = "pointer";
    this.view.on("pointertap", onTap);
  }

  /** Advance and redraw. `cell` is the size of one square in screen px — the caller scales
   *  it with the stage so the flame stays the same size relative to the zombie wearing it.
   *  `fade` (0..1) dims the whole flame as the burn runs out, so a fire about to go out
   *  looks like one.
   *
   *  Redrawing is skipped unless the animation frame or the cell size actually changed:
   *  at FIRE_FPS that is most render frames, and a Graphics rebuild is the only real cost
   *  in here. */
  update(dtSec: number, cell: number, fade: number): void {
    this.time += dtSec;
    const frame = Math.floor(this.time * FIRE_FPS);
    if (frame === this.drawnFrame && cell === this.drawnCell) {
      this.view.alpha = fade;
      return;
    }
    this.drawnFrame = frame;
    this.drawnCell = cell;
    this.view.alpha = fade;
    // An explicit hit area rather than the drawn geometry's bounds. The flame is small and
    // its silhouette changes every frame, so hit-testing the shape itself would give the
    // player a target that flickers in and out from under a thumb. This is a fixed, roomy
    // box around the whole flame — the fire is meant to be easy to beat out, and on a phone
    // that means it has to be at least thumb-sized.
    const w = (COLS + 2) * cell;
    const h = (MAX_ROWS + 2) * cell;
    this.view.hitArea = new Rectangle(-w / 2, -h, w, h + cell * 2);
    // Sample the shape on the frame boundary, not at the true time — that is what makes
    // the flame step instead of slide.
    const t = frame / FIRE_FPS;

    const g = this.g;
    g.clear();
    const left = -(COLS * cell) / 2;
    for (let c = 0; c < COLS; c++) {
      const spec = COLUMNS[c];
      const rows = Math.max(
        1,
        Math.min(MAX_ROWS, Math.round(spec.base + spec.amp * Math.sin(t * spec.speed + spec.phase)))
      );
      for (let r = 0; r < rows; r++) {
        // 0 at the base of this tongue, 1 at its tip — so a short tongue still runs the
        // full ramp rather than sitting at one temperature. `edge` then pushes the whole
        // column down the ramp, which is what keeps the white to the core.
        const up = rows === 1 ? 1 : r / (rows - 1);
        const step = Math.round(up * (RAMP.length - 1)) + spec.edge;
        const shade = RAMP[Math.max(0, Math.min(RAMP.length - 1, step))];
        g.rect(left + c * cell, -(r + 1) * cell, cell, cell).fill({ color: shade });
      }
    }
    for (const e of EMBERS) {
      // 0..1 through this ember's life, then a gap before it repeats.
      const life = ((t + e.phase) % e.period) / e.period;
      if (life > 0.7) continue; // winked out; wait for the next one
      const rise = MAX_ROWS + Math.round(life * 4);
      const drift = Math.round(life * e.drift);
      g.rect(
        left + (e.col + drift) * cell,
        -rise * cell,
        cell,
        cell
      ).fill({ color: life < 0.35 ? RAMP[1] : RAMP[3], alpha: 1 - life / 0.7 });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
