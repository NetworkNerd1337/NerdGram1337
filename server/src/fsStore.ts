import fs from "node:fs/promises";
import path from "node:path";
import { rewriteFavoritePaths } from "./favorites.js";
import { readRevision, relocateHistory, snapshotPrevious } from "./history.js";
import { assertUnlocked, assertWriteAllowed, relocateLocks } from "./locks.js";
import {
  ensureDataRoot,
  META_DIR_NAME,
  resolveSafePath,
  toRelativePath,
} from "./paths.js";
import { moveToTrash } from "./trash.js";
import {
  atomicWriteText,
  evaluateWrite,
  hashContent,
  httpFail,
  normalizeRelative,
  pathExists,
  type DiskState,
  type WriteBaseline,
} from "./storage.js";

export type { TrashItem } from "./trash.js";
export { getFavorites, setFavorites, toggleFavorite } from "./favorites.js";

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  mtimeMs: number;
  size?: number;
  children?: TreeNode[];
};

export type WriteOptions = WriteBaseline & {
  lockToken?: string | null;
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
    folders: tree.filter((node) => node.type === "folder"),
    files: tree.filter((node) => node.type === "file"),
  };
}

async function readDisk(abs: string): Promise<DiskState> {
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw httpFail(400, "Not a diagram file", "invalid");
    const content = await fs.readFile(abs, "utf8");
    return {
      exists: true,
      content,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      hash: hashContent(content),
    };
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { exists: false };
    throw err;
  }
}

function requireDiagram(relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!isDiagramFile(normalized)) {
    throw httpFail(400, "Only .mmd diagram files are supported", "invalid");
  }
  return normalized;
}

export async function readFile(relativePath: string): Promise<{
  path: string;
  name: string;
  content: string;
  mtimeMs: number;
  size: number;
  hash: string;
}> {
  const normalized = requireDiagram(relativePath);
  const abs = resolveSafePath(normalized);
  const disk = await readDisk(abs);
  if (!disk.exists) throw httpFail(404, "Not found", "not_found");
  return {
    path: toRelativePath(abs),
    name: path.basename(abs),
    content: disk.content,
    mtimeMs: disk.mtimeMs,
    size: disk.size,
    hash: disk.hash,
  };
}

export async function writeFile(
  relativePath: string,
  content: string,
  options: WriteOptions = {},
): Promise<{
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  unchanged?: boolean;
  revisionId?: string;
}> {
  const normalized = requireDiagram(relativePath);
  const abs = resolveSafePath(normalized);
  const relative = toRelativePath(abs);
  await assertWriteAllowed(relative, options.lockToken);

  const disk = await readDisk(abs);
  const decision = evaluateWrite(disk, { ...options, content });

  if (decision.action === "reject") {
    if (decision.code === "missing") {
      throw httpFail(409, "This diagram is no longer on disk.", "missing");
    }
    if (decision.code === "exists") {
      throw httpFail(
        409,
        "A diagram already exists at that path. Choose a different name.",
        "exists",
        { path: relative },
      );
    }
    if (!disk.exists) throw httpFail(409, "This diagram changed on disk.", "conflict");
    throw httpFail(409, "This diagram changed on disk since it was last loaded.", "conflict", {
      current: {
        path: relative,
        content: disk.content,
        mtimeMs: disk.mtimeMs,
        size: disk.size,
        hash: disk.hash,
      },
    });
  }

  if (decision.action === "unchanged" && disk.exists) {
    return {
      path: relative,
      mtimeMs: disk.mtimeMs,
      size: disk.size,
      hash: disk.hash,
      unchanged: true,
    };
  }

  let revisionId: string | undefined;
  if (decision.action === "overwrite" && disk.exists) {
    revisionId = await snapshotPrevious(relative, disk);
  }

  await fs.mkdir(path.dirname(abs), { recursive: true });
  await atomicWriteText(abs, content);
  const stat = await fs.stat(abs);
  return {
    path: relative,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    hash: hashContent(content),
    revisionId,
  };
}

export async function restoreRevision(
  relativePath: string,
  id: string,
  lockToken?: string | null,
): Promise<{
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  content: string;
  unchanged?: boolean;
  revisionId?: string;
}> {
  const revision = await readRevision(relativePath, id);
  const written = await writeFile(relativePath, revision.content, { force: true, lockToken });
  return { ...written, content: revision.content };
}

export async function createFolder(relativePath: string): Promise<{ path: string }> {
  const cleaned = normalizeRelative(relativePath);
  if (!cleaned) throw httpFail(400, "Folder path required", "invalid");
  const abs = resolveSafePath(cleaned);
  await fs.mkdir(abs, { recursive: true });
  return { path: toRelativePath(abs) };
}

export async function renameItem(fromPath: string, toPath: string): Promise<{ path: string }> {
  const fromAbs = resolveSafePath(fromPath);
  const toAbs = resolveSafePath(toPath);
  if (path.resolve(fromAbs) === path.resolve(toAbs)) {
    return { path: toRelativePath(fromAbs) };
  }

  let fromStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    fromStat = await fs.stat(fromAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Not found", "not_found");
    throw err;
  }

  if (fromStat.isFile() && !isDiagramFile(toPath)) {
    throw httpFail(400, "Diagram files must use .mmd extension", "invalid");
  }
  if (await pathExists(toAbs)) {
    throw httpFail(409, "Something already exists at that path.", "collision", {
      path: toRelativePath(toAbs),
    });
  }

  const fromRel = toRelativePath(fromAbs);
  await assertUnlocked(fromRel, fromStat.isDirectory());
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);
  const toRel = toRelativePath(toAbs);
  await rewriteFavoritePaths(fromRel, toRel, fromStat.isDirectory());
  await relocateHistory(fromRel, toRel, fromStat.isDirectory());
  await relocateLocks(fromRel, toRel, fromStat.isDirectory());
  return { path: toRel };
}

export async function moveItem(fromPath: string, toFolder: string): Promise<{ path: string }> {
  const name = path.posix.basename(normalizeRelative(fromPath));
  const folder = normalizeRelative(toFolder);
  const dest = folder ? `${folder}/${name}` : name;
  return renameItem(fromPath, dest);
}

export async function deleteItem(relativePath: string): Promise<void> {
  await moveToTrash(relativePath);
}
