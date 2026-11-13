import type { LintDiagnostic } from "../../server/src/diagramLint.ts";
import type {
  DiagramMeta,
  DiagramSearchResponse,
  FilePayload,
  FileWriteResult,
  SyncStatus,
  TemplateSummary,
  ThumbnailPayload,
  FolderListing,
  ImportFileResult,
  RevisionSummary,
  TrashItem,
  TreeNode,
  UpdateJob,
  UpdateStatus,
  VersionInfo,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly path?: string;
  readonly suggestedPath?: string;
  readonly files?: string[];
  readonly errors?: { row: number; message: string }[];
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
    this.files = Array.isArray(body.files)
      ? body.files.filter((item): item is string => typeof item === "string")
      : undefined;
    this.errors = Array.isArray(body.errors)
      ? body.errors.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = (item as { row?: unknown }).row;
          const message = (item as { message?: unknown }).message;
          if (typeof row !== "number" || typeof message !== "string") return [];
          return [{ row, message }];
        })
      : undefined;
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
  thumbnail: (path: string) =>
    request<ThumbnailPayload>(`/api/thumbnail?path=${encodeURIComponent(path)}`),
  saveThumbnail: (path: string, cacheKey: string, svg: string) =>
    request<{ path: string; cacheKey: string; mtimeMs: number }>("/api/thumbnail", {
      method: "PUT",
      body: JSON.stringify({ path, cacheKey, svg }),
    }),
  diagramMeta: () => request<{ diagrams: DiagramMeta[] }>("/api/diagram-meta"),
  lintSource: (source: string, diagramPaths?: string[], sourcePath?: string) =>
    request<{ diagnostics: LintDiagnostic[] }>("/api/lint", {
      method: "POST",
      body: JSON.stringify({ source, diagramPaths, sourcePath }),
    }),
  diagramLinks: (path: string) =>
    request<{
      path: string;
      linksTo: { path: string | null; target: string; line: number; broken: boolean }[];
      linkedFrom: { path: string; target: string; line: number }[];
    }>(`/api/diagram-links?path=${encodeURIComponent(path)}`),
  diagramLint: () =>
    request<{ checked: number; diagrams: { path: string; diagnostics: LintDiagnostic[] }[] }>("/api/diagram-lint"),
  search: (query: string, options?: { namesOnly?: boolean; signal?: AbortSignal }) => {
    const params = new URLSearchParams({ q: query });
    if (options?.namesOnly) params.set("names", "1");
    return request<DiagramSearchResponse>(`/api/search?${params.toString()}`, {
      signal: options?.signal,
    });
  },
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
  rename: (from: string, to: string, updateLinks = false) =>
    request<{ path: string; updated?: string[] }>("/api/rename", {
      method: "PATCH",
      body: JSON.stringify({ from, to, updateLinks }),
    }),
  move: (from: string, toFolder: string, updateLinks = false) =>
    request<{ path: string; updated?: string[] }>("/api/move", {
      method: "POST",
      body: JSON.stringify({ from, toFolder, updateLinks }),
    }),
  duplicate: (path: string) =>
    request<{ path: string; type: "file" | "folder" }>("/api/duplicate", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  previewGenerate: (body: {
    text: string;
    format?: string;
    shape?: string;
    mapping?: Record<string, string>;
    edgesText?: string;
    edgesFormat?: string;
    edgesMapping?: Record<string, string>;
    direction?: string;
    grouping?: boolean;
    title?: string;
    sourceFile?: string;
    edgesFile?: string;
  }) =>
    request<{
      format: "csv" | "json";
      shape: "links" | "nodes" | "edges" | "graph";
      headers: string[];
      edgesHeaders: string[];
      mapping: Record<string, string>;
      edgesMapping: Record<string, string>;
      errors: { row: number; message: string }[];
      warnings: { row: number; message: string }[];
      mermaid: string;
      counts: { nodes: number; edges: number; groups: number };
      direction: "TD" | "TB" | "LR" | "RL" | "BT";
      grouping: boolean;
    }>("/api/generate/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createGenerate: (body: {
    text: string;
    path: string;
    format?: string;
    shape?: string;
    mapping?: Record<string, string>;
    edgesText?: string;
    edgesMapping?: Record<string, string>;
    direction?: string;
    grouping?: boolean;
    title?: string;
    description?: string;
    sourceFile?: string;
    storeData?: boolean;
    dataName?: string;
  }) =>
    request<{ path: string; dataPath: string; edgesPath: string; mermaid: string }>("/api/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  refreshGenerate: (body: {
    path: string;
    diagramText?: string;
    text?: string;
    edgesText?: string;
    writeData?: boolean;
  }) =>
    request<{
      path: string;
      dataPath: string;
      mermaid: string;
      warnings: { row: number; message: string }[];
      counts: { nodes: number; edges: number; groups: number };
      diff: {
        nodes: {
          added: { id: string; label: string }[];
          removed: { id: string; label: string }[];
          changed: { id: string; label: string; before: string; after: string; fields: string[] }[];
        };
        edges: {
          added: { source: string; target: string; label: string }[];
          removed: { source: string; target: string; label: string }[];
          changed: { source: string; target: string; before: string; after: string }[];
        };
      };
    }>("/api/generate/refresh", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  importFiles: (
    folder: string,
    files: { name: string; text: string; onCollision?: "rename" | "skip" | "replace" }[],
  ) =>
    request<{ folder: string; results: ImportFileResult[] }>("/api/import", {
      method: "POST",
      body: JSON.stringify({ folder, files }),
    }),
  delete: (path: string, confirmLinks = false) =>
    request<void>(
      `/api/item?path=${encodeURIComponent(path)}${confirmLinks ? "&confirmLinks=1" : ""}`,
      { method: "DELETE" },
    ),
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
  takeoverLock: (path: string, sessionId: string) =>
    request<{
      path: string;
      token: string;
      sessionId: string;
      heartbeatAt: string;
      acquiredAt: string;
      heartbeatEveryMs: number;
      staleAfterMs: number;
    }>("/api/lock/takeover", {
      method: "POST",
      body: JSON.stringify({ path, sessionId }),
    }),
  templates: () => request<{ templates: TemplateSummary[] }>("/api/templates"),
  template: (id: string) =>
    request<TemplateSummary>(`/api/templates/${encodeURIComponent(id)}`),
  createFromTemplate: (id: string, body: { name?: string; folder?: string }) =>
    request<FileWriteResult & { templateId: string }>(
      `/api/templates/${encodeURIComponent(id)}/use`,
      {
        method: "POST",
        body: JSON.stringify({
          name: body.name ?? "",
          folder: body.folder ?? "",
        }),
      },
    ),
  syncStatus: () => request<SyncStatus>("/api/sync/status"),
  saveGithubClientId: (clientId: string) =>
    request<SyncStatus>("/api/sync/client-id", {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }),
  startGithubDevice: () =>
    request<SyncStatus>("/api/sync/device/start", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  connectGithub: (input: { name?: string; private?: boolean; confirmNonEmpty?: boolean }) =>
    request<SyncStatus>("/api/sync/connect", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  syncNow: () =>
    request<SyncStatus>("/api/sync/now", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  pullGithub: () =>
    request<SyncStatus>("/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  resolveGithub: (choices: { path: string; choice: "local" | "remote" | "both" }[]) =>
    request<SyncStatus>("/api/sync/resolve", {
      method: "POST",
      body: JSON.stringify({ choices }),
    }),
  disableGithub: (confirm: boolean) =>
    request<SyncStatus & { disconnected?: boolean; repoRemains?: boolean; grantRevoked?: boolean; revokeUrl?: string }>(
      "/api/sync/disable",
      {
        method: "POST",
        body: JSON.stringify({ confirm }),
      },
    ),
  version: () => request<VersionInfo>("/api/version"),
  updates: () => request<UpdateStatus>("/api/updates"),
  updateJob: () => request<{ job: UpdateJob | null }>("/api/updates/job"),
  checkUpdates: () =>
    request<UpdateStatus>("/api/updates/check", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  updateSettings: (body: { automatic?: boolean; includePrerelease?: boolean; clearSkipped?: boolean }) =>
    request<UpdateStatus>("/api/updates/settings", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  skipUpdate: () =>
    request<UpdateStatus>("/api/updates/skip", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  laterUpdate: () =>
    request<UpdateStatus>("/api/updates/later", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  applyUpdate: () =>
    request<{ job: UpdateJob }>("/api/updates/apply", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  listTokens: () =>
    request<{
      tokens: {
        id: string;
        name: string;
        prefix: string;
        scope: "read" | "read-write";
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      }[];
    }>("/api/tokens"),
  createToken: (name: string, scope: "read" | "read-write") =>
    request<{
      token: string;
      tokenMeta: {
        id: string;
        name: string;
        prefix: string;
        scope: "read" | "read-write";
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      };
    }>("/api/tokens", {
      method: "POST",
      body: JSON.stringify({ name, scope }),
    }),
  revokeToken: (id: string) =>
    request<{
      token: {
        id: string;
        name: string;
        prefix: string;
        scope: "read" | "read-write";
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      };
    }>(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
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
