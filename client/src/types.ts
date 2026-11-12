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
};

export type FolderListing = {
  path: string;
  folders: TreeNode[];
  files: TreeNode[];
};
