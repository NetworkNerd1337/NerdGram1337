import fs from "node:fs/promises";
import * as store from "./fsStore.js";
import { resolveSafePath } from "./paths.js";
import {
  httpFail,
  normalizeRelative,
  pathExists,
  resolveAvailablePath,
} from "./storage.js";

/** How many files one import request may carry. */
export const MAX_IMPORT_FILES = 25;

/** Per-file text limit. Mermaid sources are small; this still leaves room to fix a large paste. */
export const MAX_IMPORT_FILE_CHARS = 512 * 1024;

/** Combined text limit, kept under the 5mb JSON body cap once the payload is encoded. */
export const MAX_IMPORT_TOTAL_CHARS = 3_000_000;

const IMPORT_EXTENSIONS = [".mmd", ".md", ".txt"];

export type ImportCollisionAction = "rename" | "skip" | "replace";

export type ImportFileInput = {
  name: string;
  text: string;
  onCollision?: ImportCollisionAction;
};

export type ImportFileResult = {
  name: string;
  status: "created" | "renamed" | "replaced" | "skipped" | "collision" | "error";
  path?: string;
  suggestedPath?: string;
  code?: string;
  error?: string;
};

/**
 * Turn an uploaded file name into a single `.mmd` diagram name.
 * Directory pieces are dropped so a name cannot address `.meta` or another folder.
 * `.md` and `.txt` are accepted as text sources and stored as `.mmd`.
 */
export function diagramNameFromImport(rawName: string): string {
  if (typeof rawName !== "string") {
    throw httpFail(400, "That file name is not allowed.", "invalid");
  }
  const normalized = rawName.replace(/\\/g, "/").trim();
  const base = normalized.split("/").filter((part) => part.length > 0).pop() ?? "";
  if (!base || base === "." || base === ".." || base.startsWith(".")) {
    throw httpFail(400, "That file name is not allowed.", "invalid");
  }
  if (/[\u0000-\u001f<>:"|?*]/.test(base)) {
    throw httpFail(400, "That file name is not allowed.", "invalid");
  }
  const lower = base.toLowerCase();
  const ext = IMPORT_EXTENSIONS.find((item) => lower.endsWith(item));
  if (!ext) {
    throw httpFail(400, "Only .mmd, .md, and .txt files can be imported.", "invalid");
  }
  const stem = base.slice(0, -ext.length).trim().replace(/[. ]+$/g, "");
  if (!stem || stem.startsWith(".")) {
    throw httpFail(400, "That file name is not allowed.", "invalid");
  }
  return `${stem}.mmd`;
}

function isCollisionAction(value: unknown): value is ImportCollisionAction {
  return value === "rename" || value === "skip" || value === "replace";
}

function errorResult(name: string, err: unknown): ImportFileResult {
  const message = err instanceof Error ? err.message : "Could not import this file.";
  const code =
    err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;
  const occupied =
    err && typeof err === "object" && typeof (err as { details?: { path?: unknown } }).details?.path === "string"
      ? (err as { details: { path: string } }).details.path
      : undefined;
  return { name, status: "error", error: message, code, path: occupied };
}

async function isTaken(candidate: string, reserved: ReadonlySet<string>): Promise<boolean> {
  if (reserved.has(candidate)) return true;
  return pathExists(resolveSafePath(candidate));
}

async function importOne(
  folder: string,
  file: ImportFileInput,
  reserved: Set<string>,
): Promise<ImportFileResult> {
  const label = file.name;
  if (file.text.includes("\0")) {
    return {
      name: label,
      status: "error",
      code: "invalid",
      error: "Only text files can be imported.",
    };
  }
  if (file.text.length > MAX_IMPORT_FILE_CHARS) {
    return {
      name: label,
      status: "error",
      code: "invalid",
      error: "This file is larger than 512 KB.",
    };
  }

  let filename: string;
  try {
    filename = diagramNameFromImport(file.name);
  } catch (err) {
    return errorResult(label, err);
  }

  const dest = folder ? `${folder}/${filename}` : filename;
  const existsOnDisk = await pathExists(resolveSafePath(dest));
  let occupiesFolder = false;
  if (existsOnDisk) {
    const stat = await fs.stat(resolveSafePath(dest));
    occupiesFolder = stat.isDirectory();
  }
  const occupied = existsOnDisk || reserved.has(dest);

  if (!occupied) {
    try {
      const written = await store.writeFile(dest, file.text);
      reserved.add(written.path);
      return { name: label, status: "created", path: written.path };
    } catch (err) {
      return errorResult(label, err);
    }
  }

  if (occupiesFolder && file.onCollision === "replace") {
    return {
      name: label,
      status: "error",
      code: "collision",
      path: dest,
      error: "A folder with that name is already there.",
    };
  }

  if (!file.onCollision) {
    const suggestedPath = await resolveAvailablePath(dest, (candidate) => isTaken(candidate, reserved));
    return {
      name: label,
      status: "collision",
      code: "collision",
      path: dest,
      suggestedPath,
      error: "Something already exists at that path.",
    };
  }

  if (file.onCollision === "skip") {
    return { name: label, status: "skipped", path: dest };
  }

  if (file.onCollision === "rename") {
    try {
      const suggestedPath = await resolveAvailablePath(dest, (candidate) => isTaken(candidate, reserved));
      const written = await store.writeFile(suggestedPath, file.text);
      reserved.add(written.path);
      return { name: label, status: "renamed", path: written.path };
    } catch (err) {
      return errorResult(label, err);
    }
  }

  try {
    const written = await store.writeFile(dest, file.text, { force: true });
    reserved.add(written.path);
    return { name: label, status: "replaced", path: written.path };
  } catch (err) {
    return errorResult(label, err);
  }
}

/**
 * Copy text diagrams into a workspace folder.
 *
 * Nothing is overwritten unless that file's `onCollision` is `replace`.
 * A missing choice comes back as `collision` with a free `Name 2.mmd` path.
 * Replace goes through the normal diagram write, so a locked file stays put
 * and the previous bytes are kept as a revision.
 */
export async function importDiagrams(
  folder: string,
  files: ImportFileInput[],
): Promise<{ folder: string; results: ImportFileResult[] }> {
  if (!Array.isArray(files) || files.length === 0) {
    throw httpFail(400, "files is required", "invalid");
  }
  if (files.length > MAX_IMPORT_FILES) {
    throw httpFail(400, `Import up to ${MAX_IMPORT_FILES} files at a time.`, "invalid");
  }
  for (const file of files) {
    if (!file || typeof file !== "object" || typeof file.name !== "string" || typeof file.text !== "string") {
      throw httpFail(400, "Each file needs a name and text.", "invalid");
    }
    if (file.onCollision !== undefined && !isCollisionAction(file.onCollision)) {
      throw httpFail(400, "onCollision must be rename, skip, or replace.", "invalid");
    }
  }

  const destination = normalizeRelative(folder);
  const folderAbs = resolveSafePath(destination || ".");
  if (destination) {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(folderAbs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw httpFail(404, "That folder does not exist.", "not_found");
      throw err;
    }
    if (!stat.isDirectory()) {
      throw httpFail(400, "Import destination must be a folder.", "invalid");
    }
  }

  let acceptedTotal = 0;
  for (const file of files) {
    if (file.text.includes("\0") || file.text.length > MAX_IMPORT_FILE_CHARS) continue;
    acceptedTotal += file.text.length;
    if (acceptedTotal > MAX_IMPORT_TOTAL_CHARS) {
      throw httpFail(400, "Import is larger than 3 MB.", "invalid");
    }
  }

  const reserved = new Set<string>();
  const results: ImportFileResult[] = [];
  for (const file of files) {
    results.push(await importOne(destination, file, reserved));
  }
  const saved = results.filter(
    (result) => result.status === "created" || result.status === "renamed" || result.status === "replaced",
  );
  if (saved.length === 1 && saved[0]?.path) {
    noteSync({ kind: "structural", summary: `Import ${saved[0].path}` });
  } else if (saved.length > 1) {
    noteSync({ kind: "structural", summary: `Import ${saved.length} diagrams` });
  }
  return { folder: destination, results };
}

function noteSync(change: { kind: "content" | "structural"; summary: string }): void {
  void import("./sync/hooks.js")
    .then((mod) => mod.noteLocalChange(change))
    .catch(() => {
      console.error("GitHub sync could not record a local change");
    });
}
