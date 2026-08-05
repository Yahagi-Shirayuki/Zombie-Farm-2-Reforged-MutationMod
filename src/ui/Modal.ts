// Shared modal/panel scaffold. Nearly every HUD dialog hand-built the same
// `.panelbg > .panel > .panelclose` structure with a backdrop-click-to-close
// handler; that boilerplate was copied ~25 times. `openModal` builds exactly
// that DOM (identical tags, class names and child order, so the existing CSS in
// hud.css applies unchanged) and returns handles to the pieces the caller fills
// in. A single idempotent `close()` covers the close button, the backdrop click
// and any programmatic dismissal.
import { UI } from "./uiAsset";

export const MENU_ACTIVATION_DELAY_MS = 250;

/** A compatibility click synthesized from the farm tap must not activate a
 * control that only came into existence when that tap opened a menu. */
export function shouldBlockFreshMenuActivation(
  interactiveAt: number,
  now: number,
  hasInteractiveTarget: boolean,
): boolean {
  return hasInteractiveTarget && now < interactiveAt;
}

/** The slice of a backdrop element `bindBackdropDismiss` needs, so the guard can
 * be exercised without a DOM. */
export interface BackdropElement {
  addEventListener(type: string, handler: (e: { target: unknown }) => void): void;
}

/**
 * Close `bg` when the backdrop itself is clicked — but only if that click's
 * press also landed on the backdrop.
 *
 * Panels opened straight from a farm tap (the plant picker, zombie info, crop
 * info, object actions…) append a full-screen `inset: 0` backdrop while the
 * finger is still on the glass, during the very `pointerup` that opened them.
 * The tap's trailing compatibility `click` then lands on that brand-new backdrop
 * and dismisses the panel before the player ever sees it — which reads on a
 * phone as "tapping the plot does nothing". Requiring a `pointerdown` on the
 * backdrop closes that hole without any timing heuristics: a backdrop that did
 * not exist when the finger went down cannot have received the press.
 */
export function bindBackdropDismiss(bg: BackdropElement, close: () => void): void {
  let pressed = false;
  bg.addEventListener("pointerdown", (e) => { pressed = e.target === bg; });
  bg.addEventListener("click", (e) => {
    if (!pressed || e.target !== bg) return;
    pressed = false;
    close();
  });
}

export interface ModalHandle {
  /** The `.panelbg` backdrop element (already appended to the host). */
  bg: HTMLElement;
  /** The `.panel` container — append your body content here. */
  panel: HTMLElement;
  /** Remove the modal and fire `onClose` once (safe to call repeatedly). */
  close: () => void;
}

export interface ModalOpts {
  /** Where to append the backdrop (the HUD root element). */
  host: HTMLElement;
  /** Extra class(es) added to `.panel` (e.g. "confirm-panel", "obj-actions"). */
  panelClass?: string;
  /** Extra class(es) added to `.panelbg` (e.g. "game-confirm-bg", "raid-bg"). */
  bgClass?: string;
  /** Optional `<h2>` heading rendered right after the close button. */
  title?: string;
  /** Render the corner close button (default true). */
  closeButton?: boolean;
  /** Close when the backdrop (outside the panel) is clicked (default true). */
  backdropClose?: boolean;
  /** Fired once, whenever the modal closes by any path. */
  onClose?: () => void;
  /**
   * Before opening, remove an existing element matching this selector within
   * `host`. Used by singleton dialogs (e.g. the confirm window) to avoid stacking.
   */
  replaceSelector?: string;
}

/** Each open backdrop's own `close`, so a replacement can retire it properly. */
const closers = new WeakMap<Element, () => void>();

export function openModal(opts: ModalOpts): ModalHandle {
  const { host } = opts;
  if (opts.replaceSelector) {
    // Retire the outgoing modal through ITS handle, not a bare remove(): dropping
    // the element alone skips its onClose, stranding whatever that callback owns.
    // confirmInGame resolves its promise there, so a bare remove left the caller's
    // `await` pending forever — the dedupe silently wedged the flow it replaced.
    const stale = host.querySelector(opts.replaceSelector);
    if (stale) {
      const retire = closers.get(stale);
      closers.delete(stale);
      retire?.();
      stale.remove(); // no-op once close() detached it; covers handle-less elements
    }
    // An onClose may synchronously open its own successor (the quest-completion
    // chain does). Keep the class a singleton so this open cannot stack on it.
    for (const leftover of host.querySelectorAll(opts.replaceSelector)) {
      closers.delete(leftover);
      leftover.remove();
    }
  }

  const bg = document.createElement("div");
  bg.className = opts.bgClass ? `panelbg ${opts.bgClass}` : "panelbg";
  const panel = document.createElement("div");
  panel.className = opts.panelClass ? `panel ${opts.panelClass}` : "panel";

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    closers.delete(bg);
    bg.remove();
    opts.onClose?.();
  };

  if (opts.closeButton !== false) {
    const x = document.createElement("button");
    x.className = "panelclose";
    const xi = document.createElement("img");
    xi.src = UI("button_close.png");
    x.appendChild(xi);
    x.onclick = () => close();
    panel.appendChild(x);
  }

  if (opts.title != null) {
    const h = document.createElement("h2");
    h.textContent = opts.title;
    panel.appendChild(h);
  }

  bg.appendChild(panel);
  if (opts.backdropClose !== false) bindBackdropDismiss(bg, close);
  host.appendChild(bg);
  closers.set(bg, close);
  return { bg, panel, close };
}
