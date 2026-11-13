import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataRoot, REPO_ROOT } from "./paths.js";

/**
 * Every `.mmd` file under `diagrams/`, including subfolders.
 * A new sample is seeded with the others. It is not a separate allow-list.
 */
export async function bundledSampleFiles(root = path.join(REPO_ROOT, "diagrams")): Promise<string[]> {
  return walkMmd(root, "");
}

async function walkMmd(dir: string, prefix: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkMmd(path.join(dir, entry.name), relative)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mmd")) {
      files.push(relative);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Copy the sample diagrams into an empty data directory.
 * A directory that already has anything in it is left alone, so a later start
 * does not put the samples back over diagrams the user deleted.
 * Returns true when it copied the samples.
 */
export async function seedEmptyDataDir(): Promise<boolean> {
  const data = ensureDataRoot();
  const samples = path.join(REPO_ROOT, "diagrams");
  if (path.resolve(data) === path.resolve(samples)) return false;

  let entries: string[];
  try {
    entries = await fs.readdir(data);
  } catch (err) {
    throw permissionError(data, err);
  }
  if (entries.length > 0) return false;

  let copied = 0;
  for (const relative of await bundledSampleFiles(samples)) {
    const from = path.join(samples, relative);
    try {
      await fs.access(from);
    } catch {
      continue;
    }
    const to = path.join(data, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.copyFile(from, to);
    } catch (err) {
      throw permissionError(data, err);
    }
    copied += 1;
  }
  return copied > 0;
}

function permissionError(data: string, err: unknown): unknown {
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== "EACCES" && code !== "EPERM") return err;
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "the process user";
  return new Error(
    `Cannot write ${data} as uid ${uid}. A named volume is writable when the image creates /data as uid 1001. ` +
      `On a bind mount, chown that directory to 1001:1001 (user nerdgram in the image).`,
  );
}
