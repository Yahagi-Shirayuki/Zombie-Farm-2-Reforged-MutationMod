// The corner X must never be cut in half by the panel it closes.
//
// Every closeable menu draws the same button in the same corner, and it kept
// coming back cropped: a close button positioned OUTSIDE its panel's box is
// clipped the instant that panel becomes a scroll container, and panels on the
// shared modal layer become scroll containers all the time — Settings, the
// friends list, raid select, the Farmer's Guide and the Almanac's field-note
// pages each grow past the viewport on their own, and the touch layout makes a
// scroller out of EVERY `.panelbg > .panel`. Each one was patched individually
// as the clipping was spotted, which is why the Almanac page shipped cropped:
// it was simply the panel nobody had thought to patch yet.
//
// The fix was to stop relying on anyone remembering. `.panelclose` — the button
// every shared modal builds (see Modal.ts) — now sits INSIDE the corner by
// default, so no panel can crop it however it scrolls. The four hand-built
// market-parchment panels keep the authentic overhanging X, and stay safe for a
// different reason: they are fixed-size flex columns whose inner lists scroll,
// so the panel element itself never clips.
//
// These two rules are what this test guards. Read from the stylesheet like the
// layering tests next door, because nothing about the panel logic is wrong —
// the bug lives entirely in the CSS box the button is positioned against.
import { describe, expect, it } from "vitest";
// The stylesheet has to be read as text: vitest stubs every CSS import to an
// empty module (including `?raw`), and the app has no @types/node to declare
// this built-in.
// @ts-ignore
import { readFileSync } from "node:fs";

const css: string = readFileSync(new URL("./hud.css", import.meta.url), "utf8");

interface Rule { selector: string; body: string }

/** Every declaration block in the sheet, media preludes flattened away. A
 *  media-scoped rule clips exactly as hard as an unscoped one, so the invariant
 *  has to hold for both and the query itself carries nothing worth keeping. */
function rules(): Rule[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@media[^{]*\{/g, "")
    .split("}")
    .map((chunk) => chunk.split("{"))
    .filter((parts) => parts.length === 2)
    .map(([selector, body]) => ({ selector: selector.trim(), body }));
}

const ALL = rules();

/** Rules whose selector list mentions `cls` anywhere. */
function mentioning(cls: string): Rule[] {
  const at = new RegExp(`\\.${cls}(?![\\w-])`);
  return ALL.filter((r) => at.test(r.selector));
}

/** The offsets `body` pushes outside the positioned box, e.g. `top: -16px`. */
function overhangs(body: string): string[] {
  const out: string[] = [];
  const decl = /(top|right|bottom|left|inset)\s*:\s*([^;]+)/g;
  for (let m = decl.exec(body); m; m = decl.exec(body))
    if (/-\d/.test(m[2])) out.push(`${m[1]}: ${m[2].trim()}`);
  return out;
}

/** Whether any selector in `r`'s list ends in an element carrying `cls` — i.e.
 *  the rule styles that element itself rather than something inside it. */
function targets(r: Rule, cls: string): boolean {
  return r.selector.split(",").some((one) => {
    const last = one.trim().split(/\s*[>+~]\s*|\s+/).pop() ?? "";
    const classes: string[] = last.match(/\.[\w-]+/g) ?? [];
    return classes.includes(`.${cls}`);
  });
}

/** Whether `body` turns the element into something that clips its own corner. */
function clips(body: string): boolean {
  const decl = /overflow(?:-x|-y)?\s*:\s*([\w-]+)/g;
  for (let m = decl.exec(body); m; m = decl.exec(body))
    if (m[1] !== "visible") return true;
  return false;
}

describe("corner close buttons stay whole", () => {
  it("keeps the shared modal X inside the panel, in every layout", () => {
    // The one rule that makes the bug structurally impossible for the ~25
    // dialogs built by openModal. A negative offset here is the whole defect:
    // it survives only until some panel three refactors away starts scrolling.
    const outside = mentioning("panelclose")
      .filter((r) => overhangs(r.body).length)
      .map((r) => `${r.selector} { ${overhangs(r.body).join("; ")} }`);
    expect(outside).toEqual([]);
  });

  // The hand-built parchment panels and the button each one owns. Pairing them
  // here is the point: it is what lets the next test check the panel that would
  // do the clipping rather than the button that gets clipped.
  const PARCHMENT: [button: string, panel: string][] = [
    ["mkt-close", "mkt"],
    ["st-close", "st"],
    ["info-close", "info-box"],
    ["pm-close", "pm"],
  ];

  for (const [button, panel] of PARCHMENT) {
    it(`does not let .${panel} clip the X hanging off its corner`, () => {
      const hangs = mentioning(button).some((r) => overhangs(r.body).length);
      if (!hangs) return; // tucked in like `.panelclose`: nothing left to clip it

      const clipping = ALL
        .filter((r) => targets(r, panel) && clips(r.body))
        .map((r) => r.selector);
      expect(clipping).toEqual([]);
    });
  }

  it("still finds the buttons it claims to be checking", () => {
    // A typo in a class name would make every assertion above vacuously pass.
    expect(mentioning("panelclose").length).toBeGreaterThan(0);
    for (const [button, panel] of PARCHMENT) {
      expect(mentioning(button).length, button).toBeGreaterThan(0);
      expect(ALL.some((r) => targets(r, panel)), panel).toBe(true);
    }
  });
});
