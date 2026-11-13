import { startSyncLoopsIfEnabled } from "./sync/engine.js";
import { startUpdateChecker } from "./updates/service.js";

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
