import { describe, expect, it } from "vitest";
import {
  bindBackdropDismiss, shouldAcceptOnEnter, shouldBlockFreshMenuActivation,
} from "./Modal";

/** Minimal stand-in for a backdrop element: records the listeners so a test can
 * replay a gesture without a DOM (same duck-typing the touch-input tests use). */
function fakeBackdrop() {
  const on: Record<string, ((e: { target: unknown }) => void)[]> = {};
  const bg = {
    addEventListener(type: string, handler: (e: { target: unknown }) => void) {
      (on[type] ??= []).push(handler);
    },
    fire(type: string, target: unknown) {
      for (const h of on[type] ?? []) h({ target });
    },
  };
  return bg;
}

describe("backdrop dismissal", () => {
  it("closes on a click that also pressed the backdrop", () => {
    const bg = fakeBackdrop();
    let closed = 0;
    bindBackdropDismiss(bg, () => closed++);
    bg.fire("pointerdown", bg);
    bg.fire("click", bg);
    expect(closed).toBe(1);
  });

  it("ignores the opening tap's trailing click", () => {
    // The panel is appended under the finger during pointer-up, so the backdrop
    // never saw a press. Dismissing here would close the panel on the very tap
    // that opened it — the mobile "tapping the plot does nothing" bug.
    const bg = fakeBackdrop();
    let closed = 0;
    bindBackdropDismiss(bg, () => closed++);
    bg.fire("click", bg);
    expect(closed).toBe(0);
  });

  it("leaves clicks on the panel inside the backdrop alone", () => {
    const bg = fakeBackdrop();
    const panel = {};
    let closed = 0;
    bindBackdropDismiss(bg, () => closed++);
    bg.fire("pointerdown", panel);
    bg.fire("click", panel);
    expect(closed).toBe(0);
  });

  it("does not let one press arm a second dismissal", () => {
    const bg = fakeBackdrop();
    let closed = 0;
    bindBackdropDismiss(bg, () => closed++);
    bg.fire("pointerdown", bg);
    bg.fire("click", bg);
    bg.fire("click", bg);
    expect(closed).toBe(1);
  });
});

describe("Enter accepts the top dialog", () => {
  const env = (over: Partial<Parameters<typeof shouldAcceptOnEnter>[0]> = {}) => ({
    key: "Enter", repeat: false, ctrlKey: false, metaKey: false, altKey: false,
    focusTag: "", focusEditable: false, focusInsideDialog: false, ...over,
  });

  it("accepts a plain Enter with nothing focused", () => {
    expect(shouldAcceptOnEnter(env())).toBe(true);
  });

  it("accepts Enter typed in a single-line field", () => {
    expect(shouldAcceptOnEnter(env({ focusTag: "input", focusInsideDialog: true }))).toBe(true);
  });

  it("ignores every other key, held repeats and modifier combos", () => {
    expect(shouldAcceptOnEnter(env({ key: "a" }))).toBe(false);
    expect(shouldAcceptOnEnter(env({ repeat: true }))).toBe(false);
    expect(shouldAcceptOnEnter(env({ ctrlKey: true }))).toBe(false);
    expect(shouldAcceptOnEnter(env({ metaKey: true }))).toBe(false);
    expect(shouldAcceptOnEnter(env({ altKey: true }))).toBe(false);
  });

  it("leaves Enter to fields that own it", () => {
    expect(shouldAcceptOnEnter(env({ focusTag: "textarea" }))).toBe(false);
    expect(shouldAcceptOnEnter(env({ focusTag: "select" }))).toBe(false);
    expect(shouldAcceptOnEnter(env({ focusEditable: true }))).toBe(false);
  });

  it("defers to a focused button in the same dialog", () => {
    // The browser already clicks it; accepting too would fire Cancel AND Confirm.
    expect(shouldAcceptOnEnter(env({ focusTag: "button", focusInsideDialog: true }))).toBe(false);
    // A button focused outside the dialog is not the dialog's answer, so the
    // primary action still wins (the handler preventDefaults the native click).
    expect(shouldAcceptOnEnter(env({ focusTag: "button" }))).toBe(true);
  });
});

describe("fresh menu activation guard", () => {
  it("blocks interactive controls during the opening window", () => {
    expect(shouldBlockFreshMenuActivation(1250, 1100, true)).toBe(true);
    expect(shouldBlockFreshMenuActivation(1250, 1250, true)).toBe(false);
    expect(shouldBlockFreshMenuActivation(1250, 1100, false)).toBe(false);
  });
});
