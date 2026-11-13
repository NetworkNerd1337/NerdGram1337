import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataRoot, getMetaPath } from "../paths.js";
import { httpFail } from "../storage.js";
import {
  BOILERPLATE,
  CONFIG_FILE_NAME,
  CONFLICTS_FILE_NAME,
  MIRROR_DIR_NAME,
  TOKEN_FILE_NAME,
} from "./constants.js";

export function tokenPath(): string {
  return path.join(getMetaPath(), TOKEN_FILE_NAME);
}

export function configPath(): string {
  return path.join(getMetaPath(), CONFIG_FILE_NAME);
}

export function conflictsPath(): string {
  return path.join(getMetaPath(), CONFLICTS_FILE_NAME);
}

/**
 * The git working copy lives in a hidden directory under the data root.
 * `resolveSafePath` rejects dot segments, and `buildTree` skips them, so the
 * API cannot read or write this folder. It stays on the data volume for Docker.
 */
export function mirrorPath(): string {
  const override = process.env.NERDGRAM_SYNC_MIRROR?.trim();
  const root = ensureDataRoot();
  const chosen = override ? path.resolve(override) : path.join(root, MIRROR_DIR_NAME);
  assertSafeMirror(chosen, root);
  return chosen;
}

export function assertSafeMirror(mirror: string, dataRoot: string): void {
  const resolved = path.resolve(mirror);
  const root = path.resolve(dataRoot);
  if (resolved === root) {
    throw httpFail(500, "Refusing to use the data directory as the git mirror.", "invalid");
  }
  const relative = path.relative(root, resolved);
  const inside = relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (!inside) return;
  const first = relative.split(path.sep)[0] ?? "";
  if (!first.startsWith(".")) {
    throw httpFail(
      500,
      "A mirror inside the data directory must be a hidden folder the editor cannot address.",
      "invalid",
    );
  }
}

function safeWorkspacePath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes("\0")) return false;
  const parts = relativePath.split("/");
  return !parts.some((part) => part.length === 0 || part === "." || part === ".." || part.startsWith("."));
}

export function isUserDiagram(relativePath: string): boolean {
  if (!safeWorkspacePath(relativePath)) return false;
  return relativePath.split("/").pop()?.toLowerCase().endsWith(".mmd") ?? false;
}

/** CSV or JSON stored next to a generated diagram. Synced with the `.mmd` files. */
export function isDataFile(relativePath: string): boolean {
  if (!safeWorkspacePath(relativePath)) return false;
  const name = relativePath.split("/").pop()?.toLowerCase() ?? "";
  return name.endsWith(".csv") || name.endsWith(".json");
}

export function isSyncedFile(relativePath: string): boolean {
  return isUserDiagram(relativePath) || isDataFile(relativePath);
}

export function isBoilerplate(relativePath: string): boolean {
  return BOILERPLATE.has(relativePath);
}

/** Diagrams and their CSV/JSON data files, skipping dot paths, symlinks, and other files. */
export async function listUserFiles(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await walkUserFiles(root, root, out);
  return out;
}

async function walkUserFiles(root: string, dir: string, out: Map<string, string>): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkUserFiles(root, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (!isSyncedFile(rel)) continue;
    out.set(rel, await fs.readFile(abs, "utf8"));
  }
}

export async function writePrivateFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}

export async function removePrivateFile(file: string): Promise<void> {
  await fs.rm(file, { force: true });
}
