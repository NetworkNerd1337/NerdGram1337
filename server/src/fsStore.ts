import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureDataRoot,
  getFavoritesPath,
  getMetaPath,
  META_DIR_NAME,
  resolveSafePath,
  toRelativePath,
} from "./paths.js";

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  mtimeMs: number;
  size?: number;
  children?: TreeNode[];
};

const DIAGRAM_EXT = ".mmd";

function isDiagramFile(name: string): boolean {
  return name.toLowerCase().endsWith(DIAGRAM_EXT);
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

export async function buildTree(relativePath = ""): Promise<TreeNode[]> {
  ensureDataRoot();
  const abs = resolveSafePath(relativePath || ".");
  const entries = await readDirSafe(abs);
  const nodes: TreeNode[] = [];

  for (const name of entries) {
    if (name === META_DIR_NAME || name.startsWith(".")) continue;
    const childAbs = path.join(abs, name);
    const stat = await fs.stat(childAbs);
    const rel = toRelativePath(childAbs);

    if (stat.isDirectory()) {
      nodes.push({
        name,
        path: rel,
        type: "folder",
        mtimeMs: stat.mtimeMs,
        children: await buildTree(rel),
      });
    } else if (stat.isFile() && isDiagramFile(name)) {
      nodes.push({
        name,
        path: rel,
        type: "file",
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return nodes;
}

export async function listFolder(relativePath = ""): Promise<{
  path: string;
  folders: TreeNode[];
  files: TreeNode[];
}> {
  const tree = await buildTree(relativePath || ".");
  return {
    path: relativePath || "",
    folders: tree.filter((n) => n.type === "folder"),
    files: tree.filter((n) => n.type === "file"),
  };
}

export async function readFile(relativePath: string): Promise<{
  path: string;
  name: string;
  content: string;
  mtimeMs: number;
  size: number;
}> {
  if (!isDiagramFile(relativePath)) {
    throw Object.assign(new Error("Only .mmd diagram files are supported"), {
      status: 400,
    });
  }
  const abs = resolveSafePath(relativePath);
  const [content, stat] = await Promise.all([
    fs.readFile(abs, "utf8"),
    fs.stat(abs),
  ]);
  return {
    path: toRelativePath(abs),
    name: path.basename(abs),
    content,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

export async function writeFile(
  relativePath: string,
  content: string,
): Promise<{ path: string; mtimeMs: number; size: number }> {
  if (!isDiagramFile(relativePath)) {
    throw Object.assign(new Error("Only .mmd diagram files are supported"), {
      status: 400,
    });
  }
  const abs = resolveSafePath(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  const stat = await fs.stat(abs);
  return {
    path: toRelativePath(abs),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

export async function createFolder(relativePath: string): Promise<{ path: string }> {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned) {
    throw Object.assign(new Error("Folder path required"), { status: 400 });
  }
  if (cleaned.split("/").some((p) => p === META_DIR_NAME || p.startsWith("."))) {
    throw Object.assign(new Error("Invalid folder name"), { status: 400 });
  }
  const abs = resolveSafePath(cleaned);
  await fs.mkdir(abs, { recursive: true });
  return { path: toRelativePath(abs) };
}

export async function renameItem(
  fromPath: string,
  toPath: string,
): Promise<{ path: string }> {
  const fromAbs = resolveSafePath(fromPath);
  const toAbs = resolveSafePath(toPath);

  const fromStat = await fs.stat(fromAbs);
  if (fromStat.isFile() && !isDiagramFile(toPath)) {
    throw Object.assign(new Error("Diagram files must use .mmd extension"), {
      status: 400,
    });
  }

  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);
  await rewriteFavoritePaths(fromPath, toPath, fromStat.isDirectory());
  return { path: toRelativePath(toAbs) };
}

export async function moveItem(
  fromPath: string,
  toFolder: string,
): Promise<{ path: string }> {
  const name = path.basename(fromPath);
  const dest = toFolder ? `${toFolder.replace(/\/+$/, "")}/${name}` : name;
  return renameItem(fromPath, dest);
}

export async function deleteItem(relativePath: string): Promise<void> {
  const abs = resolveSafePath(relativePath);
  const root = ensureDataRoot();
  if (path.resolve(abs) === path.resolve(root)) {
    throw Object.assign(new Error("Cannot delete data root"), { status: 400 });
  }
  const stat = await fs.stat(abs);
  if (stat.isDirectory()) {
    await fs.rm(abs, { recursive: true, force: true });
  } else {
    await fs.unlink(abs);
  }
  await removeFavorite(relativePath, stat.isDirectory());
}

async function ensureMeta(): Promise<void> {
  await fs.mkdir(getMetaPath(), { recursive: true });
}

export async function getFavorites(): Promise<string[]> {
  await ensureMeta();
  try {
    const raw = await fs.readFile(getFavoritesPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string");
  } catch {
    return [];
  }
}

export async function setFavorites(paths: string[]): Promise<string[]> {
  await ensureMeta();
  const unique = [...new Set(paths.map((p) => p.replace(/\\/g, "/")))];
  await fs.writeFile(getFavoritesPath(), JSON.stringify(unique, null, 2), "utf8");
  return unique;
}

export async function toggleFavorite(relativePath: string): Promise<{
  favorites: string[];
  favorited: boolean;
}> {
  const current = await getFavorites();
  const normalized = relativePath.replace(/\\/g, "/");
  const idx = current.indexOf(normalized);
  let favorited: boolean;
  if (idx >= 0) {
    current.splice(idx, 1);
    favorited = false;
  } else {
    current.push(normalized);
    favorited = true;
  }
  const favorites = await setFavorites(current);
  return { favorites, favorited };
}

async function removeFavorite(relativePath: string, isDir: boolean): Promise<void> {
  const current = await getFavorites();
  const normalized = relativePath.replace(/\\/g, "/");
  const next = current.filter((p) => {
    if (p === normalized) return false;
    if (isDir && (p.startsWith(normalized + "/") || p.startsWith(normalized + "\\"))) {
      return false;
    }
    return true;
  });
  if (next.length !== current.length) {
    await setFavorites(next);
  }
}

async function rewriteFavoritePaths(
  fromPath: string,
  toPath: string,
  isDir: boolean,
): Promise<void> {
  const current = await getFavorites();
  const from = fromPath.replace(/\\/g, "/");
  const to = toPath.replace(/\\/g, "/");
  let changed = false;
  const next = current.map((p) => {
    if (p === from) {
      changed = true;
      return to;
    }
    if (isDir && p.startsWith(from + "/")) {
      changed = true;
      return to + p.slice(from.length);
    }
    return p;
  });
  if (changed) await setFavorites(next);
}
