// A ticket purchase raised from an invasion screen has to land ON TOP of it.
//
// The Brain Ticket is bought from the Army screen — that is the only place it can be
// spent, and the button that offers it lives there. But `openModal` gives every modal
// the shared `.panelbg` layer, and the Army screen lifts itself above that, so the
// purchase confirm mounted UNDERNEATH the screen that raised it: to buy a ticket you
// had to back out of the invasion entirely, which defeats the point of offering it.
//
// The Invasion Voucher's identical prompt never showed the bug only because it is raised
// from Raid Select, which is ALSO on the shared layer — equal z-index, so it won on DOM
// order alone. That is not a property worth relying on, hence the explicit rule.
//
// Read from the stylesheet, like the tutorial layering test next door, because nothing
// about the panel logic is wrong: the bug is entirely in the paint order.
import { describe, expect, it } from "vitest";
// The stylesheet has to be read as text: vitest stubs every CSS import to an empty
// module (including `?raw`), and the app has no @types/node to declare this built-in.
// @ts-ignore
import { readFileSync } from "node:fs";

const css: string = readFileSync(new URL("./hud.css", import.meta.url), "utf8");

/** The z-index declared by the rule whose selector list matches `selector` exactly. */
function zIndexOf(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`(^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!rule) throw new Error(`no rule found for selector: ${selector}`);
  const z = /z-index:\s*(-?\d+)/.exec(rule[2]);
  if (!z) throw new Error(`rule has no z-index: ${selector}`);
  return Number(z[1]);
}

describe("invasion stacking order", () => {
  const shared = zIndexOf("#hud .panelbg");
  const army = zIndexOf("#hud .army-bg");
  const ticket = zIndexOf("#hud .raid-ticket-bg");

  it("puts the ticket purchase above the Army screen that raises it", () => {
    expect(ticket).toBeGreaterThan(army);
  });

  it("does not leave the prompt on the shared modal layer", () => {
    // The whole failure: inheriting `.panelbg` put it below the Army screen, and the
    // only reason that looked fine anywhere was the voucher's DOM-order tie on Raid
    // Select. An explicit value is what makes both prompts correct.
    expect(ticket).toBeGreaterThan(shared);
  });

  it("keeps the Army screen itself above the invasion list behind it", () => {
    expect(army).toBeGreaterThan(shared);
  });

  it("stays below the interruptions that must outrank everything", () => {
    // A lost writer lease and the fullscreen prompt speak over any open panel; a
    // purchase confirm must not paint over either.
    expect(ticket).toBeLessThan(zIndexOf("#hud .writer-lock-bg"));
    expect(ticket).toBeLessThan(zIndexOf("#hud .fullscreen-prompt-bg"));
  });
});
