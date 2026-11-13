/**
 * In-memory thumbnail cache for the open tab.
 *
 * The disk copy under `.meta/thumbs` is the source of truth across restarts.
 * This map avoids another request when the dashboard remounts and the file's
 * mtime or content key is unchanged. Renders of diagrams that are not on
 * screen wait in `scheduleThumbnail`, which runs at most two at a time.
 */

export const THUMBNAIL_CONCURRENCY = 2;
const MAX_MEMORY = 200;

export type ThumbnailMemoryStatus = "ready" | "empty" | "failed";

export type ThumbnailMemory = {
  path: string;
  cacheKey: string;
  mtimeMs: number | null;
  svg: string | null;
  status: ThumbnailMemoryStatus;
};

const memory = new Map<string, ThumbnailMemory>();

export function clearThumbnailMemory(): void {
  memory.clear();
}

export function rememberThumbnail(record: ThumbnailMemory): void {
  if (record.status === "ready" && !record.svg) return;
  if (memory.has(record.path)) memory.delete(record.path);
  memory.set(record.path, record);
  while (memory.size > MAX_MEMORY) {
    const oldest = memory.keys().next().value;
    if (oldest == null) break;
    memory.delete(oldest);
  }
}

/**
 * A hit means the dashboard can paint the SVG without reading the file or
 * calling mermaid. `cacheKey` wins when the tree has already loaded diagram
 * meta. `mtimeMs` covers the gap before that response arrives.
 */
export function lookupThumbnailRecord(
  path: string,
  mtimeMs: number,
  cacheKey?: string | null,
): ThumbnailMemory | null {
  const hit = memory.get(path);
  if (!hit) return null;
  const keyOk = !!cacheKey && hit.cacheKey === cacheKey;
  const mtimeOk = hit.mtimeMs != null && hit.mtimeMs === mtimeMs;
  if (!keyOk && !mtimeOk) return null;
  if (cacheKey && hit.cacheKey !== cacheKey) return null;
  memory.delete(path);
  memory.set(path, hit);
  return hit;
}

export function lookupThumbnail(
  path: string,
  mtimeMs: number,
  cacheKey?: string | null,
): string | null {
  const hit = lookupThumbnailRecord(path, mtimeMs, cacheKey);
  if (!hit || hit.status !== "ready") return null;
  return hit.svg;
}

export function chooseThumbnailSource(options: {
  memorySvg: string | null;
  serverSvg: string | null;
}): "memory" | "server" | "render" {
  if (options.memorySvg) return "memory";
  if (options.serverSvg) return "server";
  return "render";
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

let active = 0;
const waiters: Array<() => void> = [];

function pump(): void {
  while (active < THUMBNAIL_CONCURRENCY && waiters.length > 0) {
    const next = waiters.shift();
    next?.();
  }
}

/**
 * Run `task` when a thumbnail slot is free. Aborting while queued skips the
 * task. Aborting after it has started does not cancel mermaid; the caller
 * ignores the result.
 */
export function scheduleThumbnail<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const start = () => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        fail(abortError());
        pump();
        return;
      }
      active += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        active -= 1;
        pump();
      };
      task().then(
        (value) => {
          release();
          succeed(value);
        },
        (error: unknown) => {
          release();
          fail(error);
        },
      );
    };

    const onAbort = () => {
      const index = waiters.indexOf(start);
      if (index >= 0) {
        waiters.splice(index, 1);
        fail(abortError());
      }
    };

    if (signal?.aborted) {
      fail(abortError());
      return;
    }
    signal?.addEventListener("abort", onAbort);
    if (active < THUMBNAIL_CONCURRENCY) start();
    else waiters.push(start);
  });
}
