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

export type FolderListing = {
  path: string;
  folders: TreeNode[];
  files: TreeNode[];
};
