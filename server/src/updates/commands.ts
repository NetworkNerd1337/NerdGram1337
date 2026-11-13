import { execFile } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";

export type CommandRequest = {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export class CommandRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandRejected";
  }
}

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[0-9a-f]{40}$/;

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

let runner: CommandRunner = defaultRunner;

export function setCommandRunner(next: CommandRunner | null): void {
  runner = next ?? defaultRunner;
}

export function runCommand(request: CommandRequest): Promise<CommandResult> {
  assertCommand(request, REPO_ROOT);
  return runner(request);
}

export function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * Fixed allow-list. Tag names and SHAs are single arguments that already
 * matched these patterns. Nothing here is passed through a shell.
 */
export function assertCommand(request: CommandRequest, repoRoot: string): void {
  if (path.resolve(request.cwd) !== path.resolve(repoRoot)) {
    throw new CommandRejected("Refusing to run a command outside the app directory.");
  }
  if (request.command === "git") {
    assertGit(request.args);
    return;
  }
  if (request.command === "npm" || request.command === "npm.cmd") {
    assertNpm(request.args);
    return;
  }
  throw new CommandRejected("Refusing to run that command.");
}

function assertGit(args: readonly string[]): void {
  for (const arg of args) {
    if (!/^[\w./:@^{}=-]+$/.test(arg)) throw new CommandRejected("Refusing a git argument.");
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case "status":
      if (rest.length === 1 && rest[0] === "--porcelain=v1") return;
      break;
    case "remote":
      if (rest.length === 2 && rest[0] === "get-url" && rest[1] === "origin") return;
      break;
    case "rev-parse":
      if (rest.length === 2 && rest[0] === "--abbrev-ref" && rest[1] === "HEAD") return;
      if (rest.length === 1 && rest[0] === "HEAD") return;
      if (rest.length === 2 && rest[0] === "--verify" && (TAG.test(rest[1] ?? "") || SHA.test(rest[1] ?? ""))) {
        return;
      }
      break;
    case "merge-base":
      if (
        rest.length === 3 &&
        rest[0] === "--is-ancestor" &&
        SHA.test(rest[1] ?? "") &&
        SHA.test(rest[2] ?? "")
      ) {
        return;
      }
      break;
    case "fetch":
      if (rest.length === 2 && rest[0] === "origin" && tagRefspec(rest[1] ?? "")) return;
      break;
    case "merge":
      if (rest.length === 2 && rest[0] === "--ff-only" && TAG.test(rest[1] ?? "")) return;
      break;
    case "checkout":
      if (rest.length === 2 && rest[0] === "--detach" && (TAG.test(rest[1] ?? "") || SHA.test(rest[1] ?? ""))) {
        return;
      }
      break;
    case "reset":
      if (rest.length === 2 && rest[0] === "--keep" && SHA.test(rest[1] ?? "")) return;
      break;
    default:
      break;
  }
  throw new CommandRejected("Refusing that git command.");
}

function tagRefspec(value: string): boolean {
  const match =
    /^refs\/tags\/(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)):refs\/tags\/(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(
      value,
    );
  return Boolean(match && match[1] === match[2]);
}

function assertNpm(args: readonly string[]): void {
  if (args.length === 1 && args[0] === "ci") return;
  if (
    args.length === 3 &&
    args[0] === "ci" &&
    args[1] === "--prefix" &&
    (args[2] === "client" || args[2] === "server")
  ) {
    return;
  }
  if (args.length === 2 && args[0] === "run" && args[1] === "build") return;
  throw new CommandRejected("Refusing that npm command.");
}

async function defaultRunner(request: CommandRequest): Promise<CommandResult> {
  assertCommand(request, REPO_ROOT);
  if (process.env.VITEST && process.env.NERDGRAM_UPDATE_ALLOW_EXEC !== "1") {
    throw new CommandRejected("Refusing to run update commands during tests.");
  }
  if (process.env.NERDGRAM_UPDATE_SIMULATE === "1" && process.env.NERDGRAM_UPDATE_FIXTURE) {
    return simulated(request);
  }
  return new Promise((resolve) => {
    execFile(
      request.command,
      [...request.args],
      {
        cwd: request.cwd,
        timeout: request.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const fromErr =
          err && typeof err === "object" && "code" in err && typeof err.code === "number" ? err.code : null;
        resolve({
          code: fromErr ?? (err ? 1 : 0),
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

function simulated(request: CommandRequest): CommandResult {
  const args = request.args.join(" ");
  if (request.command === "git" && args === "status --porcelain=v1") {
    return { code: 0, stdout: "", stderr: "" };
  }
  if (request.command === "git" && args === "remote get-url origin") {
    return { code: 0, stdout: "https://github.com/NetworkNerd1337/NerdGram1337.git\n", stderr: "" };
  }
  if (request.command === "git" && args === "rev-parse --abbrev-ref HEAD") {
    return { code: 0, stdout: "main\n", stderr: "" };
  }
  if (request.command === "git" && args === "rev-parse HEAD") {
    return { code: 0, stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", stderr: "" };
  }
  if (request.command === "git" && args.startsWith("rev-parse --verify ")) {
    return { code: 0, stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n", stderr: "" };
  }
  if (request.command === "git" && args.startsWith("merge-base --is-ancestor ")) {
    return { code: 0, stdout: "", stderr: "" };
  }
  return { code: 0, stdout: "ok\n", stderr: "" };
}
