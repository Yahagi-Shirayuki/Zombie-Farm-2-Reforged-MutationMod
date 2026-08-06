import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canCreateAccount, canPlayOnline, canSignIn, fetchServiceStatus, isExportOnly,
  resetServiceStatus, signInRefusalMessage, type ServiceStatus,
} from "./serviceStatus";
import * as api from "./api";

const status = (mode: ServiceStatus["mode"]): ServiceStatus =>
  ({ mode, notice: null, reached: true });

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe("service mode permissions", () => {
  it("gates account creation to a fully open service", () => {
    expect(canCreateAccount(status("open"))).toBe(true);
    expect(canCreateAccount(status("signups_closed"))).toBe(false);
    expect(canCreateAccount(status("export_only"))).toBe(false);
    expect(canCreateAccount(status("closed"))).toBe(false);
  });

  it("keeps sign-in and reads available in export_only", () => {
    expect(canSignIn(status("export_only"))).toBe(true);
    expect(canPlayOnline(status("export_only"))).toBe(false);
    expect(isExportOnly(status("export_only"))).toBe(true);
  });

  it("treats signups_closed as ordinary play for existing accounts", () => {
    expect(canPlayOnline(status("signups_closed"))).toBe(true);
    expect(isExportOnly(status("signups_closed"))).toBe(false);
  });

  it("shuts everything down in closed", () => {
    expect(canSignIn(status("closed"))).toBe(false);
    expect(canPlayOnline(status("closed"))).toBe(false);
  });
});

describe("fetchServiceStatus", () => {
  beforeEach(() => {
    resetServiceStatus();
    vi.restoreAllMocks();
  });

  it("reads the mode and notice from the health probe", async () => {
    vi.spyOn(api, "baseUrl").mockReturnValue("https://api.example");
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ serviceMode: "export_only", serviceNotice: "Back at launch" }),
    );
    expect(await fetchServiceStatus(fetcher as unknown as typeof fetch)).toEqual({
      mode: "export_only", notice: "Back at launch", reached: true,
    });
    expect(fetcher).toHaveBeenCalledWith("https://api.example/", expect.anything());
  });

  // The failure that matters: a player on a flaky connection must not be told the
  // service is closed and shunted into a one-way export.
  it("assumes open when the probe cannot be reached", async () => {
    vi.spyOn(api, "baseUrl").mockReturnValue("https://api.example");
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));
    expect(await fetchServiceStatus(fetcher as unknown as typeof fetch)).toEqual({
      mode: "open", notice: null, reached: false,
    });
  });

  it("assumes open against an older Worker that has no service fields", async () => {
    vi.spyOn(api, "baseUrl").mockReturnValue("https://api.example");
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true, service: "zombiefarm" }));
    expect((await fetchServiceStatus(fetcher as unknown as typeof fetch)).mode).toBe("open");
  });

  it("ignores an unrecognised mode", async () => {
    vi.spyOn(api, "baseUrl").mockReturnValue("https://api.example");
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ serviceMode: "banana" }));
    expect((await fetchServiceStatus(fetcher as unknown as typeof fetch)).mode).toBe("open");
  });

  it("never calls the network in an offline build", async () => {
    vi.spyOn(api, "baseUrl").mockReturnValue(null);
    const fetcher = vi.fn();
    expect((await fetchServiceStatus(fetcher as unknown as typeof fetch)).mode).toBe("open");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("probes once per page load", async () => {
    vi.spyOn(api, "baseUrl").mockReturnValue("https://api.example");
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ serviceMode: "closed" }));
    await fetchServiceStatus(fetcher as unknown as typeof fetch);
    await fetchServiceStatus(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// The Google callback used to swallow a refusal with only a console.warn, which during
// the closedown looks exactly like a broken sign-in button. These lines replaced that
// silence, so the closedown codes have to keep saying something true.
describe("signInRefusalMessage", () => {
  it("tells a turned-away new player that existing beta accounts still work", () => {
    const message = signInRefusalMessage("signups_closed")!;
    expect(message).toContain("New accounts are paused");
    expect(message).toContain("same Google account");
  });

  it("points a locked-out player at Local Farm and reassures them", () => {
    const message = signInRefusalMessage("service_closed")!;
    expect(message).toContain("Local Farm still works");
    expect(message).toContain("progress is kept");
  });

  it("stays quiet when nothing was refused", () => {
    expect(signInRefusalMessage(null)).toBeNull();
  });

  it("falls back to a retry line for any other failure", () => {
    expect(signInRefusalMessage("error")).toContain("try again");
    expect(signInRefusalMessage("bad_username")).toContain("try again");
  });
});
