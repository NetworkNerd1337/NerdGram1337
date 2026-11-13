import path from "node:path";
import { REPO_ROOT } from "../paths.js";
import { inferRuntimeMode, type RuntimeMode } from "../security.js";
import { httpFail } from "../storage.js";
import { npmCommand, runCommand, type CommandRequest, type CommandResult } from "./commands.js";
import { hasAppGit, type InstallKind } from "./installKind.js";
import { stableTag, parseSemver } from "./semver.js";

const OFFICIAL = "NetworkNerd1337/NerdGram1337";

export type ApplyProgress = {
  phase: "checking" | "fetching" | "fast-forward" | "installing" | "building" | "rolling-back" | "done" | "failed";
  lines: string[];
};

export type ApplyOutcome = {
  ok: true;
  previousCommit: string;
  commit: string;
  version: string;
  tag: string;
  restart: {
    required: true;
    mode: RuntimeMode;
    instructions: string;
  };
};

export function isOfficialOrigin(url: string): boolean {
  const value = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  return (
    new RegExp(`^https://github\\.com/${OFFICIAL}$`, "i").test(value) ||
    new RegExp(`^ssh://git@github\\.com/${OFFICIAL}$`, "i").test(value) ||
    new RegExp(`^git@github\\.com:${OFFICIAL}$`, "i").test(value)
  );
}

export function assertStableUpdateTag(tag: string): string {
  const parsed = parseSemver(tag);
  const stable = parsed ? stableTag(parsed) : null;
  if (!stable || stable !== tag.trim()) {
    throw httpFail(
      400,
      "That release tag is not a stable vX.Y.Z version, so Update now will not check it out.",
      "invalid_tag",
    );
  }
  return stable;
}

/**
 * Fast-forward a clean clone of this repo to a stable release tag, then
 * reinstall from the lockfiles and build. Never force, clean, or touch the
 * data directory. `reset --keep` is used only to put `main` back if install
 * or build fails after the fast-forward, and it refuses to drop uncommitted
 * work.
 */
export async function applyGitUpdate(options: {
  installKind: InstallKind;
  tag: string;
  onProgress: (progress: ApplyProgress) => void;
}): Promise<ApplyOutcome> {
  const tag = assertStableUpdateTag(options.tag);
  if (options.installKind === "docker") {
    throw httpFail(
      409,
      "This is a Docker install. NerdGram does not update itself inside the container. Use the upgrade steps to pull the new image and recreate the container, and keep the /data volume.",
      "docker_install",
    );
  }
  if (options.installKind !== "git") {
    throw httpFail(
      409,
      options.installKind === "zip"
        ? "This copy has no git checkout, so Update now is not available. Download the new release and keep your diagrams folder, or the same NERDGRAM_DATA_DIR."
        : "NerdGram could not tell how this copy was installed, so it will not change any files. Update by hand from the release page and keep your diagrams.",
      "manual_only",
    );
  }
  if (!hasAppGit(REPO_ROOT)) {
    throw httpFail(
      409,
      "This folder is not a git checkout of NerdGram1337, so Update now did not run.",
      "not_git",
    );
  }

  const lines: string[] = [];
  const progress = (phase: ApplyProgress["phase"], line?: string) => {
    if (line) lines.push(line);
    options.onProgress({ phase, lines: [...lines] });
  };

  progress("checking", "Checking the git checkout.");
  const remote = (await gitOk(["remote", "get-url", "origin"], 30_000, "read origin")).stdout.trim();
  if (!isOfficialOrigin(remote)) {
    const shown = safeRemote(remote);
    throw httpFail(
      409,
      shown
        ? `origin is ${shown}, not the NerdGram1337 repository. Update now will not fetch a different remote.`
        : "origin is not https://github.com/NetworkNerd1337/NerdGram1337 (or the matching SSH URL). Update now will not fetch a different remote.",
      "wrong_remote",
    );
  }

  const status = await gitOk(["status", "--porcelain=v1"], 30_000, "read status");
  if (status.stdout.trim()) {
    const summary = safeStatus(status.stdout);
    throw httpFail(
      409,
      `The git working tree has local changes, so Update now did not run. Commit or stash them, or update by hand. Extra diagrams under the data folder are ignored and are not a reason to stop when the rest of the tree is clean. ${summary}`.trim(),
      "dirty_tree",
    );
  }

  const branch = (await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], 15_000, "read the branch")).stdout.trim();
  const detached = branch === "HEAD";
  if (!detached && branch !== "main") {
    const shown = /^[A-Za-z0-9._/-]+$/.test(branch) ? branch : null;
    throw httpFail(
      409,
      shown
        ? `Update now only runs on main, or on a detached release tag. This checkout is on ${shown}. Check out main, then try again.`
        : "Update now only runs on main, or on a detached release tag. Check out main, then try again.",
      "unexpected_branch",
    );
  }

  const previous = requireSha((await gitOk(["rev-parse", "HEAD"], 15_000, "read HEAD")).stdout, "current commit");
  progress("fetching", `Fetching ${tag}.`);
  const fetched = await git(["fetch", "origin", `refs/tags/${tag}:refs/tags/${tag}`], 120_000);
  if (fetched.code !== 0) {
    throw httpFail(
      502,
      `Could not fetch ${tag}. ${tail(fetched.stderr || fetched.stdout)} ${manualHint(tag)}`.trim(),
      "fetch_failed",
    );
  }

  const target = requireSha((await gitOk(["rev-parse", "--verify", tag], 15_000, "read the release tag")).stdout, "release tag");
  const ancestor = await git(["merge-base", "--is-ancestor", previous, target], 15_000);
  if (ancestor.code !== 0) {
    throw httpFail(
      409,
      `The release is not a fast-forward from this checkout, so nothing was changed. Update now will not reset or discard history. ${manualHint(tag)}`,
      "not_fast_forward",
    );
  }

  progress("fast-forward", detached ? `Checking out ${tag}.` : `Fast-forwarding main to ${tag}.`);
  const moved = detached
    ? await git(["checkout", "--detach", tag], 30_000)
    : await git(["merge", "--ff-only", tag], 30_000);
  if (moved.code !== 0) {
    throw httpFail(
      502,
      `The fast-forward did not finish, and the checkout was left as it was. ${tail(moved.stderr || moved.stdout)} ${manualHint(tag)}`.trim(),
      "ff_failed",
    );
  }

  try {
    progress("installing", "Installing dependencies from the lockfiles.");
    await npm(["ci"], "npm ci");
    await npm(["ci", "--prefix", "client"], "npm ci --prefix client");
    await npm(["ci", "--prefix", "server"], "npm ci --prefix server");
    progress("building", "Building the client and the server.");
    await npm(["run", "build"], "npm run build");
  } catch (err) {
    progress("rolling-back", `Restoring ${previous}.`);
    const rolled = await rollback(detached, previous);
    const reason = err instanceof Error ? err.message : "The update failed.";
    if (rolled) {
      throw httpFail(500, `${reason} The checkout was put back at ${previous}.`, "update_failed");
    }
    throw httpFail(
      500,
      `${reason} Automatic rollback did not finish. The previous commit was ${previous}. From the project root, if the working tree is still clean: git reset --keep ${previous}`,
      "rollback_failed",
    );
  }

  const mode = inferRuntimeMode();
  const instructions =
    mode === "development"
      ? "Stop this process with Ctrl+C, then from the project root run npm run dev. Reload this page after it is listening."
      : "Stop this process with Ctrl+C, then from the project root run npm start. Reload this page after it is listening.";
  progress("done", "Update finished. Restart NerdGram, then reload this page.");
  return {
    ok: true,
    previousCommit: previous,
    commit: target,
    version: tag.slice(1),
    tag,
    restart: { required: true, mode, instructions },
  };
}

async function rollback(detached: boolean, previous: string): Promise<boolean> {
  const result = detached
    ? await git(["checkout", "--detach", previous], 30_000)
    : await git(["reset", "--keep", previous], 30_000);
  return result.code === 0;
}

async function npm(args: readonly string[], label: string): Promise<void> {
  const result = await exec({
    command: npmCommand(),
    args,
    cwd: REPO_ROOT,
    timeoutMs: 10 * 60 * 1000,
  });
  if (result.code !== 0) {
    throw new Error(`${label} failed. ${tail(result.stderr || result.stdout)}`.trim());
  }
}

async function git(args: readonly string[], timeoutMs: number): Promise<CommandResult> {
  return exec({ command: "git", args, cwd: REPO_ROOT, timeoutMs });
}

async function gitOk(args: readonly string[], timeoutMs: number, label: string): Promise<CommandResult> {
  const result = await git(args, timeoutMs);
  if (result.code !== 0) {
    throw httpFail(502, `Git could not ${label}. ${tail(result.stderr || result.stdout)}`.trim(), "git");
  }
  return result;
}

function exec(request: CommandRequest): Promise<CommandResult> {
  if (path.resolve(request.cwd) !== path.resolve(REPO_ROOT)) {
    throw httpFail(500, "Refusing to run a command outside the app directory.", "invalid");
  }
  return runCommand(request);
}

function requireSha(stdout: string, label: string): string {
  const value = stdout.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw httpFail(500, `Git did not return a commit SHA for the ${label}.`, "git");
  }
  return value;
}

function manualHint(tag: string): string {
  return `From the project root you can update by hand: git fetch origin tag ${tag} && git merge --ff-only ${tag} && npm ci && npm ci --prefix client && npm ci --prefix server && npm run build`;
}

function safeRemote(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 300 || /[\s\0]/.test(trimmed)) return null;
  if (!/^[\w@.:/+-]+$/.test(trimmed)) return null;
  return trimmed;
}

function safeStatus(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\x20-\x7E]/g, "").trimEnd())
    .filter((line) => line.length > 0 && line.length <= 180)
    .slice(0, 8);
  if (lines.length === 0) return "";
  return lines.join(" ");
}

function tail(text: string): string {
  const clean = text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").trim();
  if (!clean) return "";
  const lines = clean.split(/\r?\n/).filter(Boolean).slice(-2);
  return lines.join(" ").slice(0, 400);
}
