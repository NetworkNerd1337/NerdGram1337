import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { writeDataFile } from "../diagramDataFiles.js";
import { deleteItem, readFile, writeFile } from "../fsStore.js";
import { assertWriteAllowed } from "../locks.js";
import { ensureDataRoot, getDataRoot, getMetaPath, resolveSafePath } from "../paths.js";
import { dropThumbnail } from "../thumbnails.js";
import { httpFail, resolveAvailablePath, pathExists } from "../storage.js";
import type { SyncConfig } from "./configStore.js";
import { clientIdOf, emptyConfig, loadConfig, saveConfig } from "./configStore.js";
import {
  BRANCH,
  DEFAULT_REPO_NAME,
  GITHUB_DEVICE_URL,
  GITHUB_GRANT_SETTINGS_URL,
  STRUCTURAL_IDLE_MS,
  SYNC_DOCS_URL,
  idleMs,
  reconcileMs,
  retryMs,
  watchEnabled,
} from "./constants.js";
import {
  classifyNetworkError,
  createUserRepo,
  getAuthenticatedUser,
  getRepo,
  pollDeviceToken,
  repoIsEmpty,
  requestDeviceCode,
  revokeGrant,
  setDefaultBranch,
  setGithubFetch,
  type GithubRepo,
} from "./github.js";
import { clearRememberedSecrets } from "./redact.js";
import {
  configPath,
  conflictsPath,
  isDataFile,
  isSyncedFile,
  listUserFiles,
  mirrorPath,
  removePrivateFile,
  writePrivateFile,
} from "./layout.js";
import {
  cloneMirror,
  commitMirror,
  copyDataToMirror,
  fastForwardBranch,
  fetchRemote,
  headOid,
  initMirror,
  isAncestor,
  mergeBase,
  pushBranch,
  readUserFilesAt,
  remoteOid,
} from "./mirror.js";
import { deleteStoredToken, readToken, writeToken, type TokenSource } from "./secrets.js";

export type SyncChoice = "local" | "remote" | "both";

export type PublicConflict = {
  path: string;
  reason: "both_changed" | "locked" | "remote_deleted" | "local_deleted";
  locked: boolean;
  localPreview: string | null;
  remotePreview: string | null;
};

export type SyncStatus = {
  enabled: boolean;
  login: string | null;
  clientId: string | null;
  clientIdSource: "env" | "config" | null;
  tokenSource: TokenSource | null;
  repo: { owner: string; name: string; private: boolean; htmlUrl: string } | null;
  lastSyncAt: string | null;
  pending: boolean;
  ahead: number;
  behind: number;
  idleMs: number;
  syncing: boolean;
  error: { code: string; message: string; docsUrl?: string } | null;
  conflicts: PublicConflict[];
  device: {
    userCode: string;
    verificationUri: string;
    expiresAt: string;
  } | null;
  docsUrl: string;
  mirror: string;
};

type StoredConflict = {
  path: string;
  reason: PublicConflict["reason"];
  locked: boolean;
  localContent: string | null;
  remoteContent: string | null;
};

type ConflictFile = {
  remoteOid: string;
  localOid: string | null;
  conflicts: StoredConflict[];
};

type LocalChange = { kind: "content" | "structural"; summary: string };

type Failure = { code: string; message: string; status: number; docsUrl?: string };

const CLIENT_ID_RE = /^[A-Za-z0-9._-]{8,100}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const DEVICE_HELP =
  "Create an OAuth app in your own GitHub account, enable Device flow, and paste that app's client ID. NerdGram does not ship a client ID or client secret. The README section GitHub sync has the steps.";

let suppress = 0;
let timer: NodeJS.Timeout | null = null;
let reconcileTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let watcher: fs.FSWatcher | null = null;
let watchedRoot: string | null = null;
let summaries: string[] = [];
let structuralPending = false;
let chain: Promise<unknown> = Promise.resolve();
let active = 0;
let maxActive = 0;
let testHook: (() => Promise<void>) | null = null;
let deviceGeneration = 0;

type DeviceSession = {
  generation: number;
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  phase: "pending" | "error";
  error: { code: string; message: string } | null;
};

let device: DeviceSession | null = null;
let devicePoll: { resolve: () => void; timer: NodeJS.Timeout } | null = null;
let memoryError: Failure | null = null;

function waitForDevicePoll(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (devicePoll?.timer === timer) devicePoll = null;
      resolve();
    }, ms);
    timer.unref?.();
    devicePoll = {
      resolve: () => {
        clearTimeout(timer);
        if (devicePoll?.timer === timer) devicePoll = null;
        resolve();
      },
      timer,
    };
  });
}

function cancelDevicePoll(): void {
  devicePoll?.resolve();
}

/** Stop timers and wait for the sync already running. Used on SIGTERM. */
export async function stopSyncForShutdown(): Promise<void> {
  deviceGeneration += 1;
  device = null;
  cancelDevicePoll();
  stopLoops();
  await chain;
}

export function setSyncTestHook(hook: (() => Promise<void>) | null): void {
  testHook = hook;
}

export function syncConcurrency(): { active: number; maxActive: number } {
  return { active, maxActive };
}

export async function resetSyncForTests(): Promise<void> {
  deviceGeneration += 1;
  device = null;
  testHook = null;
  summaries = [];
  structuralPending = false;
  memoryError = null;
  active = 0;
  maxActive = 0;
  suppress = 0;
  cancelDevicePoll();
  stopLoops();
  clearRememberedSecrets();
  setGithubFetch(null);
  chain = Promise.resolve();
}

export function noteLocalChange(change: LocalChange): void {
  if (suppress > 0) return;
  void recordChange(change);
}

async function recordChange(change: LocalChange): Promise<void> {
  if (suppress > 0) return;
  const config = await loadConfig();
  if (!config.enabled || suppress > 0) return;
  if (change.summary && !summaries.includes(change.summary)) summaries.push(change.summary);
  if (change.kind === "structural") {
    structuralPending = true;
    schedule(STRUCTURAL_IDLE_MS);
    return;
  }
  if (!structuralPending) schedule(idleMs());
}

export async function withoutSyncNotes<T>(fn: () => Promise<T>): Promise<T> {
  suppress += 1;
  try {
    return await fn();
  } finally {
    await new Promise((resolve) => setImmediate(resolve));
    suppress -= 1;
  }
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return publicStatus();
}

export async function saveClientId(clientId: string): Promise<SyncStatus> {
  const id = assertClientId(clientId);
  const config = await loadConfig();
  if (!process.env.NERDGRAM_GITHUB_CLIENT_ID?.trim()) config.clientId = id;
  await saveConfig(config);
  return publicStatus();
}

export async function startDeviceFlow(): Promise<SyncStatus> {
  const config = await loadConfig();
  const client = clientIdOf(config);
  if (!client.id) {
    throw httpFail(400, `Add your GitHub OAuth app's client ID first. ${DEVICE_HELP} ${SYNC_DOCS_URL}`, "invalid_client");
  }
  const existing = await readToken();
  if (existing.source === "env") {
    throw httpFail(
      400,
      "NERDGRAM_GITHUB_TOKEN is already set. Connect with that token, or unset it to sign in with a device code.",
      "invalid",
    );
  }
  const issued = await requestDeviceCode(client.id);
  const generation = ++deviceGeneration;
  device = {
    generation,
    clientId: client.id,
    deviceCode: issued.deviceCode,
    userCode: issued.userCode,
    verificationUri: issued.verificationUri || GITHUB_DEVICE_URL,
    expiresAt: Date.now() + issued.expiresIn * 1000,
    intervalMs: Math.max(issued.interval, 0) * 1000,
    phase: "pending",
    error: null,
  };
  void pollDevice(generation);
  return publicStatus();
}

export async function connectRepo(input: {
  name?: string;
  private?: boolean;
  confirmNonEmpty?: boolean;
}): Promise<SyncStatus> {
  return exclusive(async () => {
    const config = await loadConfig();
    const name = assertRepoName(input.name?.trim() || DEFAULT_REPO_NAME);
    const isPrivate = input.private !== false;
    const auth = await requireToken();
    const user = await getAuthenticatedUser(auth.token);
    config.login = user.login;
    let repo: GithubRepo;
    let created = false;
    try {
      repo = await createUserRepo(auth.token, name, isPrivate);
      created = true;
    } catch (err) {
      const failure = asFailure(err);
      if (failure.code !== "name_taken") throw err;
      const existing = await getRepo(auth.token, user.login, name);
      if (!existing) throw err;
      const empty = await repoIsEmpty(auth.token, user.login, name);
      if (!empty && input.confirmNonEmpty !== true) {
        throw httpFail(
          409,
          `The repository ${user.login}/${name} already has commits. NerdGram will not push into it unless you confirm. Confirming adds your diagrams as new commits on top of that history. It does not erase the history and it does not force-push.`,
          "repo_not_empty",
          { htmlUrl: existing.htmlUrl, repo: `${user.login}/${name}` },
        );
      }
      repo = existing;
    }
    const mirror = mirrorPath();
    try {
      if (created || (await repoIsEmpty(auth.token, repo.owner, repo.name))) {
        await initMirror(mirror, repo.cloneUrl);
      } else {
        await cloneMirror(mirror, repo.cloneUrl);
      }
      await copyDataToMirror(ensureDataRoot(), mirror);
      await commitMirror(mirror, "Initial import of NerdGram diagrams");
      if (repo.cloneUrl.startsWith("http://") || repo.cloneUrl.startsWith("https://")) {
        const seen = await getRepo(auth.token, repo.owner, repo.name);
        if (!seen) throw httpFail(404, "That GitHub repository was not found.", "repo_missing");
      }
      await pushBranch(mirror);
      await setDefaultBranch(auth.token, repo.owner, repo.name, BRANCH).catch(() => undefined);
    } catch (err) {
      await fsp.rm(mirror, { recursive: true, force: true }).catch(() => undefined);
      config.enabled = false;
      config.owner = repo.owner;
      config.repo = repo.name;
      config.htmlUrl = repo.htmlUrl;
      config.private = repo.private;
      config.remoteUrl = null;
      config.login = user.login;
      await saveConfig(config);
      const failure = asFailure(err);
      const createdNote = created
        ? ` GitHub created ${repo.owner}/${repo.name}, but the first push did not finish, so sync is not on. The repository is still in your account.`
        : "";
      throw httpFail(
        failure.status,
        `Sync is not on.${createdNote} Your diagrams were not changed. ${failure.message}`.replace(/\s+/g, " ").trim(),
        failure.code,
      );
    }
    const head = await headOid(mirror);
    config.enabled = true;
    config.login = user.login;
    config.owner = repo.owner;
    config.repo = repo.name;
    config.private = repo.private;
    config.htmlUrl = repo.htmlUrl;
    config.remoteUrl = repo.cloneUrl;
    config.branch = BRANCH;
    config.lastPushedOid = head;
    config.lastSyncAt = new Date().toISOString();
    config.ahead = 0;
    config.behind = 0;
    await saveConfig(config);
    await clearConflicts();
    memoryError = null;
    ensureLoops();
    return publicStatus();
  });
}

export async function syncNow(): Promise<SyncStatus> {
  return exclusive(async () => {
    const config = await loadConfig();
    if (!config.enabled) throw httpFail(409, "GitHub sync is not on.", "invalid");
    await pushLocal(config, true);
    return publicStatus();
  });
}

export async function pullFromRemote(): Promise<SyncStatus> {
  return exclusive(async () => {
    const config = await loadConfig();
    if (!config.enabled) throw httpFail(409, "GitHub sync is not on.", "invalid");
    await pushLocal(config, false);
    const fresh = await loadConfig();
    if (!fresh.enabled) return publicStatus();
    await pullLocked(fresh);
    return publicStatus();
  });
}

export async function resolveConflicts(choices: { path: string; choice: SyncChoice }[]): Promise<SyncStatus> {
  return exclusive(async () => {
    const config = await loadConfig();
    if (!config.enabled) throw httpFail(409, "GitHub sync is not on.", "invalid");
    const file = await loadConflicts();
    if (!file || file.conflicts.length === 0) {
      throw httpFail(409, "There are no GitHub conflicts to resolve.", "invalid");
    }
    const byPath = new Map(file.conflicts.map((conflict) => [conflict.path, conflict]));
    for (const choice of choices) {
      const conflict = byPath.get(choice.path);
      if (!conflict) throw httpFail(400, "That path is not in the conflict list.", "invalid");
      if (choice.choice !== "local" && choice.choice !== "remote" && choice.choice !== "both") {
        throw httpFail(400, "Choose local, remote, or both.", "invalid");
      }
      if (choice.choice === "remote" && (conflict.locked || (await isLocked(conflict.path)))) {
        throw httpFail(
          423,
          "This diagram is open in an editor. Close it before replacing it with the GitHub copy.",
          "locked",
          { path: conflict.path },
        );
      }
      if (choice.choice === "both" && conflict.remoteContent == null) {
        throw httpFail(400, "GitHub deleted that diagram, so there is no second copy to keep.", "invalid");
      }
    }
    await withoutSyncNotes(async () => {
      for (const choice of choices) {
        const conflict = byPath.get(choice.path);
        if (!conflict) continue;
        if (choice.choice === "local") continue;
        if (choice.choice === "remote") {
          if (conflict.remoteContent == null) await deleteWorkspaceFile(conflict.path);
          else await writeWorkspaceFile(conflict.path, conflict.remoteContent, { force: true });
          if (conflict.remoteContent != null && !isDataFile(conflict.path)) await invalidateDiagram(conflict.path);
          continue;
        }
        const desired = githubCopyPath(conflict.path);
        const taken = async (candidate: string) => pathExists(resolveSafePath(candidate));
        const dest = await resolveAvailablePath(desired, taken);
        await writeWorkspaceFile(dest, conflict.remoteContent ?? "", {});
        if (!isDataFile(dest)) await invalidateDiagram(dest);
      }
    });
    const remaining = file.conflicts.filter((conflict) => !choices.some((choice) => choice.path === conflict.path));
    if (remaining.length > 0) {
      await saveConflicts({ ...file, conflicts: remaining });
      return publicStatus();
    }
    await clearConflicts();
    const mirror = mirrorPath();
    const local = await headOid(mirror);
    const remote = file.remoteOid;
    await copyDataToMirror(ensureDataRoot(), mirror);
    const parents = local ? [local, remote] : [remote];
    await commitMirror(mirror, "Merge GitHub changes", parents);
    memoryError = null;
    await pushIfForward(config);
    return publicStatus();
  });
}

export async function disableSync(confirm: boolean): Promise<SyncStatus & {
  disconnected: boolean;
  repoRemains: boolean;
  grantRevoked: boolean;
  revokeUrl: string;
}> {
  if (confirm !== true) {
    throw httpFail(
      400,
      "Disconnecting removes the local mirror and the saved authorization on this computer. The GitHub repository stays in your account. Confirm to continue.",
      "invalid",
    );
  }
  return exclusive(async () => {
    deviceGeneration += 1;
    device = null;
    stopLoops();
    const config = await loadConfig();
    const mirror = mirrorPath();
    const dataRoot = path.resolve(ensureDataRoot());
    const resolvedMirror = path.resolve(mirror);
    if (resolvedMirror !== dataRoot) {
      await fsp.rm(resolvedMirror, { recursive: true, force: true });
    }
    const auth = await readToken();
    const client = clientIdOf(config);
    let grantRevoked = false;
    if (auth.token && client.id && auth.source === "file") {
      try {
        grantRevoked = await revokeGrant(client.id, auth.token);
      } catch {
        grantRevoked = false;
      }
    }
    await deleteStoredToken();
    await clearConflicts();
    await removePrivateFile(configPath());
    const metaLeft = await fsp.readdir(getMetaPath()).catch(() => null);
    if (metaLeft && metaLeft.length === 0) await fsp.rmdir(getMetaPath()).catch(() => undefined);
    summaries = [];
    structuralPending = false;
    memoryError = null;
    const status = await publicStatus();
    return {
      ...status,
      disconnected: true,
      repoRemains: true,
      grantRevoked,
      revokeUrl: GITHUB_GRANT_SETTINGS_URL,
    };
  });
}

async function pushLocal(config: SyncConfig, push: boolean): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const mirror = mirrorPath();
  const changed = await copyDataToMirror(ensureDataRoot(), mirror);
  const message = commitMessage(changed);
  await commitMirror(mirror, message);
  if (!push) return;
  try {
    await probeIfHttp(config);
    await fetchRemote(mirror);
  } catch (err) {
    const failure = asFailure(err);
    memoryError = failure;
    const head = await headOid(mirror);
    config.ahead = head && head !== config.lastPushedOid ? 1 : 0;
    await saveConfig(config);
    console.error(`GitHub sync: ${failure.code}`);
    return;
  }
  const compared = await compare(mirror);
  config.ahead = compared.ahead;
  config.behind = compared.behind;
  await saveConfig(config);
  if (compared.behind > 0) {
    memoryError = asFailure(
      httpFail(
        409,
        "The GitHub repository has commits that are not on this computer. NerdGram did not force-push. Pull when you want to reconcile.",
        "not_fast_forward",
      ),
    );
    console.error("GitHub sync: not_fast_forward");
    return;
  }
  await pushIfForward(config);
}

async function pullLocked(config: SyncConfig): Promise<void> {
  const mirror = mirrorPath();
  try {
    await probeIfHttp(config);
    await fetchRemote(mirror);
  } catch (err) {
    memoryError = asFailure(err);
    console.error(`GitHub sync: ${memoryError.code}`);
    return;
  }
  const compared = await compare(mirror);
  config.ahead = compared.ahead;
  config.behind = compared.behind;
  await saveConfig(config);
  if (!compared.remote || compared.behind === 0) {
    memoryError = null;
    return;
  }
  const baseFiles = compared.base ? await readUserFilesAt(mirror, compared.base) : new Map<string, string>();
  const remoteFiles = await readUserFilesAt(mirror, compared.remote);
  const localFiles = await listUserFiles(ensureDataRoot());
  const plan = await planMerge(baseFiles, localFiles, remoteFiles);
  if (plan.conflicts.length > 0) {
    await saveConflicts({
      remoteOid: compared.remote,
      localOid: compared.local,
      conflicts: plan.conflicts,
    });
    memoryError = asFailure(
      httpFail(
        409,
        "GitHub has changes that overlap with local edits or an open editor. Choose which copy to keep. Nothing was force-pushed.",
        "conflicts",
      ),
    );
    return;
  }
  await applyPlan(plan.actions);
  const after = await listUserFiles(ensureDataRoot());
  const same = mapsEqual(after, remoteFiles);
  const canFastForward =
    compared.local != null && (await isAncestor(mirror, compared.local, compared.remote));
  if (same && canFastForward) {
    await fastForwardBranch(mirror);
  } else {
    await copyDataToMirror(ensureDataRoot(), mirror);
    const parents = compared.local ? [compared.local, compared.remote] : [compared.remote];
    await commitMirror(mirror, "Merge GitHub changes", parents);
  }
  await clearConflicts();
  memoryError = null;
  await pushIfForward(await loadConfig());
}

async function pushIfForward(config: SyncConfig): Promise<void> {
  const mirror = mirrorPath();
  let compared: Awaited<ReturnType<typeof compare>>;
  try {
    await probeIfHttp(config);
    await fetchRemote(mirror);
    compared = await compare(mirror);
  } catch (err) {
    memoryError = asFailure(err);
    console.error(`GitHub sync: ${memoryError.code}`);
    await saveConfig(config);
    return;
  }
  config.ahead = compared.ahead;
  config.behind = compared.behind;
  if (compared.behind > 0) {
    memoryError = asFailure(
      httpFail(
        409,
        "The GitHub repository has commits that are not on this computer. NerdGram did not force-push. Pull when you want to reconcile.",
        "not_fast_forward",
      ),
    );
    await saveConfig(config);
    console.error("GitHub sync: not_fast_forward");
    return;
  }
  const head = await headOid(mirror);
  if (head && compared.remote === head) {
    config.lastPushedOid = head;
    config.lastSyncAt = new Date().toISOString();
    config.ahead = 0;
    config.behind = 0;
    memoryError = null;
    await saveConfig(config);
    return;
  }
  try {
    await pushBranch(mirror);
  } catch (err) {
    memoryError = asFailure(err);
    await saveConfig(config);
    console.error(`GitHub sync: ${memoryError.code}`);
    return;
  }
  const pushed = await headOid(mirror);
  config.lastPushedOid = pushed;
  config.lastSyncAt = new Date().toISOString();
  config.ahead = 0;
  config.behind = 0;
  memoryError = null;
  await saveConfig(config);
}

type MergeAction =
  | { type: "write"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "invalidate"; path: string };

async function planMerge(
  base: Map<string, string>,
  local: Map<string, string>,
  remote: Map<string, string>,
): Promise<{ actions: MergeAction[]; conflicts: StoredConflict[] }> {
  const paths = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const actions: MergeAction[] = [];
  const conflicts: StoredConflict[] = [];
  for (const filePath of [...paths].sort()) {
    const baseContent = base.get(filePath) ?? null;
    const localContent = local.get(filePath) ?? null;
    const remoteContent = remote.get(filePath) ?? null;
    if (localContent === remoteContent) {
      if (remoteContent !== baseContent && localContent !== null) {
        actions.push({ type: "invalidate", path: filePath });
      }
      continue;
    }
    if (remoteContent === baseContent) continue;
    if (localContent === baseContent) {
      if (await isLocked(filePath)) {
        conflicts.push({ path: filePath, reason: "locked", locked: true, localContent, remoteContent });
        continue;
      }
      if (remoteContent === null) actions.push({ type: "delete", path: filePath });
      else actions.push({ type: "write", path: filePath, content: remoteContent });
      continue;
    }
    const locked = localContent !== null && (await isLocked(filePath));
    const reason = remoteContent === null ? "remote_deleted" : localContent === null ? "local_deleted" : "both_changed";
    conflicts.push({
      path: filePath,
      reason: locked ? "locked" : reason,
      locked,
      localContent,
      remoteContent,
    });
  }
  return { actions, conflicts };
}

async function applyPlan(actions: MergeAction[]): Promise<void> {
  await withoutSyncNotes(async () => {
    for (const action of actions) {
      if (action.type === "delete") {
        await deleteWorkspaceFile(action.path);
        continue;
      }
      if (action.type === "write") {
        if (isDataFile(action.path)) {
          await writeDataFile(action.path, action.content);
          continue;
        }
        let expectedHash: string | undefined;
        try {
          expectedHash = (await readFile(action.path)).hash;
        } catch (err) {
          if (!isMissing(err)) throw err;
        }
        await writeFile(action.path, action.content, expectedHash ? { expectedHash } : {});
        await invalidateDiagram(action.path);
        continue;
      }
      await invalidateDiagram(action.path);
    }
  });
}

async function invalidateDiagram(relativePath: string): Promise<void> {
  await dropThumbnail(relativePath);
  const search = await import("../search.js");
  await search.removeSearchEntries(relativePath, false);
  try {
    const now = new Date();
    await fsp.utimes(resolveSafePath(relativePath), now, now);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

async function compare(dir: string): Promise<{
  local: string | null;
  remote: string | null;
  base: string | null;
  ahead: number;
  behind: number;
}> {
  const local = await headOid(dir);
  const remote = await remoteOid(dir);
  if (!local || !remote) return { local, remote, base: null, ahead: local && local !== remote ? 1 : 0, behind: 0 };
  if (local === remote) return { local, remote, base: local, ahead: 0, behind: 0 };
  const base = await mergeBase(dir, local, remote);
  if (!base) return { local, remote, base: null, ahead: 1, behind: 1 };
  if (base === remote) return { local, remote, base, ahead: 1, behind: 0 };
  if (base === local) return { local, remote, base, ahead: 0, behind: 1 };
  return { local, remote, base, ahead: 1, behind: 1 };
}

function commitMessage(changed: string[]): string {
  const named = summaries.filter((summary) => summary.trim().length > 0);
  summaries = [];
  structuralPending = false;
  if (named.length === 1) return named[0] ?? "Update diagrams";
  if (named.length > 1 && named.length <= 4) return named.join("; ");
  if (named.length > 4) return `Update ${named.length} diagrams`;
  if (changed.length === 1) return `Update ${changed[0]}`;
  if (changed.length > 1 && changed.length <= 3) return `Update ${changed.join(", ")}`;
  if (changed.length > 3) {
    return `Update ${changed.slice(0, 3).join(", ")} and ${changed.length - 3} more`;
  }
  return "Update diagrams";
}

async function publicStatus(): Promise<SyncStatus> {
  const config = await loadConfig();
  const client = clientIdOf(config);
  const auth = await readToken();
  const conflicts = await loadConflicts();
  const pending = await hasPending(config);
  const deviceView =
    device && device.phase === "pending"
      ? {
          userCode: device.userCode,
          verificationUri: device.verificationUri,
          expiresAt: new Date(device.expiresAt).toISOString(),
        }
      : null;
  const error = device?.phase === "error" && device.error
    ? {
        code: device.error.code,
        message: device.error.message,
        docsUrl: device.error.code === "invalid_client" || device.error.code === "device_flow_disabled" ? SYNC_DOCS_URL : undefined,
      }
    : memoryError
      ? { code: memoryError.code, message: memoryError.message, docsUrl: memoryError.docsUrl }
      : null;
  return {
    enabled: config.enabled,
    login: config.login,
    clientId: client.id,
    clientIdSource: client.source,
    tokenSource: auth.source,
    repo:
      config.owner && config.repo
        ? {
            owner: config.owner,
            name: config.repo,
            private: config.private,
            htmlUrl: config.htmlUrl || `https://github.com/${config.owner}/${config.repo}`,
          }
        : null,
    lastSyncAt: config.lastSyncAt,
    pending,
    ahead: config.ahead,
    behind: config.behind,
    idleMs: idleMs(),
    syncing: active > 0,
    error,
    conflicts: (conflicts?.conflicts ?? []).map((conflict) => ({
      path: conflict.path,
      reason: conflict.reason,
      locked: conflict.locked,
      localPreview: preview(conflict.localContent),
      remotePreview: preview(conflict.remoteContent),
    })),
    device: deviceView,
    docsUrl: SYNC_DOCS_URL,
    mirror: process.env.NERDGRAM_SYNC_MIRROR?.trim() ? "custom" : ".nerdgram-git",
  };
}

async function hasPending(config: SyncConfig): Promise<boolean> {
  if (timer) return true;
  if (!config.enabled) return false;
  try {
    const head = await headOid(mirrorPath());
    if (head && config.lastPushedOid && head !== config.lastPushedOid) return true;
    const changed = await copyWouldChange();
    return changed;
  } catch {
    return false;
  }
}

async function copyWouldChange(): Promise<boolean> {
  const mirror = mirrorPath();
  try {
    await fsp.access(mirror);
  } catch {
    return false;
  }
  const desired = await listUserFiles(ensureDataRoot());
  const committed = await readUserFilesAt(mirror, "HEAD");
  return !mapsEqual(desired, committed);
}

function mapsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

async function probeIfHttp(config: SyncConfig): Promise<void> {
  const remote = config.remoteUrl;
  if (!remote || (!remote.startsWith("https://") && !remote.startsWith("http://"))) return;
  if (!config.owner || !config.repo) return;
  const auth = await readToken();
  if (!auth.token) {
    throw httpFail(401, "GitHub rejected the saved authorization. It may have been revoked. Connect again.", "auth_revoked");
  }
  const repo = await getRepo(auth.token, config.owner, config.repo);
  if (!repo) throw httpFail(404, "That GitHub repository was not found.", "repo_missing");
}

async function requireToken(): Promise<{ token: string; source: TokenSource }> {
  const auth = await readToken();
  if (!auth.token || !auth.source) {
    throw httpFail(401, "Connect a GitHub account before creating a repository.", "auth_revoked");
  }
  return { token: auth.token, source: auth.source };
}

function assertClientId(value: string): string {
  const id = value.trim();
  if (/^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)/.test(id) || !CLIENT_ID_RE.test(id)) {
    throw httpFail(400, `That client ID is not valid. ${DEVICE_HELP} ${SYNC_DOCS_URL}`, "invalid_client");
  }
  return id;
}

function assertRepoName(value: string): string {
  if (!REPO_RE.test(value) || value === "." || value === ".." || value.toLowerCase().endsWith(".git")) {
    throw httpFail(400, "Repository names can use letters, numbers, dots, dashes, and underscores.", "invalid");
  }
  return value;
}

function asFailure(err: unknown): Failure {
  if (err && typeof err === "object" && "status" in err && "code" in err && err instanceof Error) {
    const code = String((err as { code: string }).code);
    const docs =
      code === "invalid_client" || code === "device_flow_disabled" || code === "repo_not_empty" ? SYNC_DOCS_URL : undefined;
    return {
      code,
      message: err.message,
      status: (err as { status: number }).status,
      docsUrl: docs,
    };
  }
  const wrapped = classifyNetworkError(err);
  if (wrapped instanceof Error && "code" in wrapped) {
    return asFailure(wrapped);
  }
  return { code: "github", message: "GitHub sync failed.", status: 502 };
}

async function isLocked(relativePath: string): Promise<boolean> {
  try {
    await assertWriteAllowed(relativePath, null);
    return false;
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "locked") return true;
    throw err;
  }
}

function isMissing(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { status?: number }).status === 404);
}

function preview(content: string | null): string | null {
  if (content == null) return null;
  return content.length > 1500 ? `${content.slice(0, 1500)}\n…` : content;
}

function githubCopyPath(relativePath: string): string {
  return relativePath.replace(/(\.[^./]+)$/i, " (from GitHub)$1");
}

async function writeWorkspaceFile(
  relativePath: string,
  content: string,
  options?: { expectedHash?: string; force?: boolean },
): Promise<void> {
  if (isDataFile(relativePath)) {
    await writeDataFile(relativePath, content);
    return;
  }
  await writeFile(relativePath, content, options ?? {});
}

async function deleteWorkspaceFile(relativePath: string): Promise<void> {
  if (isDataFile(relativePath)) {
    await fsp.rm(resolveSafePath(relativePath), { force: true });
    return;
  }
  await deleteItem(relativePath);
}

async function loadConflicts(): Promise<ConflictFile | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(conflictsPath(), "utf8")) as ConflictFile;
    if (!parsed || !Array.isArray(parsed.conflicts)) return null;
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    return null;
  }
}

async function saveConflicts(file: ConflictFile): Promise<void> {
  await writePrivateFile(conflictsPath(), `${JSON.stringify(file)}\n`);
}

async function clearConflicts(): Promise<void> {
  await removePrivateFile(conflictsPath());
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow().catch((err) => {
      memoryError = asFailure(err);
      console.error(`GitHub sync: ${memoryError.code}`);
    });
  }, ms);
  timer.unref?.();
}

/** Resume watcher, reconcile, and retry timers for a workspace that is already syncing. */
export async function startSyncLoopsIfEnabled(): Promise<void> {
  try {
    const config = await loadConfig();
    if (!config.enabled) return;
    ensureLoops();
  } catch {
    console.error("GitHub sync: background loops did not start");
  }
}

export function syncLoopsActive(): { reconcile: boolean; retry: boolean; watch: boolean } {
  return {
    reconcile: reconcileTimer != null,
    retry: retryTimer != null,
    watch: watcher != null,
  };
}

function ensureLoops(): void {
  const root = getDataRoot();
  if (watchedRoot === root && (reconcileTimer || retryTimer || watcher)) return;
  stopLoops();
  watchedRoot = root;
  const reconcileEvery = reconcileMs();
  if (reconcileEvery > 0) {
    reconcileTimer = setInterval(() => {
      void syncNow().catch((err) => {
        memoryError = asFailure(err);
      });
    }, reconcileEvery);
    reconcileTimer.unref?.();
  }
  const retryEvery = retryMs();
  if (retryEvery > 0) {
    retryTimer = setInterval(() => {
      if (memoryError?.code !== "offline") return;
      void syncNow().catch((err) => {
        memoryError = asFailure(err);
      });
    }, retryEvery);
    retryTimer.unref?.();
  }
  if (watchEnabled()) startWatch(root);
}

function startWatch(root: string): void {
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (filename) {
        const rel = String(filename).split(path.sep).join("/");
        if (rel.split("/").some((part) => part.startsWith("."))) return;
        if (!isSyncedFile(rel)) return;
      }
      noteLocalChange({ kind: "content", summary: "" });
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    watcher = null;
  }
}

function stopLoops(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
  watcher?.close();
  watcher = null;
  watchedRoot = null;
}

async function pollDevice(generation: number): Promise<void> {
  while (device && device.generation === generation && device.phase === "pending") {
    if (Date.now() >= device.expiresAt) {
      device.phase = "error";
      device.error = { code: "invalid_client", message: `The sign-in code expired. Start again. ${SYNC_DOCS_URL}` };
      return;
    }
    await waitForDevicePoll(device?.intervalMs ?? 1000);
    if (!device || device.generation !== generation || device.phase !== "pending") return;
    try {
      const result = await pollDeviceToken(device.clientId, device.deviceCode);
      if (!device || device.generation !== generation) return;
      if (result.status === "pending") continue;
      if (result.status === "slow_down") {
        device.intervalMs += 5000;
        continue;
      }
      if (result.status === "success") {
        await writeToken(result.token);
        const user = await getAuthenticatedUser(result.token);
        const config = await loadConfig();
        config.login = user.login;
        await saveConfig(config);
        if (device?.generation === generation) device = null;
        return;
      }
      device.phase = "error";
      device.error = {
        code: "auth_revoked",
        message: result.status === "denied" ? "The sign-in was denied on GitHub." : "The sign-in code expired. Start again.",
      };
      return;
    } catch (err) {
      if (!device || device.generation !== generation) return;
      const failure = asFailure(err);
      if (failure.code === "offline") {
        device.intervalMs = Math.min(device.intervalMs + 2000, 15_000);
        continue;
      }
      device.phase = "error";
      device.error = { code: failure.code, message: failure.message };
      return;
    }
  }
}

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      if (testHook) await testHook();
      return await fn();
    } finally {
      active -= 1;
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export { setGithubFetch };
