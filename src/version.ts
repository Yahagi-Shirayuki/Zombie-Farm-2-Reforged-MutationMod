import packageJson from "../package.json";

/** User-facing game version. Keep the full semver in package.json, but omit a
 * trailing zero patch so e.g. 0.2.0 is presented as "0.2" (0.2.1 stays "0.2.1"). */
export const APP_VERSION = packageJson.version.replace(/\.0$/, "");

/** Short commit SHA this bundle was built from ("dev" locally). `APP_VERSION` tracks
 *  package.json and rarely changes, so this is what actually identifies a deployed
 *  build in a crash report. */
export const BUILD_SHA = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";

/** Version string for diagnostics and support: "0.1 (a1b2c3d)". */
export const BUILD_ID = `${APP_VERSION} (${BUILD_SHA})`;

/** The same identity as a header value: "0.1+a1b2c3d". No spaces or parens, so it
 *  survives a header and reads cleanly in a Worker log line. Everything that reports
 *  which bundle is talking uses THIS — the header used to read a `VITE_BUILD_ID` that
 *  nothing has ever set, so every production client identified itself as "dev" and the
 *  logs could not tell an old bundle from a new one. `__BUILD_SHA__` was already being
 *  filled from GITHUB_SHA for the diagnostics report; there was never a second value to
 *  populate, only a second name to stop using. */
export const BUILD_TAG = `${APP_VERSION}+${BUILD_SHA}`;
