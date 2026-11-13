export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  mtimeMs: number;
  size?: number;
  children?: TreeNode[];
};

export type FilePayload = {
  path: string;
  name: string;
  content: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

export type FileWriteResult = {
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  content?: string;
  unchanged?: boolean;
  revisionId?: string;
};

export type TrashItem = {
  id: string;
  originalPath: string;
  name: string;
  type: "file" | "folder";
  deletedAt: string;
  favorites: string[];
};

export type RevisionSummary = {
  id: string;
  createdAt: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

export type DiagramMeta = {
  path: string;
  title: string | null;
  description: string;
  notes: string;
  tags: string[];
  theme: string | null;
  look: string | null;
  layout: string | null;
  malformed: boolean;
  error: string | null;
  cacheKey: string;
};

export type DiagramSearchHit = {
  path: string;
  name: string;
  title: string | null;
  rank: number;
  field: string;
  element: string | null;
  label: string;
  line: number | null;
  snippet: string;
  matchStart: number;
  matchLength: number;
};

export type DiagramSearchResponse = {
  query: string;
  truncated: boolean;
  hits: DiagramSearchHit[];
};

export type TemplateSummary = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  theme: string | null;
  diagramType: string;
  cacheKey: string;
  malformed: boolean;
  error: string | null;
  source: string;
};

export type ThumbnailPayload = {
  hit: boolean;
  path: string;
  cacheKey: string;
  mtimeMs: number;
  svg?: string;
};

export type FolderListing = {
  path: string;
  folders: TreeNode[];
  files: TreeNode[];
};

export type ImportFileResult = {
  name: string;
  status: "created" | "renamed" | "replaced" | "skipped" | "collision" | "error";
  path?: string;
  suggestedPath?: string;
  code?: string;
  error?: string;
};

export type SyncConflict = {
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
  tokenSource: "env" | "file" | null;
  repo: { owner: string; name: string; private: boolean; htmlUrl: string } | null;
  lastSyncAt: string | null;
  pending: boolean;
  ahead: number;
  behind: number;
  idleMs: number;
  syncing: boolean;
  error: { code: string; message: string; docsUrl?: string } | null;
  conflicts: SyncConflict[];
  device: { userCode: string; verificationUri: string; expiresAt: string } | null;
  docsUrl: string;
  mirror: string;
  disconnected?: boolean;
  repoRemains?: boolean;
  grantRevoked?: boolean;
  revokeUrl?: string;
};
