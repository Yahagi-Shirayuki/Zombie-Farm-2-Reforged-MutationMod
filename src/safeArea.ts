export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

let probe: HTMLDivElement | null = null;
let cachedInsets = ZERO_INSETS;
let dirty = true;
let listening = false;

const markDirty = () => { dirty = true; };

/**
 * Read CSS environment safe-area values for canvas-rendered UI. CSS can consume
 * env(safe-area-inset-*) directly, but Pixi needs the resolved CSS-pixel values.
 */
export function readSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === "undefined" || !document.body) return ZERO_INSETS;

  if (!listening) {
    window.addEventListener("resize", markDirty);
    window.addEventListener("orientationchange", markDirty);
    window.visualViewport?.addEventListener("resize", markDirty);
    listening = true;
  }
  if (!dirty) return cachedInsets;

  if (!probe) {
    probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = [
      "position:fixed",
      "width:0",
      "height:0",
      "visibility:hidden",
      "pointer-events:none",
      "padding-top:env(safe-area-inset-top, 0px)",
      "padding-right:env(safe-area-inset-right, 0px)",
      "padding-bottom:env(safe-area-inset-bottom, 0px)",
      "padding-left:env(safe-area-inset-left, 0px)",
    ].join(";");
    document.body.appendChild(probe);
  }

  const style = getComputedStyle(probe);
  const px = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };
  cachedInsets = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
  dirty = false;
  return cachedInsets;
}
