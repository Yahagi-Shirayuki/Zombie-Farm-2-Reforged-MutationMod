import { describe, expect, it, vi } from "vitest";
import { QuestBus, QuestEvent } from "../quest/events";
import { postRaidWinQuests } from "./questEvents";

const win = (zombiesLost = 1, loot: { name: string }[] = []) => ({ win: true, zombiesLost, loot });

describe("raid win quest events", () => {
  it("posts the invasion, perfect game and loot events offline", () => {
    const bus = new QuestBus();
    const seen: [string, string][] = [];
    bus.subscribe((nid, object) => { seen.push([nid, object]); });

    postRaidWinQuests(bus, win(0, [{ name: "Rusty Tractor" }]), "Old McDonnell's Farm", false);

    expect(seen).toEqual([
      [QuestEvent.InvasionSuccessful, "Old McDonnell's Farm"],
      [QuestEvent.InvasionPerfectGame, "Old McDonnell's Farm"],
      [QuestEvent.LootItemWon, "Rusty Tractor"],
    ]);
  });

  it("skips the perfect game event when a zombie fell", () => {
    const bus = new QuestBus();
    const seen: string[] = [];
    bus.subscribe((nid) => { seen.push(nid); });

    postRaidWinQuests(bus, win(2), "Old McDonnell's Farm", false);

    expect(seen).toEqual([QuestEvent.InvasionSuccessful]);
  });

  it("posts nothing on a loss", () => {
    const bus = new QuestBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    postRaidWinQuests(bus, { win: false, zombiesLost: 0, loot: [] }, "Old McDonnell's Farm", false);

    expect(handler).not.toHaveBeenCalled();
  });

  // Regression: /raid/finish counts the win in the authoritative quest projection and
  // returns the resulting questChanges. Posting locally as well advanced the optimistic
  // layer a second time, so "Beat Old McDonnell 3x" displayed 3/3 and fired its
  // completion popup after two wins — with the server at 2/3 and no XP granted.
  it("posts nothing online, where the server already counted the win", () => {
    const bus = new QuestBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    postRaidWinQuests(bus, win(0, [{ name: "Rusty Tractor" }]), "Old McDonnell's Farm", true);

    expect(handler).not.toHaveBeenCalled();
  });
});
