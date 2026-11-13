import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";
import { detectInstallKind, type InstallKind } from "./installKind.js";
import { parseSemver } from "./semver.js";

export type VersionInfo = {
  name: "NerdGram1337";
  version: string;
  commit: string | null;
  installKind: InstallKind;
};

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const REF_RE = /^[A-Za-z0-9._/-]+$/;

export function readRootVersion(repoRoot = REPO_ROOT): string {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parseSemver(parsed.version)) return parsed.version;
  } catch {
    // Fall through to the unknown version. Callers still get a payload.
  }
  return "0.0.0";
}

/**
 * Commit baked by an image or build (`NERDGRAM_COMMIT`), otherwise the app
 * checkout's HEAD when this is a git install. Docker never shells out to git.
 */
export function readCommit(installKind: InstallKind, repoRoot = REPO_ROOT): string | null {
  const fromEnv = process.env.NERDGRAM_COMMIT?.trim() ?? "";
  if (SHA_RE.test(fromEnv)) return fromEnv.toLowerCase();
  if (installKind !== "git") return null;
  return readGitHead(repoRoot);
}

export function getVersionInfo(): VersionInfo {
  const installKind = detectInstallKind();
  return {
    name: "NerdGram1337",
    version: readRootVersion(),
    commit: readCommit(installKind),
    installKind,
  };
}

/** Read HEAD from the app checkout. Returns a hex SHA, or null. */
export function readGitHead(repoRoot: string): string | null {
  const gitPath = path.join(repoRoot, ".git");
  let gitDir: string;
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      gitDir = gitPath;
    } else {
      const text = fs.readFileSync(gitPath, "utf8");
      const match = /^gitdir:\s*(.+)\s*$/m.exec(text);
      if (!match?.[1]) return null;
      const pointed = match[1];
      gitDir = path.isAbsolute(pointed) ? pointed : path.resolve(repoRoot, pointed);
    }
  } catch {
    return null;
  }
  return shaFromGitDir(gitDir);
}

function shaFromGitDir(gitDir: string): string | null {
  let head = "";
  try {
    head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  } catch {
    return null;
  }
  const direct = normalizeSha(head);
  if (direct) return direct;
  const ref = /^ref:\s*(\S+)\s*$/.exec(head);
  if (!ref?.[1] || !REF_RE.test(ref[1]) || ref[1].includes("..")) return null;
  const refPath = path.resolve(gitDir, ref[1]);
  const relative = path.relative(gitDir, refPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    const value = normalizeSha(fs.readFileSync(refPath, "utf8").trim());
    if (value) return value;
  } catch {
    // Packed refs are the fallback.
  }
  return shaFromPackedRefs(gitDir, ref[1]);
}

function shaFromPackedRefs(gitDir: string, ref: string): string | null {
  let text = "";
  try {
    text = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, name] = line.split(" ");
    if (name === ref) return normalizeSha(sha ?? "");
  }
  return null;
}

function normalizeSha(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!SHA_RE.test(trimmed)) return null;
  return trimmed;
}
