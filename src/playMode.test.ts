import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  choosePlayMode, clearPreferredPlayMode, getPreferredPlayMode, setPreferredPlayMode,
  onlineFarmTile, otherPlayMode, playModeDestinationLabel, resolveStoredPlayMode,
  shouldPersistChoice, usesOnlineGameplay,
} from "./playMode";
import type { ServiceStatus } from "./net/serviceStatus";

const service = (mode: ServiceStatus["mode"], notice: string | null = null): ServiceStatus =>
  ({ mode, notice, reached: true });

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

describe("play mode preference", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));

  it("keeps Local Farm and Online Farm as an explicit persisted choice", () => {
    expect(getPreferredPlayMode()).toBeNull();
    setPreferredPlayMode("local");
    expect(getPreferredPlayMode()).toBe("local");
    setPreferredPlayMode("online");
    expect(getPreferredPlayMode()).toBe("online");
    clearPreferredPlayMode();
    expect(getPreferredPlayMode()).toBeNull();
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem("zf2r.play-mode.v1", "sometimes");
    expect(getPreferredPlayMode()).toBeNull();
  });

  it("opens Local Farm directly when online services are not configured", async () => {
    setPreferredPlayMode("online");
    await expect(choosePlayMode(false)).resolves.toBe("local");
    expect(getPreferredPlayMode()).toBe("local");
  });

  it("keeps server-owned gameplay disabled for Local Farm", () => {
    // A browser may still hold a valid Online Farm session after the player
    // switches farms. That retained login must not change Local Farm behavior.
    expect(usesOnlineGameplay("local")).toBe(false);
    expect(usesOnlineGameplay("online")).toBe(true);
  });

  it("labels a direct switch to the other independent farm", () => {
    expect(otherPlayMode("local")).toBe("online");
    expect(playModeDestinationLabel("local")).toBe("Go to Online Farm");
    expect(otherPlayMode("online")).toBe("local");
    expect(playModeDestinationLabel("online")).toBe("Go to Local Farm");
  });
});

describe("closedown-aware farm chooser", () => {
  it("honours a stored preference while the service is open", () => {
    expect(resolveStoredPlayMode("online", service("open"))).toBe("online");
    expect(resolveStoredPlayMode("local", service("open"))).toBe("local");
  });

  // The trap this avoids: a returning beta player whose browser remembers "online"
  // being dropped straight into a sign-in they cannot use, never learning that their
  // farm is sitting there waiting to be collected. null = show the chooser.
  it("re-shows the chooser when a stored 'online' preference meets a closed service", () => {
    expect(resolveStoredPlayMode("online", service("export_only"))).toBeNull();
    expect(resolveStoredPlayMode("online", service("closed"))).toBeNull();
  });

  it("keeps playing online for existing accounts when only signups are paused", () => {
    expect(resolveStoredPlayMode("online", service("signups_closed"))).toBe("online");
  });

  it("never second-guesses a stored 'local' preference", () => {
    expect(resolveStoredPlayMode("local", service("closed"))).toBe("local");
  });

  it("prompts when nothing is stored", () => {
    expect(resolveStoredPlayMode(null, service("open"))).toBeNull();
  });

  // An export trip is a one-off errand, not a declaration that this browser plays
  // online — next launch should land in Local Farm, where the moved farm now lives.
  it("does not remember 'online' for an export trip", () => {
    expect(shouldPersistChoice("online", service("export_only"))).toBe(false);
    expect(shouldPersistChoice("local", service("export_only"))).toBe(true);
    expect(shouldPersistChoice("online", service("signups_closed"))).toBe(true);
    expect(shouldPersistChoice("online", service("open"))).toBe(true);
  });
});

describe("onlineFarmTile copy", () => {
  it("disables the tile when sign-in is unavailable", () => {
    expect(onlineFarmTile(service("closed")).disabled).toBe(true);
    expect(onlineFarmTile(service("export_only")).disabled).toBe(false);
    expect(onlineFarmTile(service("open")).disabled).toBe(false);
  });

  it("tells existing beta players they can still sign in when signups are paused", () => {
    const tile = onlineFarmTile(service("signups_closed"));
    expect(tile.disabled).toBe(false);
    expect(tile.title).toBe("Play Online");
    expect(tile.note).toContain("New accounts are paused");
  });

  it("frames export_only as downloading a copy, matching Local Farm's Export", () => {
    const tile = onlineFarmTile(service("export_only"));
    expect(tile.disabled).toBe(false);
    expect(tile.title).toBe("Export My Online Farm");
    expect(tile.body).toContain("download a copy of your farm");
  });

  it("prefers the operator notice over the built-in copy", () => {
    expect(onlineFarmTile(service("closed", "Back on the 14th")).body).toBe("Back on the 14th");
  });
});
