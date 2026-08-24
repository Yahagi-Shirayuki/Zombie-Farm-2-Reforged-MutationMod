// Textures that did not load, counted rather than swallowed.
//
// WHY. The raid scene's `loadTex` — the loader behind every texture a battle draws —
// catches everything and returns `null`, and every caller carries on without it. That is
// the right behaviour (a missing decoration must not cost the player the fight) and it is
// also how a three-second stall on a URL that could never exist went unseen through an
// entire beta: the failure was invisible from inside the game AND from the bug report.
//
// So failures are TALLIED. Not logged one per crumb: a battle entered with no connection
// can fail thirty textures in a second, and thirty crumbs would push the trail that
// explains them straight out of the ring. The count and the first URL are what a report
// needs; the rest are the same story repeated.
import { crumb } from "./breadcrumbs";

/** How many failures leave a crumb of their own before the tally takes over. The first is
 *  the informative one — it names the URL at the moment it happened. */
const CRUMBED_FAILURES = 2;

let failures = 0;
let firstUrl = "";
let lastUrl = "";

/** Record one texture that would not load. Never throws — it is called from inside the
 *  catch of a loader that is already having a bad time. */
export function noteAssetFailure(url: string): void {
  failures++;
  if (!firstUrl) firstUrl = url;
  lastUrl = url;
  if (failures <= CRUMBED_FAILURES) crumb("asset:fail", url);
  else if (failures === CRUMBED_FAILURES + 1) crumb("asset:fail", "…further failures counted only");
}

export interface AssetFailureTally {
  count: number;
  firstUrl: string;
  lastUrl: string;
}

export function assetFailures(): AssetFailureTally {
  return { count: failures, firstUrl, lastUrl };
}

/** One line for the diagnostics report. */
export function assetFailureLine(): string {
  if (!failures) return "none";
  const also = failures > 1 && lastUrl !== firstUrl ? `, latest ${lastUrl}` : "";
  return `${failures} failed (first ${firstUrl}${also})`;
}

/** Test seam. Deliberately NOT called when a report is copied: a player who copies a
 *  report, keeps playing, and copies again should still see the earlier failures. */
export function resetAssetFailures(): void {
  failures = 0;
  firstUrl = "";
  lastUrl = "";
}
