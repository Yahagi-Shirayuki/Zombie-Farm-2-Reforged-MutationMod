import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetViewState, keepScroll, recall, recallNumber, recallOneOf, remember,
  type ScrollBox,
} from "./viewState";

// A stand-in for a scroll container: `limit` is how far its content actually allows
// scrolling right now, so a list that is still filling in clamps the restore exactly
// the way a real element does.
class FakeBox implements ScrollBox {
  isConnected = true;
  limit: number;
  private top = 0;
  private listeners: (() => void)[] = [];
  constructor(limit = Infinity) { this.limit = limit; }
  get scrollTop() { return this.top; }
  set scrollTop(value: number) {
    this.top = Math.max(0, Math.min(value, this.limit));
    for (const listener of this.listeners) listener();
  }
  addEventListener(_type: "scroll", listener: () => void) { this.listeners.push(listener); }
  /** The player dragging the list themselves. */
  scrollBy(to: number) { this.scrollTop = to; }
}

const fakeSession = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    raw: data,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("sessionStorage", fakeSession());
  forgetViewState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("remembered values", () => {
  it("round-trips numbers and strings", () => {
    remember("market.page", 14);
    remember("market.tab", "Items");
    expect(recallNumber("market.page")).toBe(14);
    expect(recall("market.tab")).toBe("Items");
  });

  it("falls back when nothing was remembered", () => {
    expect(recallNumber("nope", 3)).toBe(3);
    expect(recall("nope")).toBeUndefined();
  });

  it("rejects a remembered choice the panel no longer offers", () => {
    remember("market.tab", "Pets");
    expect(recallOneOf("market.tab", ["Crops", "Pets"] as const, "Crops")).toBe("Pets");
    expect(recallOneOf("market.tab", ["Crops", "Items"] as const, "Crops")).toBe("Crops");
  });

  it("mirrors into sessionStorage once the debounce elapses", () => {
    remember("market.page", 7);
    vi.runAllTimers();
    const stored = JSON.parse(sessionStorage.getItem("zf2r.viewState")!);
    expect(stored["market.page"]).toBe("7");
  });
});

describe("keepScroll", () => {
  it("restores where the player was and keeps tracking", () => {
    const first = new FakeBox(1000);
    keepScroll(first, "pot.list");
    first.scrollBy(420);

    // The panel is rebuilt: a brand new element, same view.
    const second = new FakeBox(1000);
    keepScroll(second, "pot.list");
    expect(second.scrollTop).toBe(420);
  });

  it("keeps a separate position per view key", () => {
    const box = new FakeBox(1000);
    keepScroll(box, "storage.Items");
    box.scrollBy(300);
    keepScroll(box, "storage.Boosts");
    expect(box.scrollTop).toBe(0);
    box.scrollBy(120);
    keepScroll(box, "storage.Items");
    expect(box.scrollTop).toBe(300);
    expect(recallNumber("storage.Boosts")).toBe(120);
  });

  it("re-applies once the content is tall enough to hold the position", () => {
    const box = new FakeBox(1000);
    keepScroll(box, "market.Decors");
    box.scrollBy(600);

    // Reopened while the grid is still short: the first write clamps.
    const reopened = new FakeBox(100);
    keepScroll(reopened, "market.Decors");
    expect(reopened.scrollTop).toBe(100);
    reopened.limit = 1000; // the rest of the cards land
    vi.advanceTimersByTime(50);
    expect(reopened.scrollTop).toBe(600);
  });

  it("does not fight the player if they scroll during the retries", () => {
    const box = new FakeBox(1000);
    keepScroll(box, "market.Decors");
    box.scrollBy(600);

    const reopened = new FakeBox(100);
    keepScroll(reopened, "market.Decors");
    reopened.limit = 1000;
    reopened.scrollBy(0); // the player flicks back to the top themselves
    vi.runAllTimers();
    expect(reopened.scrollTop).toBe(0);
    expect(recallNumber("market.Decors")).toBe(0);
  });

  it("stops restoring a container that left the DOM", () => {
    const box = new FakeBox(1000);
    keepScroll(box, "pot.list");
    box.scrollBy(500);

    const reopened = new FakeBox(0);
    keepScroll(reopened, "pot.list");
    reopened.isConnected = false;
    reopened.limit = 1000;
    vi.runAllTimers();
    expect(reopened.scrollTop).toBe(0);
  });

  it("restores the top of a view that was never scrolled", () => {
    const box = new FakeBox(1000);
    box.scrollBy(250);
    keepScroll(box, "fresh.view");
    expect(box.scrollTop).toBe(0);
  });
});
