import fs from "node:fs/promises";
import path from "node:path";
import {
  LOCK_HEARTBEAT_MS,
  LOCK_STALE_MS,
  assertSafeId,
  atomicWriteJson,
  createId,
  decodeStorageKey,
  encodeStorageKey,
  getLocksRoot,
  httpFail,
  isProcessAlive,
  normalizeRelative,
  pathExists,
  readJsonFile,
} from "./storage.js";

export type LockRecord = {
  path: string;
  token: string;
  sessionId: string;
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
};

type LockFile = LockRecord & { stale: boolean };

const LOCKED_MESSAGE = "This diagram is open in another window.";

function lockFile(relativePath: string): string {
  return path.join(getLocksRoot(), `${encodeStorageKey(relativePath)}.json`);
}

function isLockRecord(value: unknown): value is LockRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LockRecord>;
  return (
    typeof record.path === "string" &&
    typeof record.token === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.pid === "number" &&
    typeof record.acquiredAt === "string" &&
    typeof record.heartbeatAt === "string"
  );
}

export function lockIsStale(record: LockRecord, now = Date.now()): boolean {
  const heartbeat = Date.parse(record.heartbeatAt);
  if (!Number.isFinite(heartbeat) || now - heartbeat > LOCK_STALE_MS) return true;
  // A dead pid is another server process that crashed. This process is always
  // "alive", including when the lock belongs to a different browser tab.
  if (record.pid !== process.pid && !isProcessAlive(record.pid)) return true;
  return false;
}

async function readLock(relativePath: string): Promise<LockFile | null> {
  const parsed = await readJsonFile<unknown>(lockFile(relativePath));
  if (!isLockRecord(parsed)) return null;
  return { ...parsed, stale: lockIsStale(parsed) };
}

function lockedError(record: LockRecord): Error {
  return httpFail(423, LOCKED_MESSAGE, "locked", {
    lock: {
      acquiredAt: record.acquiredAt,
      heartbeatAt: record.heartbeatAt,
      staleAfterMs: LOCK_STALE_MS,
    },
  });
}

function publicLock(record: LockRecord) {
  return {
    path: record.path,
    token: record.token,
    sessionId: record.sessionId,
    heartbeatAt: record.heartbeatAt,
    acquiredAt: record.acquiredAt,
    heartbeatEveryMs: LOCK_HEARTBEAT_MS,
    staleAfterMs: LOCK_STALE_MS,
  };
}

export async function acquireLock(
  relativePath: string,
  sessionId: string,
): Promise<ReturnType<typeof publicLock>> {
  const normalized = normalizeRelative(relativePath);
  if (!sessionId || sessionId.length > 80) {
    throw httpFail(400, "sessionId is required", "invalid");
  }
  assertSafeId(sessionId);
  await fs.mkdir(getLocksRoot(), { recursive: true });
  const file = lockFile(normalized);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await readLock(normalized);
    if (existing && !existing.stale) {
      // Same tab (same session id, same server process) can take its token back
      // after a refresh. A different tab has a different session id.
      if (existing.sessionId === sessionId && existing.pid === process.pid) {
        const refreshed: LockRecord = {
          path: existing.path,
          token: existing.token,
          sessionId: existing.sessionId,
          pid: existing.pid,
          acquiredAt: existing.acquiredAt,
          heartbeatAt: new Date().toISOString(),
        };
        await atomicWriteJson(file, refreshed);
        const confirmed = await readLock(normalized);
        if (confirmed?.token === refreshed.token) return publicLock(refreshed);
        continue;
      }
      throw lockedError(existing);
    }

    const now = new Date().toISOString();
    const record: LockRecord = {
      path: normalized,
      token: createId(),
      sessionId,
      pid: process.pid,
      acquiredAt: existing?.stale ? existing.acquiredAt : now,
      heartbeatAt: now,
    };
    await atomicWriteJson(file, record);
    const confirmed = await readLock(normalized);
    if (confirmed?.token === record.token) return publicLock(record);
  }

  throw httpFail(409, "Could not acquire the editor lock", "lock_busy");
}

export async function heartbeatLock(
  relativePath: string,
  token: string,
): Promise<ReturnType<typeof publicLock>> {
  const existing = await readLock(relativePath);
  if (!existing || existing.stale || existing.token !== token) {
    throw httpFail(423, "The editor lock is no longer held by this window.", "locked");
  }
  const next: LockRecord = {
    path: existing.path,
    token: existing.token,
    sessionId: existing.sessionId,
    pid: existing.pid,
    acquiredAt: existing.acquiredAt,
    heartbeatAt: new Date().toISOString(),
  };
  await atomicWriteJson(lockFile(normalizeRelative(relativePath)), next);
  const confirmed = await readLock(relativePath);
  if (!confirmed || confirmed.token !== token) {
    throw httpFail(423, "The editor lock is no longer held by this window.", "locked");
  }
  return publicLock(next);
}

/**
 * Replace a missing or stale lock after the reader confirms. A lock that is
 * still being refreshed by another window is left alone.
 */
export async function takeoverLock(
  relativePath: string,
  sessionId: string,
): Promise<ReturnType<typeof publicLock>> {
  const normalized = normalizeRelative(relativePath);
  const existing = await readLock(normalized);
  if (
    existing &&
    !existing.stale &&
    !(existing.sessionId === sessionId && existing.pid === process.pid)
  ) {
    throw lockedError(existing);
  }
  return acquireLock(relativePath, sessionId);
}

export async function releaseLock(relativePath: string, token: string): Promise<void> {
  const existing = await readLock(relativePath);
  if (!existing) return;
  if (existing.token !== token) {
    throw httpFail(423, LOCKED_MESSAGE, "locked");
  }
  await fs.rm(lockFile(normalizeRelative(relativePath)), { force: true });
}

/**
 * A live lock blocks every other writer. A missing or stale lock does not,
 * so dashboard creates and local scripts keep working until an editor is open.
 */
export async function assertWriteAllowed(
  relativePath: string,
  token: string | null | undefined,
): Promise<void> {
  const existing = await readLock(relativePath);
  if (!existing || existing.stale) return;
  if (token && existing.token === token) return;
  throw lockedError(existing);
}

async function eachLock(): Promise<LockFile[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(getLocksRoot());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const locks: LockFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const itemPath = decodeStorageKey(name.slice(0, -".json".length));
    if (!itemPath) continue;
    const parsed = await readJsonFile<unknown>(path.join(getLocksRoot(), name));
    if (!isLockRecord(parsed)) continue;
    locks.push({ ...parsed, path: itemPath, stale: lockIsStale(parsed) });
  }
  return locks;
}

function covers(lockPath: string, relativePath: string, isDir: boolean): boolean {
  const target = normalizeRelative(relativePath);
  return lockPath === target || (isDir && lockPath.startsWith(`${target}/`));
}

export async function assertUnlocked(relativePath: string, isDir: boolean): Promise<void> {
  for (const lock of await eachLock()) {
    if (lock.stale || !covers(lock.path, relativePath, isDir)) continue;
    throw lockedError(lock);
  }
}

export async function discardLocks(relativePath: string, isDir: boolean): Promise<void> {
  for (const lock of await eachLock()) {
    if (!covers(lock.path, relativePath, isDir)) continue;
    await fs.rm(lockFile(lock.path), { force: true });
  }
}

export async function relocateLocks(
  fromPath: string,
  toPath: string,
  isDir: boolean,
): Promise<void> {
  const locks = await eachLock();
  for (const lock of locks) {
    if (!covers(lock.path, fromPath, isDir)) continue;
    const from = normalizeRelative(fromPath);
    const nextPath =
      lock.path === from ? normalizeRelative(toPath) : `${normalizeRelative(toPath)}${lock.path.slice(from.length)}`;
    const next: LockRecord = {
      path: nextPath,
      token: lock.token,
      sessionId: lock.sessionId,
      pid: lock.pid,
      acquiredAt: lock.acquiredAt,
      heartbeatAt: lock.heartbeatAt,
    };
    await fs.rm(lockFile(lock.path), { force: true });
    if (!(await pathExists(lockFile(nextPath)))) {
      await atomicWriteJson(lockFile(nextPath), next);
    }
  }
}
