import fs from "node:fs/promises";
import path from "node:path";
import { relocatedCompanionPath, rewriteSourcePrefix } from "./diagramCompanions.js";
import { readDataSource, replaceDataSourcePaths } from "./diagramData.js";
import { addFavorites, favoritePathsFor, getFavorites, takeFavorites } from "./favorites.js";
import { archiveHistory, unarchiveHistory } from "./history.js";
import { archiveThumbnails, unarchiveThumbnails } from "./thumbnails.js";
import { assertUnlocked, discardLocks } from "./locks.js";
import { ensureDataRoot, resolveSafePath, toRelativePath } from "./paths.js";
import {
  assertSafeId,
  atomicWriteJson,
  createId,
  getTrashRoot,
  httpFail,
  normalizeRelative,
  pathExists,
  readJsonFile,
  resolveAvailablePath,
  rewriteMovedPath,
} from "./storage.js";

export type TrashItem = {
  id: string;
  originalPath: string;
  name: string;
  type: "file" | "folder";
  deletedAt: string;
  favorites: string[];
};

type TrashDataFile = {
  originalPath: string;
  name: string;
  storedName: string;
};

type TrashManifest = TrashItem & {
  ready: boolean;
  dataFiles?: TrashDataFile[];
};

function itemsRoot(): string {
  return path.join(getTrashRoot(), "items");
}

function itemDir(id: string): string {
  return path.join(itemsRoot(), id);
}

function manifestFile(id: string): string {
  return path.join(itemDir(id), "manifest.json");
}

function payloadFile(id: string, type: "file" | "folder"): string {
  return path.join(itemDir(id), type === "file" ? "payload.mmd" : "payload");
}

function dataStore(id: string): string {
  return path.join(itemDir(id), "data");
}

function versionsArchive(id: string): string {
  return path.join(itemDir(id), "versions");
}

function thumbsArchive(id: string): string {
  return path.join(itemDir(id), "thumbs");
}

function toPublic(manifest: TrashManifest): TrashItem {
  return {
    id: manifest.id,
    originalPath: manifest.originalPath,
    name: manifest.name,
    type: manifest.type,
    deletedAt: manifest.deletedAt,
    favorites: Array.isArray(manifest.favorites) ? manifest.favorites : [],
  };
}

async function writeManifest(manifest: TrashManifest): Promise<void> {
  await atomicWriteJson(manifestFile(manifest.id), manifest);
}

async function readManifest(id: string): Promise<TrashManifest | null> {
  const parsed = await readJsonFile<TrashManifest>(manifestFile(id));
  if (!parsed || parsed.id !== id || (parsed.type !== "file" && parsed.type !== "folder")) {
    return null;
  }
  if (typeof parsed.originalPath !== "string" || typeof parsed.deletedAt !== "string") return null;
  return {
    ...parsed,
    name: parsed.name || path.basename(parsed.originalPath),
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    dataFiles: readDataFiles(parsed.dataFiles),
    ready: parsed.ready === true,
  };
}

function readDataFiles(value: unknown): TrashDataFile[] {
  if (!Array.isArray(value)) return [];
  const files: TrashDataFile[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<TrashDataFile>;
    if (
      typeof record.originalPath !== "string" ||
      typeof record.name !== "string" ||
      typeof record.storedName !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,160}$/i.test(record.storedName)
    ) {
      continue;
    }
    files.push({
      originalPath: record.originalPath,
      name: record.name,
      storedName: record.storedName,
    });
  }
  return files;
}

export async function relativePathTaken(relativePath: string): Promise<boolean> {
  return pathExists(resolveSafePath(relativePath));
}

async function finishMove(manifest: TrashManifest): Promise<TrashItem> {
  const isDir = manifest.type === "folder";
  await archiveHistory(manifest.originalPath, isDir, versionsArchive(manifest.id));
  await archiveThumbnails(manifest.originalPath, isDir, thumbsArchive(manifest.id));
  await discardLocks(manifest.originalPath, isDir);
  const taken = await takeFavorites(manifest.originalPath, isDir);
  const favorites = [...new Set([...manifest.favorites, ...taken])];
  const ready: TrashManifest = { ...manifest, favorites, ready: true };
  await writeManifest(ready);
  return toPublic(ready);
}

export async function listTrash(): Promise<TrashItem[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(itemsRoot());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }

  const items: TrashItem[] = [];
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(name)) continue;
    const manifest = await readManifest(name);
    if (!manifest) continue;
    if (!manifest.ready) {
      const payload = payloadFile(manifest.id, manifest.type);
      if (!(await pathExists(payload))) {
        await fs.rm(itemDir(manifest.id), { recursive: true, force: true });
        continue;
      }
      items.push(await finishMove(manifest));
      continue;
    }
    items.push(toPublic(manifest));
  }

  items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || b.id.localeCompare(a.id));
  return items;
}

export async function moveToTrash(
  relativePath: string,
  options: { dataFiles?: readonly string[] } = {},
): Promise<TrashItem> {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) throw httpFail(400, "path is required", "invalid");

  const abs = resolveSafePath(normalized);
  const root = ensureDataRoot();
  if (path.resolve(abs) === path.resolve(root)) {
    throw httpFail(400, "Cannot delete data root", "invalid");
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Not found", "not_found");
    throw err;
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    throw httpFail(400, "Only files and folders can be trashed", "invalid");
  }

  const type: "file" | "folder" = stat.isDirectory() ? "folder" : "file";
  if (type === "file" && !normalized.toLowerCase().endsWith(".mmd")) {
    throw httpFail(400, "Only .mmd diagram files are supported", "invalid");
  }

  const originalPath = toRelativePath(abs);
  await assertUnlocked(originalPath, type === "folder");

  const id = createId();
  await fs.mkdir(itemDir(id), { recursive: true });
  const manifest: TrashManifest = {
    id,
    originalPath,
    name: path.basename(abs),
    type,
    deletedAt: new Date().toISOString(),
    favorites: favoritePathsFor(await getFavorites(), originalPath, type === "folder"),
    ready: false,
  };
  await writeManifest(manifest);
  await fs.rename(abs, payloadFile(id, type));
  const stored = await storeCompanionData(id, options.dataFiles ?? []);
  if (stored.length > 0) {
    manifest.dataFiles = stored;
    await writeManifest(manifest);
  }
  const search = await import("./search.js");
  await search.removeSearchEntries(originalPath, type === "folder");
  return finishMove(manifest);
}

async function storeCompanionData(id: string, dataFiles: readonly string[]): Promise<TrashDataFile[]> {
  if (dataFiles.length === 0) return [];
  await fs.mkdir(dataStore(id), { recursive: true });
  const stored: TrashDataFile[] = [];
  for (const [index, relativePath] of dataFiles.entries()) {
    const normalized = normalizeRelative(relativePath);
    if (!normalized) continue;
    const abs = resolveSafePath(normalized);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    const storedName = `${index}-${path.basename(abs)}`.replace(/[^a-z0-9.-]/gi, "_");
    await fs.copyFile(abs, path.join(dataStore(id), storedName));
    stored.push({ originalPath: normalized, name: path.basename(abs), storedName });
  }
  for (const item of stored) {
    await fs.rm(resolveSafePath(item.originalPath), { force: true });
  }
  return stored;
}

export async function restoreTrashItem(
  id: string,
  options: { destination?: string; overwrite?: boolean } = {},
): Promise<{ path: string; type: "file" | "folder" }> {
  assertSafeId(id);
  let manifest = await readManifest(id);
  if (!manifest) throw httpFail(404, "Trash item not found", "not_found");
  if (!manifest.ready) {
    if (!(await pathExists(payloadFile(id, manifest.type)))) {
      throw httpFail(404, "Trash item not found", "not_found");
    }
    await finishMove(manifest);
    manifest = (await readManifest(id)) ?? manifest;
  }

  const destination = normalizeRelative(options.destination || manifest.originalPath);
  if (!destination) throw httpFail(400, "path is required", "invalid");
  if (manifest.type === "file" && !destination.toLowerCase().endsWith(".mmd")) {
    throw httpFail(400, "Diagram files must use .mmd extension", "invalid");
  }

  const destAbs = resolveSafePath(destination);
  if (await pathExists(destAbs)) {
    if (!options.overwrite) {
      const suggestedPath = await resolveAvailablePath(destination, relativePathTaken, {
        word: "restored",
      });
      throw httpFail(409, "Something already exists at that path.", "collision", {
        path: destination,
        suggestedPath,
      });
    }
    await moveToTrash(destination);
  }

  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  const dataPlan =
    manifest.type === "file" ? await companionRestorePlan(manifest, destination) : [];
  if (manifest.type === "folder" && destination !== manifest.originalPath) {
    await rewritePayloadSources(payloadFile(id, "folder"), manifest.originalPath, destination);
  }
  if (manifest.type === "file" && dataPlan.length > 0) {
    await retargetPayloadData(id, dataPlan);
    await restoreCompanionData(id, dataPlan);
  }
  await fs.rename(payloadFile(id, manifest.type), destAbs);
  await unarchiveHistory(
    versionsArchive(id),
    manifest.originalPath,
    destination,
    manifest.type === "folder",
  );
  await unarchiveThumbnails(
    thumbsArchive(id),
    manifest.originalPath,
    destination,
    manifest.type === "folder",
  );
  const favorites = manifest.favorites.map((entry) =>
    rewriteMovedPath(entry, manifest.originalPath, destination, manifest.type === "folder"),
  );
  await addFavorites(favorites);
  await fs.rm(itemDir(id), { recursive: true, force: true });
  const restored = toRelativePath(destAbs);
  noteSync({ kind: "structural", summary: `Restore ${restored}` });
  return { path: restored, type: manifest.type };
}

async function companionRestorePlan(
  manifest: TrashManifest,
  destination: string,
): Promise<{ storedName: string; originalPath: string; dest: string }[]> {
  const plan: { storedName: string; originalPath: string; dest: string }[] = [];
  for (const data of manifest.dataFiles ?? []) {
    const desired =
      relocatedCompanionPath(manifest.originalPath, destination, data.originalPath) ?? data.originalPath;
    const dest = await resolveAvailablePath(desired, relativePathTaken, { word: "copy" });
    plan.push({ storedName: data.storedName, originalPath: data.originalPath, dest });
  }
  return plan;
}

async function retargetPayloadData(
  id: string,
  plan: readonly { originalPath: string; dest: string }[],
): Promise<void> {
  const payload = payloadFile(id, "file");
  const text = await fs.readFile(payload, "utf8");
  const source = readDataSource(text);
  if (!source) return;
  const file = plan.find((item) => normalizeRelative(item.originalPath) === normalizeRelative(source.file))?.dest;
  const edgesFile = source.edgesFile
    ? plan.find((item) => normalizeRelative(item.originalPath) === normalizeRelative(source.edgesFile ?? ""))?.dest
    : undefined;
  const next = replaceDataSourcePaths(text, {
    ...(file ? { file } : {}),
    ...(edgesFile ? { edgesFile } : {}),
  });
  if (next !== text) await fs.writeFile(payload, next);
}

async function restoreCompanionData(
  id: string,
  plan: readonly { storedName: string; dest: string }[],
): Promise<void> {
  for (const item of plan) {
    const stored = path.join(dataStore(id), item.storedName);
    const destAbs = resolveSafePath(item.dest);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.copyFile(stored, destAbs);
  }
}

async function rewritePayloadSources(payloadDir: string, fromDir: string, toDir: string): Promise<void> {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(payloadDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const abs = path.join(payloadDir, entry.name);
    if (entry.isDirectory()) {
      await rewritePayloadSources(abs, fromDir, toDir);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mmd")) continue;
    const text = await fs.readFile(abs, "utf8");
    const next = rewriteSourcePrefix(text, fromDir, toDir);
    if (next !== text) await fs.writeFile(abs, next);
  }
}

function noteSync(change: { kind: "content" | "structural"; summary: string }): void {
  void import("./sync/hooks.js")
    .then((mod) => mod.noteLocalChange(change))
    .catch(() => {
      console.error("GitHub sync could not record a local change");
    });
}

export async function purgeTrashItem(id: string): Promise<void> {
  assertSafeId(id);
  const manifest = await readManifest(id);
  if (!manifest) throw httpFail(404, "Trash item not found", "not_found");
  await fs.rm(itemDir(id), { recursive: true, force: true });
}

export async function emptyTrash(): Promise<{ purged: number }> {
  const items = await listTrash();
  for (const item of items) {
    await fs.rm(itemDir(item.id), { recursive: true, force: true });
  }
  return { purged: items.length };
}
