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
