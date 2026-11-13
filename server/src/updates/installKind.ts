import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";

export type InstallKind = "git" | "docker" | "zip" | "unknown";

export type InstallProbe = {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Exists check for the container hint. Defaults to `/.dockerenv`. */
  dockerenvPath?: string;
  /** Podman hint. Defaults to `/run/.containerenv`. */
  containerenvPath?: string;
};

/**
 * How this process was installed.
 *
 * `NERDGRAM_INSTALL=docker` (set by the image in #12) is docker even when a
 * `.git` directory was copied in by mistake. A git install is only the app
 * checkout at the repo root. The diagram sync mirror `.nerdgram-git` under the data directory
 * is not this repo and is never consulted.
 */
export function detectInstallKind(probe: InstallProbe = {}): InstallKind {
  const env = probe.env ?? process.env;
  const root = probe.repoRoot ?? REPO_ROOT;
  const explicit = env.NERDGRAM_INSTALL?.trim().toLowerCase() ?? "";

  if (explicit === "docker") return "docker";
  if (explicit === "git") return hasAppGit(root) ? "git" : "unknown";
  if (explicit === "zip") return "zip";
  if (explicit) return "unknown";

  if (fileExists(probe.dockerenvPath ?? "/.dockerenv") || fileExists(probe.containerenvPath ?? "/run/.containerenv")) {
    return "docker";
  }
  if (hasAppGit(root)) return "git";
  if (fileExists(path.join(root, "package.json"))) return "zip";
  return "unknown";
}

/** `.git` at the app root (directory or worktree file). Not a data-dir mirror. */
export function hasAppGit(repoRoot: string): boolean {
  return fileExists(path.join(repoRoot, ".git"));
}

function fileExists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}
