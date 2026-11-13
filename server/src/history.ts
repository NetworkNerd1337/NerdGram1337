import fs from "node:fs/promises";
import path from "node:path";
import {
  REVISION_RETENTION,
  assertSafeId,
  atomicWriteJson,
  atomicWriteText,
  createId,
  decodeStorageKey,
  encodeStorageKey,
  getVersionsRoot,
  httpFail,
  normalizeRelative,
  pathExists,
  readJsonFile,
  rewriteMovedPath,
} from "./storage.js";

export type RevisionMeta = {
  id: string;
  createdAt: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

type RevisionIndex = {
  path: string;
  revisions: RevisionMeta[];
};

function versionDirFor(relativePath: string): string {
  return path.join(getVersionsRoot(), encodeStorageKey(relativePath));
}

function indexPath(dir: string): string {
  return path.join(dir, "index.json");
}

async function loadIndex(dir: string, fallbackPath: string): Promise<RevisionIndex> {
  const parsed = await readJsonFile<RevisionIndex>(indexPath(dir));
  if (!parsed || !Array.isArray(parsed.revisions)) {
    return { path: fallbackPath, revisions: [] };
  }
  return {
    path: typeof parsed.path === "string" ? parsed.path : fallbackPath,
    revisions: parsed.revisions.filter(
      (revision): revision is RevisionMeta =>
        !!revision &&
        typeof revision.id === "string" &&
        typeof revision.createdAt === "string" &&
        typeof revision.mtimeMs === "number" &&
        typeof revision.size === "number" &&
        typeof revision.hash === "string",
    ),
  };
}

async function saveIndex(dir: string, index: RevisionIndex): Promise<void> {
  await atomicWriteJson(indexPath(dir), index);
}

async function prune(dir: string, index: RevisionIndex): Promise<void> {
  // Oldest first. Equal timestamps keep append order (sort is stable) so a
  // burst of saves still drops the earliest ones.
  index.revisions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (index.revisions.length > REVISION_RETENTION) {
    const dropped = index.revisions.shift();
    if (!dropped) break;
    await fs.rm(path.join(dir, `${dropped.id}.mmd`), { force: true });
  }
}

/**
 * Store the bytes that are about to be replaced. The new bytes stay in the
 * live `.mmd` file, so history is the previous saves, not a second copy of
 * the current one.
 */
export async function snapshotPrevious(
  relativePath: string,
  previous: { content: string; mtimeMs: number; size: number; hash: string },
): Promise<string> {
  const normalized = normalizeRelative(relativePath);
  const dir = versionDirFor(normalized);
  await fs.mkdir(dir, { recursive: true });
  const index = await loadIndex(dir, normalized);
  const id = createId();
  await atomicWriteText(path.join(dir, `${id}.mmd`), previous.content);
  index.path = normalized;
  index.revisions.push({
    id,
    createdAt: new Date().toISOString(),
    mtimeMs: previous.mtimeMs,
    size: previous.size,
    hash: previous.hash,
  });
  await prune(dir, index);
  await saveIndex(dir, index);
  return id;
}

export async function listRevisions(relativePath: string): Promise<RevisionMeta[]> {
  const dir = versionDirFor(relativePath);
  if (!(await pathExists(dir))) return [];
  const index = await loadIndex(dir, normalizeRelative(relativePath));
  return [...index.revisions].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

export async function readRevision(
  relativePath: string,
  id: string,
): Promise<RevisionMeta & { content: string }> {
  assertSafeId(id);
  const dir = versionDirFor(relativePath);
  const index = await loadIndex(dir, normalizeRelative(relativePath));
  const meta = index.revisions.find((revision) => revision.id === id);
  if (!meta) {
    throw httpFail(404, "Revision not found", "not_found");
  }
  try {
    const content = await fs.readFile(path.join(dir, `${id}.mmd`), "utf8");
    return { ...meta, content };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Revision not found", "not_found");
    throw err;
  }
}

async function matchingVersionDirs(
  relativePath: string,
  isDir: boolean,
): Promise<{ key: string; itemPath: string; dir: string }[]> {
  const root = getVersionsRoot();
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const from = normalizeRelative(relativePath);
  const matches: { key: string; itemPath: string; dir: string }[] = [];
  for (const key of names) {
    const itemPath = decodeStorageKey(key);
    if (!itemPath) continue;
    const hit = itemPath === from || (isDir && itemPath.startsWith(`${from}/`));
    if (!hit) continue;
    matches.push({ key, itemPath, dir: path.join(root, key) });
  }
  return matches;
}

async function writeMovedIndex(dir: string, nextPath: string): Promise<void> {
  const index = await loadIndex(dir, nextPath);
  index.path = nextPath;
  await saveIndex(dir, index);
}

async function moveVersionDir(fromDir: string, nextPath: string): Promise<void> {
  const dest = versionDirFor(nextPath);
  if (path.resolve(fromDir) === path.resolve(dest)) {
    await writeMovedIndex(dest, nextPath);
    return;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (await pathExists(dest)) {
    const incoming = await loadIndex(fromDir, nextPath);
    const existing = await loadIndex(dest, nextPath);
    for (const revision of incoming.revisions) {
      const source = path.join(fromDir, `${revision.id}.mmd`);
      if (await pathExists(source)) {
        await fs.rename(source, path.join(dest, `${revision.id}.mmd`));
      }
      if (!existing.revisions.some((item) => item.id === revision.id)) {
        existing.revisions.push(revision);
      }
    }
    existing.path = nextPath;
    await prune(dest, existing);
    await saveIndex(dest, existing);
    await fs.rm(fromDir, { recursive: true, force: true });
    return;
  }
  await fs.rename(fromDir, dest);
  await writeMovedIndex(dest, nextPath);
}

export async function relocateHistory(
  fromPath: string,
  toPath: string,
  isDir: boolean,
): Promise<void> {
  const matches = await matchingVersionDirs(fromPath, isDir);
  for (const match of matches) {
    const nextPath = rewriteMovedPath(match.itemPath, fromPath, toPath, isDir);
    await moveVersionDir(match.dir, nextPath);
  }
}

export async function archiveHistory(
  fromPath: string,
  isDir: boolean,
  destDir: string,
): Promise<void> {
  const matches = await matchingVersionDirs(fromPath, isDir);
  if (matches.length === 0) return;
  await fs.mkdir(destDir, { recursive: true });
  for (const match of matches) {
    const target = path.join(destDir, match.key);
    if (await pathExists(target)) continue;
    await fs.rename(match.dir, target);
  }
}

export async function unarchiveHistory(
  archiveDir: string,
  originalPath: string,
  restoredPath: string,
  isDir: boolean,
): Promise<void> {
  let names: string[] = [];
  try {
    names = await fs.readdir(archiveDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  for (const key of names) {
    const itemPath = decodeStorageKey(key);
    if (!itemPath) continue;
    const source = path.join(archiveDir, key);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const nextPath = rewriteMovedPath(itemPath, originalPath, restoredPath, isDir);
    await moveVersionDir(source, nextPath);
  }
}
