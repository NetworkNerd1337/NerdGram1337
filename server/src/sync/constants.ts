/** Public setup instructions. The anchor matches the README heading "GitHub sync". */
export const SYNC_DOCS_URL = "https://github.com/NetworkNerd1337/NerdGram1337#github-sync";

/** Where the user finishes Device Flow. The server never sends the device code here. */
export const GITHUB_DEVICE_URL = "https://github.com/login/device";

/** OAuth grants the user can revoke after disconnect, when the app has no client secret. */
export const GITHUB_GRANT_SETTINGS_URL = "https://github.com/settings/apps/authorizations";

export const DEFAULT_REPO_NAME = "nerdgram-diagrams";

/**
 * Autosave writes the `.mmd` file about 500ms after typing. Commits wait until
 * the workspace has been idle this long so one edit becomes one commit.
 */
export const DEFAULT_IDLE_MS = 20_000;

/** Renames, moves, deletes, imports, and restores commit on this shorter pause. */
export const STRUCTURAL_IDLE_MS = 1_000;

export const DEFAULT_RECONCILE_MS = 60_000;
export const DEFAULT_RETRY_MS = 30_000;
export const DEFAULT_GITHUB_TIMEOUT_MS = 20_000;

export const MIRROR_DIR_NAME = ".nerdgram-git";
export const TOKEN_FILE_NAME = "github-token";
export const CONFIG_FILE_NAME = "github-sync.json";
export const CONFLICTS_FILE_NAME = "github-conflicts.json";

export const BRANCH = "main";

export const BOILERPLATE = new Set(["README.md", ".gitignore", ".gitattributes"]);

export function idleMs(): number {
  return boundedInt(process.env.NERDGRAM_SYNC_IDLE_MS, DEFAULT_IDLE_MS, 0, 10 * 60 * 1000);
}

export function reconcileMs(): number {
  return boundedInt(process.env.NERDGRAM_SYNC_RECONCILE_MS, DEFAULT_RECONCILE_MS, 0, 24 * 60 * 60 * 1000);
}

export function retryMs(): number {
  return boundedInt(process.env.NERDGRAM_SYNC_RETRY_MS, DEFAULT_RETRY_MS, 5_000, 10 * 60 * 1000);
}

export function githubTimeoutMs(): number {
  return boundedInt(process.env.NERDGRAM_GITHUB_TIMEOUT_MS, DEFAULT_GITHUB_TIMEOUT_MS, 100, 120_000);
}

export function watchEnabled(): boolean {
  return process.env.NERDGRAM_SYNC_WATCH !== "0";
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
