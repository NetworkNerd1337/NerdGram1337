import type {
  FilePayload,
  FileWriteResult,
  FolderListing,
  RevisionSummary,
  TrashItem,
  TreeNode,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly path?: string;
  readonly suggestedPath?: string;
  readonly current?: {
    path?: string;
    content: string;
    mtimeMs: number;
    hash: string;
    size: number;
  };

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof body.code === "string" ? body.code : undefined;
    this.path = typeof body.path === "string" ? body.path : undefined;
    this.suggestedPath = typeof body.suggestedPath === "string" ? body.suggestedPath : undefined;
    if (body.current && typeof body.current === "object") {
      const current = body.current as Record<string, unknown>;
      if (
        typeof current.content === "string" &&
        typeof current.hash === "string" &&
        typeof current.mtimeMs === "number"
      ) {
        this.current = {
          path: typeof current.path === "string" ? current.path : undefined,
          content: current.content,
          hash: current.hash,
          mtimeMs: current.mtimeMs,
          size: typeof current.size === "number" ? current.size : current.content.length,
        };
      }
    }
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

export const api = {
  tree: () => request<{ tree: TreeNode[] }>("/api/tree"),
  list: (path = "") =>
    request<FolderListing>(`/api/list?path=${encodeURIComponent(path)}`),
  readFile: (path: string) =>
    request<FilePayload>(`/api/file?path=${encodeURIComponent(path)}`),
  writeFile: (
    path: string,
    content: string,
    options?: {
      expectedMtimeMs?: number;
      expectedHash?: string;
      force?: boolean;
      lockToken?: string | null;
    },
  ) =>
    request<FileWriteResult>("/api/file", {
      method: "PUT",
      body: JSON.stringify({
        path,
        content,
        expectedMtimeMs: options?.expectedMtimeMs,
        expectedHash: options?.expectedHash,
        force: options?.force,
        lockToken: options?.lockToken ?? undefined,
      }),
    }),
  createFolder: (path: string) =>
    request<{ path: string }>("/api/folder", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  rename: (from: string, to: string) =>
    request<{ path: string }>("/api/rename", {
      method: "PATCH",
      body: JSON.stringify({ from, to }),
    }),
  move: (from: string, toFolder: string) =>
    request<{ path: string }>("/api/move", {
      method: "POST",
      body: JSON.stringify({ from, toFolder }),
    }),
  delete: (path: string) =>
    request<void>(`/api/item?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),
  favorites: () => request<{ favorites: string[] }>("/api/favorites"),
  toggleFavorite: (path: string) =>
    request<{ favorites: string[]; favorited: boolean }>(
      "/api/favorites/toggle",
      {
        method: "POST",
        body: JSON.stringify({ path }),
      },
    ),
  referenceList: () =>
    request<{
      manifest: {
        lastSyncedAt: string | null;
        attribution: string;
        license: string;
        sources: string[];
        pages: {
          id: string;
          title: string;
          sourceUrl: string;
          filename: string;
        }[];
      };
      pages: {
        id: string;
        title: string;
        sourceUrl: string;
        filename: string;
      }[];
    }>("/api/reference"),
  referencePage: (id: string) =>
    request<{
      id: string;
      title: string;
      sourceUrl: string;
      content: string;
      override: string;
    }>(`/api/reference/page?id=${encodeURIComponent(id)}`),
  referenceOverride: (id: string, text: string) =>
    request<{ override: string }>("/api/reference/override", {
      method: "PUT",
      body: JSON.stringify({ id, text }),
    }),
  trash: () => request<{ items: TrashItem[] }>("/api/trash"),
  restoreTrash: (id: string, options?: { path?: string; overwrite?: boolean }) =>
    request<{ path: string; type: "file" | "folder" }>("/api/trash/restore", {
      method: "POST",
      body: JSON.stringify({
        id,
        path: options?.path,
        overwrite: options?.overwrite,
      }),
    }),
  purgeTrash: (id: string) =>
    request<void>(`/api/trash/item?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  emptyTrash: () =>
    request<{ purged: number }>("/api/trash/empty", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  history: (path: string) =>
    request<{ path: string; retention: number; revisions: RevisionSummary[] }>(
      `/api/history?path=${encodeURIComponent(path)}`,
    ),
  historyRevision: (path: string, id: string) =>
    request<RevisionSummary & { content: string }>(
      `/api/history/revision?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
    ),
  restoreRevision: (path: string, id: string, lockToken?: string | null) =>
    request<FileWriteResult & { content: string }>("/api/history/restore", {
      method: "POST",
      body: JSON.stringify({ path, id, lockToken: lockToken ?? undefined }),
    }),
  acquireLock: (path: string, sessionId: string) =>
    request<{
      path: string;
      token: string;
      sessionId: string;
      heartbeatAt: string;
      acquiredAt: string;
      heartbeatEveryMs: number;
      staleAfterMs: number;
    }>("/api/lock", {
      method: "POST",
      body: JSON.stringify({ path, sessionId }),
    }),
  heartbeatLock: (path: string, token: string) =>
    request<{
      token: string;
      sessionId: string;
      heartbeatEveryMs: number;
      staleAfterMs: number;
    }>("/api/lock/heartbeat", {
      method: "POST",
      body: JSON.stringify({ path, token }),
    }),
  releaseLock: (path: string, token: string, init?: { keepalive?: boolean }) =>
    request<void>("/api/lock/release", {
      method: "POST",
      body: JSON.stringify({ path, token }),
      keepalive: init?.keepalive,
    }),
  referenceSync: () =>
    request<{
      manifest: {
        lastSyncedAt: string | null;
        attribution: string;
        license: string;
        sources: string[];
        pages: {
          id: string;
          title: string;
          sourceUrl: string;
          filename: string;
        }[];
      };
      pages: {
        id: string;
        title: string;
        sourceUrl: string;
        filename: string;
      }[];
    }>("/api/reference/sync", { method: "POST" }),
};
