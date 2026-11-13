import { getFavoritesPath } from "./paths.js";
import {
  atomicWriteJson,
  normalizeRelative,
  readJsonFile,
  rewriteMovedPath,
} from "./storage.js";

export async function getFavorites(): Promise<string[]> {
  try {
    const parsed = await readJsonFile<unknown>(getFavoritesPath());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export async function setFavorites(paths: string[]): Promise<string[]> {
  const unique = [...new Set(paths.map((entry) => normalizeRelative(entry)).filter(Boolean))];
  await atomicWriteJson(getFavoritesPath(), unique);
  return unique;
}

export async function toggleFavorite(relativePath: string): Promise<{
  favorites: string[];
  favorited: boolean;
}> {
  const current = await getFavorites();
  const normalized = normalizeRelative(relativePath);
  const index = current.findIndex((entry) => normalizeRelative(entry) === normalized);
  let favorited: boolean;
  if (index >= 0) {
    current.splice(index, 1);
    favorited = false;
  } else {
    current.push(normalized);
    favorited = true;
  }
  const favorites = await setFavorites(current);
  return { favorites, favorited };
}

export function favoritePathsFor(
  favorites: readonly string[],
  relativePath: string,
  isDir: boolean,
): string[] {
  const normalized = normalizeRelative(relativePath);
  return favorites
    .map((entry) => normalizeRelative(entry))
    .filter((entry) => entry === normalized || (isDir && entry.startsWith(`${normalized}/`)));
}

/** Remove favorites for a trashed path and return the ones that were stored. */
export async function takeFavorites(relativePath: string, isDir: boolean): Promise<string[]> {
  const current = await getFavorites();
  const taken = favoritePathsFor(current, relativePath, isDir);
  if (taken.length === 0) return [];
  const takenSet = new Set(taken);
  const next = current.filter((entry) => !takenSet.has(normalizeRelative(entry)));
  await setFavorites(next);
  return taken;
}

export async function addFavorites(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const current = await getFavorites();
  const next = [...current];
  for (const entry of paths) {
    const normalized = normalizeRelative(entry);
    if (!normalized || next.some((existing) => normalizeRelative(existing) === normalized)) {
      continue;
    }
    next.push(normalized);
  }
  if (next.length !== current.length) await setFavorites(next);
}

export async function rewriteFavoritePaths(
  fromPath: string,
  toPath: string,
  isDir: boolean,
): Promise<void> {
  const current = await getFavorites();
  let changed = false;
  const next = current.map((entry) => {
    const rewritten = rewriteMovedPath(entry, fromPath, toPath, isDir);
    if (rewritten !== normalizeRelative(entry)) changed = true;
    return rewritten;
  });
  if (changed) await setFavorites(next);
}
