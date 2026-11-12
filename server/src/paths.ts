import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: server/src -> server -> root */
export const REPO_ROOT = path.resolve(__dirname, "../..");

export function getDataRoot(): string {
  const fromEnv = process.env.NERDGRAM_DATA_DIR;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv);
  }
  return path.join(REPO_ROOT, "diagrams");
}

export function ensureDataRoot(): string {
  const root = getDataRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Resolve a user-supplied relative path under the data root.
 * Throws if the path escapes the root.
 */
export function resolveSafePath(relativePath: string): string {
  const root = ensureDataRoot();
  const cleaned = (relativePath || ".")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (cleaned.includes("\0")) {
    throw new Error("Invalid path");
  }

  const absolute = path.resolve(root, cleaned === "" ? "." : cleaned);
  const relative = path.relative(root, absolute);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes data directory");
  }

  return absolute;
}

export function toRelativePath(absolutePath: string): string {
  const root = ensureDataRoot();
  const relative = path.relative(root, absolutePath);
  return relative.split(path.sep).join("/");
}

export const META_DIR_NAME = ".meta";
export const FAVORITES_FILE = "favorites.json";

export function getMetaPath(): string {
  return path.join(ensureDataRoot(), META_DIR_NAME);
}

export function getFavoritesPath(): string {
  return path.join(getMetaPath(), FAVORITES_FILE);
}
