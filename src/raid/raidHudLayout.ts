import type { SafeAreaInsets } from "../safeArea";

export interface RaidHudLayout {
  barWidth: number;
  leftBarX: number;
  rightBarX: number;
  topY: number;
  topHudHeight: number;
  faceY: number;
  leftFaceX: number;
  rightFaceX: number;
  retreatRightMargin: number;
  retreatBottomMargin: number;
  /** Left edge both ability strips align to (they share the health bar's margin). */
  abilityLeft: number;
  hidePortraits: boolean;
}

/** Vertical pitch of the activated-ability button column, in CSS pixels.
 *
 *  The column is anchored at the FIRST button's centre (`columnTop`) and grows down,
 *  so the last button's bottom edge sits at `columnTop + (buttons - 1) * step +
 *  radius` and has to clear `bottomLimit` (the viewport less its bottom safe-area
 *  inset, less a small margin).
 *
 *  Why this is a function and not just a constant: un-stacking Bash and Smash took the
 *  worst case from three buttons to four, and four at the authored 64 px pitch reach
 *  355 px down a 375 px-tall landscape viewport — inside the screen, but not inside the
 *  ~21 px the home indicator takes off the bottom of it. Rather than re-stack a pair
 *  that is a real choice, the column tightens: short columns keep the authored spacing
 *  (the pitch is capped at `maxStep`) and only a column that would otherwise overhang
 *  pays anything.
 *
 *  The floor is `2 * radius + 2` — one pixel of air between neighbouring buttons. Below
 *  that they would overlap, and a stack of overlapping thumb targets is worse than a
 *  column that runs off a viewport too short to hold it either way, so it clamps and
 *  lets the overflow happen rather than pretending it fits. */
export function abilityColumnStep(
  buttons: number,
  columnTop: number,
  bottomLimit: number,
  radius: number,
  maxStep: number,
): number {
  if (buttons < 2) return maxStep;
  const room = bottomLimit - radius - columnTop;
  return Math.max(2 * radius + 2, Math.min(maxStep, room / (buttons - 1)));
}

/** Responsive positions for Pixi raid chrome, expressed in CSS pixels. */
export function computeRaidHudLayout(
  width: number,
  height: number,
  safe: SafeAreaInsets,
  mobile: boolean,
): RaidHudLayout {
  const screenMargin = width * 0.05;
  const leftMargin = Math.max(screenMargin, safe.left + 8);
  const rightMargin = Math.max(screenMargin, safe.right + 8);
  const centerGap = 56;
  const availableBarWidth = Math.max(72, (width - leftMargin - rightMargin - centerGap) / 2);
  const barWidth = Math.min(width * 0.32, 350, availableBarWidth);
  const barHeight = 17;
  const topY = Math.max(9, height * 0.04, safe.top + 9);
  const topHudHeight = Math.max(62, topY + barHeight + 26);

  return {
    barWidth,
    leftBarX: leftMargin,
    rightBarX: width - rightMargin - barWidth,
    topY,
    topHudHeight,
    faceY: topY + barHeight / 2 + 3,
    leftFaceX: Math.max(safe.left + 25, leftMargin - 27),
    rightFaceX: Math.min(width - safe.right - 25, width - rightMargin + 27),
    retreatRightMargin: rightMargin,
    retreatBottomMargin: safe.bottom + 18,
    abilityLeft: leftMargin,
    hidePortraits: mobile && height > width,
  };
}
