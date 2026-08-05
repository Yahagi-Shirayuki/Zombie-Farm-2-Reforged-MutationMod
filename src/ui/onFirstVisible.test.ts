import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps one shared observer, so each test imports it fresh against its
// own IntersectionObserver stub.
type Entry = { target: object; isIntersecting: boolean };
type Fake = {
  observed: object[];
  unobserved: object[];
  fire: (entries: Entry[]) => void;
};

const install = (): Fake => {
  const state: Fake = { observed: [], unobserved: [], fire: () => {} };
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: Entry[], self: unknown) => void) {
      state.fire = (entries) => callback(entries, this);
    }
    observe(element: object) { state.observed.push(element); }
    unobserve(element: object) { state.unobserved.push(element); }
    disconnect() { /* unused */ }
  });
  return state;
};

const load = async () => {
  vi.resetModules();
  return import("./onFirstVisible");
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("onFirstVisible", () => {
  it("holds the task until the element intersects", async () => {
    const fake = install();
    const { onFirstVisible } = await load();
    const element = { id: "card" };
    const task = vi.fn();

    onFirstVisible(element as unknown as Element, task);
    expect(task).not.toHaveBeenCalled();
    expect(fake.observed).toEqual([element]);

    fake.fire([{ target: element, isIntersecting: false }]);
    expect(task).not.toHaveBeenCalled();

    fake.fire([{ target: element, isIntersecting: true }]);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs a task at most once and stops observing", async () => {
    const fake = install();
    const { onFirstVisible } = await load();
    const element = { id: "card" };
    const task = vi.fn();

    onFirstVisible(element as unknown as Element, task);
    fake.fire([{ target: element, isIntersecting: true }]);
    fake.fire([{ target: element, isIntersecting: true }]);

    expect(task).toHaveBeenCalledTimes(1);
    expect(fake.unobserved).toEqual([element]);
  });

  it("falls back to running immediately where IntersectionObserver is missing", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { onFirstVisible } = await load();
    const task = vi.fn();

    onFirstVisible({ id: "card" } as unknown as Element, task);

    expect(task).toHaveBeenCalledTimes(1);
  });
});
