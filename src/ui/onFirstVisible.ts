// Defer per-card work until the card is actually on screen.
//
// Several HUD panels build one tile per owned zombie and immediately ask for that
// unit's mutation-aware portrait. Each portrait costs a blocking GPU readback (see
// zombie/mutationPortrait.ts), and the lists that need them scroll: the Zombie Pot's
// picker shows ~18 of a 50-zombie roster at a time, so two thirds of that work was
// spent on tiles the player never scrolled to. Requesting them only once a tile
// intersects the viewport removes that work entirely rather than merely spreading it.
//
// The observer's root is the viewport, not the scroll container, which is what we
// want: intersection with the viewport already accounts for clipping by any ancestor
// scroller, so one shared observer serves every panel.

/** Look ahead by roughly one row so a tile is ready by the time it scrolls in. */
const ROOT_MARGIN = "128px";

const waiting = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null; // jsdom / older engines
  if (!observer) {
    observer = new IntersectionObserver((entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const run = waiting.get(entry.target);
        if (!run) continue; // already fired — nothing left to do for this element
        // Unobserve before running so a callback that rebuilds the list cannot be
        // re-entered for an element that is on its way out of the DOM.
        waiting.delete(entry.target);
        self.unobserve(entry.target);
        run();
      }
    }, { rootMargin: ROOT_MARGIN });
  }
  return observer;
}

/**
 * Run `task` the first time `element` is (nearly) visible, and never again.
 *
 * Safe to call before the element is inserted into the document — it simply stays
 * pending until it is attached and scrolled into view. Where IntersectionObserver
 * is unavailable the task runs immediately, preserving the previous eager
 * behaviour rather than silently dropping the work.
 */
export function onFirstVisible(element: Element, task: () => void): void {
  const active = sharedObserver();
  if (!active) {
    task();
    return;
  }
  waiting.set(element, task);
  active.observe(element);
}

/** Drop a pending task for an element that is being discarded. Tests use this;
 *  production relies on the observer holding only a weak reference. */
export function cancelFirstVisible(element: Element): void {
  waiting.delete(element);
  observer?.unobserve(element);
}
