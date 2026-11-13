import fs from "node:fs/promises";
import path from "node:path";
import { addFavorites, favoritePathsFor, getFavorites, takeFavorites } from "./favorites.js";
import { archiveHistory, unarchiveHistory } from "./history.js";
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

type TrashManifest = TrashItem & { ready: boolean };

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

function versionsArchive(id: string): string {
  return path.join(itemDir(id), "versions");
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
    ready: parsed.ready === true,
  };
}

export async function relativePathTaken(relativePath: string): Promise<boolean> {
  return pathExists(resolveSafePath(relativePath));
}

async function finishMove(manifest: TrashManifest): Promise<TrashItem> {
  const isDir = manifest.type === "folder";
  await archiveHistory(manifest.originalPath, isDir, versionsArchive(manifest.id));
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

export async function moveToTrash(relativePath: string): Promise<TrashItem> {
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
  return finishMove(manifest);
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
  await fs.rename(payloadFile(id, manifest.type), destAbs);
  await unarchiveHistory(
    versionsArchive(id),
    manifest.originalPath,
    destination,
    manifest.type === "folder",
  );
  const favorites = manifest.favorites.map((entry) =>
    rewriteMovedPath(entry, manifest.originalPath, destination, manifest.type === "folder"),
  );
  await addFavorites(favorites);
  await fs.rm(itemDir(id), { recursive: true, force: true });
  return { path: toRelativePath(destAbs), type: manifest.type };
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
