import type { EpicBossProjection } from "./protocol";

/** Move an authoritative epoch timestamp into the browser's wall-clock domain. */
export const serverTimestampToClient = (
  timestamp: number,
  serverTime: number,
  clientTime = Date.now(),
): number => timestamp <= 0 ? timestamp : timestamp + clientTime - serverTime;

/** An Epic Boss run carries five authoritative epochs that the client compares
 * against its own clock (the activation window, the encounter timeout, and the retry
 * gate). Translate the whole projection in one place so no caller can move some of
 * them and leave the rest in the server's clock domain. */
export function epicBossRunToClient(
  run: EpicBossProjection | null | undefined,
  serverTime: number,
  clientTime = Date.now(),
): EpicBossProjection | null {
  if (!run) return null;
  const toClient = (value: number) => serverTimestampToClient(value, serverTime, clientTime);
  return {
    ...run,
    activatedAt: toClient(run.activatedAt),
    expiresAt: toClient(run.expiresAt),
    encounterStartedAt: toClient(run.encounterStartedAt),
    retryReadyAt: toClient(run.retryReadyAt),
    completedAt: toClient(run.completedAt),
  };
}
