import { basename, joinPath, parentPath } from "./paths";
import type { TreeNode } from "../types";

/**
 * Naming matches `resolveAvailablePath` in server/src/storage.ts.
 * `word: "copy"` yields `Name (copy).mmd`, then `Name (copy 2).mmd`.
 * No word yields `Name 2.mmd`, which import uses for an explicit rename.
 */
export function insertNameSuffix(relativePath: string, suffix: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : "";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const renamed = base.toLowerCase().endsWith(".mmd")
    ? `${base.slice(0, -".mmd".length)}${suffix}.mmd`
    : `${base}${suffix}`;
  return dir ? `${dir}/${renamed}` : renamed;
}

export function nextAvailablePath(
  desired: string,
  isTaken: (candidate: string) => boolean,
  word?: string,
): string | null {
  if (!isTaken(desired)) return desired;
  const start = word ? 1 : 2;
  for (let n = start; n < 1000; n += 1) {
    const suffix = word ? (n === 1 ? ` (${word})` : ` (${word} ${n})`) : ` ${n}`;
    const candidate = insertNameSuffix(desired, suffix);
    if (!isTaken(candidate)) return candidate;
  }
  return null;
}

export function collectPaths(nodes: TreeNode[]): Set<string> {
  const paths = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      paths.add(node.path);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}

export function destinationPath(itemPath: string, toFolder: string): string {
  return joinPath(toFolder, basename(itemPath));
}

/** Why a move must not be offered. `null` means the folder is a valid target. */
export function moveBlockReason(
  itemPath: string,
  isFolder: boolean,
  toFolder: string,
): string | null {
  if (parentPath(itemPath) === toFolder) {
    return "That item is already in this folder.";
  }
  if (isFolder && (toFolder === itemPath || toFolder.startsWith(`${itemPath}/`))) {
    return "A folder cannot be moved into itself or one of its subfolders.";
  }
  return null;
}

export function dropMoveState(
  item: { path: string; type: "file" | "folder" },
  toFolder: string,
  taken: Set<string>,
): { ok: true } | { ok: false; reason: string } {
  const blocked = moveBlockReason(item.path, item.type === "folder", toFolder);
  if (blocked) return { ok: false, reason: blocked };
  if (taken.has(destinationPath(item.path, toFolder))) {
    const name = basename(item.path);
    return {
      ok: false,
      reason: `${name} is already in that folder. Use Move to… to keep both.`,
    };
  }
  return { ok: true };
}

export function relocatedFolder(
  current: string,
  from: string,
  to: string,
  isFolder: boolean,
): string {
  if (!isFolder) return current;
  if (current === from) return to;
  if (current.startsWith(`${from}/`)) return `${to}${current.slice(from.length)}`;
  return current;
}

export function explainOrganizeError(err: unknown): string {
  const code =
    err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;
  if (code === "locked") {
    return "This item is open in an editor. Close that editor, then try again.";
  }
  if (code === "descendant") {
    return "A folder cannot be moved into itself or one of its subfolders.";
  }
  if (code === "collision") {
    return "Something already exists at that path.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}

const IMPORT_EXTENSIONS = [".mmd", ".md", ".txt"];

function hasForbiddenNameChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32) return true;
    if (char === "<" || char === ">" || char === ":" || char === '"' || char === "|" || char === "?" || char === "*") {
      return true;
    }
  }
  return false;
}

/** Keep in sync with `diagramNameFromImport` in server/src/import.ts. */
export function diagramNameFromImport(rawName: string): { name?: string; error?: string } {
  const normalized = rawName.replace(/\\/g, "/").trim();
  const base = normalized.split("/").filter((part) => part.length > 0).pop() ?? "";
  if (!base || base === "." || base === ".." || base.startsWith(".")) {
    return { error: "That file name is not allowed." };
  }
  if (hasForbiddenNameChar(base)) {
    return { error: "That file name is not allowed." };
  }
  const lower = base.toLowerCase();
  const ext = IMPORT_EXTENSIONS.find((item) => lower.endsWith(item));
  if (!ext) {
    return { error: "Only .mmd, .md, and .txt files can be imported." };
  }
  const stem = base.slice(0, -ext.length).trim().replace(/[. ]+$/g, "");
  if (!stem || stem.startsWith(".")) {
    return { error: "That file name is not allowed." };
  }
  return { name: `${stem}.mmd` };
}
