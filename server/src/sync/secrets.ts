import fs from "node:fs/promises";
import { tokenPath, writePrivateFile, removePrivateFile } from "./layout.js";
import { rememberSecret } from "./redact.js";

export type TokenSource = "env" | "file";

/**
 * The access token is never returned to the client. An environment variable
 * wins and is not copied to disk. Otherwise the token is a mode-0600 file
 * under `.meta`, which the mirror excludes.
 */
export async function readToken(): Promise<{ token: string | null; source: TokenSource | null }> {
  const fromEnv = process.env.NERDGRAM_GITHUB_TOKEN?.trim();
  if (fromEnv) {
    rememberSecret(fromEnv);
    return { token: fromEnv, source: "env" };
  }
  try {
    const text = (await fs.readFile(tokenPath(), "utf8")).trim();
    if (!text) return { token: null, source: null };
    rememberSecret(text);
    return { token: text, source: "file" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { token: null, source: null };
    throw err;
  }
}

export async function writeToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Refusing to store an empty token");
  rememberSecret(trimmed);
  if (process.env.NERDGRAM_GITHUB_TOKEN?.trim()) {
    // The environment variable is the source of truth and is not duplicated on disk.
    return;
  }
  await writePrivateFile(tokenPath(), `${trimmed}\n`);
}

export async function deleteStoredToken(): Promise<void> {
  await removePrivateFile(tokenPath());
}
