const SESSION_KEY = "nerdgram-editor-session";

export type StoredLock = {
  token: string;
  sessionId: string;
};

function lockStorageKey(path: string): string {
  return `nerdgram-lock:${path}`;
}

export function editorSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

export function readStoredLock(path: string): StoredLock | null {
  const raw = sessionStorage.getItem(lockStorageKey(path));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredLock>;
    if (!parsed.token || !parsed.sessionId) return null;
    return { token: parsed.token, sessionId: parsed.sessionId };
  } catch {
    return null;
  }
}

export function writeStoredLock(path: string, lock: StoredLock): void {
  sessionStorage.setItem(lockStorageKey(path), JSON.stringify(lock));
}

export function clearStoredLock(path: string): void {
  sessionStorage.removeItem(lockStorageKey(path));
}

const epochs = new Map<string, number>();
const releaseTimers = new Map<string, number>();

export function nextEditorEpoch(path: string): number {
  const next = (epochs.get(path) ?? 0) + 1;
  epochs.set(path, next);
  return next;
}

export function editorEpochIsCurrent(path: string, epoch: number): boolean {
  return epochs.get(path) === epoch;
}

export function cancelScheduledLockRelease(path: string): void {
  const timer = releaseTimers.get(path);
  if (timer == null) return;
  window.clearTimeout(timer);
  releaseTimers.delete(path);
}

/** Delay release so React's development remount does not drop the lock. */
export function scheduleLockRelease(path: string, release: () => void): void {
  cancelScheduledLockRelease(path);
  const timer = window.setTimeout(() => {
    releaseTimers.delete(path);
    release();
  }, 400);
  releaseTimers.set(path, timer);
}
