import { startSyncLoopsIfEnabled, stopSyncForShutdown } from "./sync/engine.js";
import { drainUpdateWork, startUpdateChecker } from "./updates/service.js";

/**
 * Background work started once the listen sockets are up.
 * Sync loops resume for a workspace that was already connected.
 * The update checker stays off under Vitest unless a test opts in, so the
 * suite does not call GitHub.
 */
export async function bootBackgroundTasks(): Promise<void> {
  await startSyncLoopsIfEnabled();
  if (process.env.VITEST && process.env.NERDGRAM_UPDATE_CHECK_IN_TEST !== "1") return;
  startUpdateChecker();
}

/**
 * Stop background timers and wait for the sync or update check already in
 * flight. Called after the HTTP server stops accepting new requests so an
 * open save can finish its write before the process exits.
 */
export async function shutdownBackgroundTasks(): Promise<void> {
  await stopSyncForShutdown();
  await drainUpdateWork();
}
