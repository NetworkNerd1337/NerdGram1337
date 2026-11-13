import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataRoot, REPO_ROOT } from "./paths.js";

/** Sample diagrams shipped in the repo. Copied once into an empty data directory. */
const SAMPLE_FILES = ["Welcome.mmd", "NetworkMap.mmd", "Examples/Sequence.mmd"];

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
  for (const relative of SAMPLE_FILES) {
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
