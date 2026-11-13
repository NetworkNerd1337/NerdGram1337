import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bootBackgroundTasks } from "../src/boot.js";
import { closeServers, startServer } from "../src/listen.js";
import { REPO_ROOT } from "../src/paths.js";
import { assertCommand, setCommandRunner, type CommandRequest, type CommandResult } from "../src/updates/commands.js";
import { dockerGuideForTag } from "../src/updates/dockerGuide.js";
import { applyGitUpdate } from "../src/updates/gitApply.js";
import { detectInstallKind } from "../src/updates/installKind.js";
import { compareSemver, parseSemver, relationToRelease } from "../src/updates/semver.js";
import {
  getUpdateJob,
  getUpdateStatus,
  manualCheck,
  resetUpdatesForTests,
  runAutomaticCheck,
  saveUpdateSettings,
  setUpdateClock,
  setUpdateFetch,
  skipCurrentRelease,
  startUpdateChecker,
  stopUpdateChecker,
} from "../src/updates/service.js";
import { readGitHead } from "../src/updates/versionInfo.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const LATEST = "https://api.github.com/repos/NetworkNerd1337/NerdGram1337/releases/latest";
const NOTES = "Fixed the map.\n\nNOTES_PWN_<script>alert(1)</script> $(rm -rf /)";

type Call = { command: string; args: readonly string[]; cwd: string };

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

function releaseBody(tag: string, body = "Notes", extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: tag.replace(/^v/, ""),
    body,
    html_url: `https://github.com/NetworkNerd1337/NerdGram1337/releases/tag/${tag}`,
    published_at: "2026-11-01T00:00:00Z",
    draft: false,
    prerelease: tag.includes("-"),
    ...extra,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", etag: '"rel"', ...headers },
  });
}

function mockFetch(handler: (url: string, init: RequestInit | undefined, headers: Headers) => Response | Promise<Response>) {
  const calls: { url: string; authorization: string | null; etag: string | null }[] = [];
  setUpdateFetch(async (input, init) => {
    const headers = new Headers(init?.headers);
    const url = String(input);
    calls.push({
      url,
      authorization: headers.get("authorization"),
      etag: headers.get("if-none-match"),
    });
    return handler(url, init, headers);
  });
  return calls;
}

function scripted(behavior: (call: Call) => CommandResult | Promise<CommandResult>) {
  const calls: Call[] = [];
  setCommandRunner(async (request: CommandRequest) => {
    const call = { command: request.command, args: request.args, cwd: request.cwd };
    calls.push(call);
    return behavior(call);
  });
  return calls;
}

function happy(call: Call, options: { status?: string; remote?: string; branch?: string; ancestor?: boolean; failNpm?: string } = {}): CommandResult {
  const args = call.args.join(" ");
  if (args === "remote get-url origin") {
    return { code: 0, stdout: `${options.remote ?? "https://github.com/NetworkNerd1337/NerdGram1337.git"}\n`, stderr: "" };
  }
  if (args === "status --porcelain=v1") return { code: 0, stdout: options.status ?? "", stderr: "" };
  if (args === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: `${options.branch ?? "main"}\n`, stderr: "" };
  if (args === "rev-parse HEAD") return { code: 0, stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", stderr: "" };
  if (args.startsWith("rev-parse --verify")) return { code: 0, stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n", stderr: "" };
  if (args.startsWith("merge-base")) return { code: options.ancestor === false ? 1 : 0, stdout: "", stderr: "" };
  if (options.failNpm && call.command.startsWith("npm") && args === options.failNpm) {
    return { code: 1, stdout: "", stderr: "build exploded" };
  }
  return { code: 0, stdout: "", stderr: "" };
}

async function waitJob() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = getUpdateJob();
    if (current && !current.running) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("update job did not finish");
}

describe("semver", () => {
  it("compares stable versions and ignores prereleases unless asked", () => {
    expect(relationToRelease("1.0.0", "v1.2.0", false)).toBe("newer");
    expect(relationToRelease("1.2.0", "v1.2.0", false)).toBe("same");
    expect(relationToRelease("1.3.0", "v1.2.0", false)).toBe("ahead");
    expect(relationToRelease("1.0.0", "v1.2.0-beta.1", false)).toBe("incomparable");
    expect(relationToRelease("1.0.0", "v1.2.0-beta.1", true)).toBe("newer");
    expect(relationToRelease("1.2.0-beta.1", "v1.2.0", false)).toBe("newer");
    expect(relationToRelease("not-a-version", "v1.2.0", false)).toBe("incomparable");
    expect(relationToRelease("1.0.0", "v1.2.0;touch", false)).toBe("incomparable");
    const beta = parseSemver("1.0.0-beta.2");
    const beta1 = parseSemver("1.0.0-beta.10");
    expect(beta && beta1 && compareSemver(beta, beta1)).toBe(-1);
  });
});

describe("install kind", () => {
  it("uses NERDGRAM_INSTALL, the app .git, and not the sync mirror", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-kind-"));
    const data = path.join(root, "data");
    await fs.mkdir(path.join(data, ".nerdgram-git"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), '{"version":"1.0.0"}\n');
    const missing = path.join(root, "no-dockerenv");
    expect(detectInstallKind({ repoRoot: root, env: {}, dockerenvPath: missing, containerenvPath: missing })).toBe("zip");
    await fs.writeFile(path.join(root, ".git"), "gitdir: ../real.git\n");
    expect(detectInstallKind({ repoRoot: root, env: {}, dockerenvPath: missing, containerenvPath: missing })).toBe("git");
    expect(
      detectInstallKind({
        repoRoot: root,
        env: { NERDGRAM_INSTALL: "docker" },
        dockerenvPath: missing,
        containerenvPath: missing,
      }),
    ).toBe("docker");
    const marker = path.join(root, "dockerenv");
    await fs.writeFile(marker, "");
    expect(detectInstallKind({ repoRoot: root, env: {}, dockerenvPath: marker, containerenvPath: missing })).toBe("docker");
    expect(detectInstallKind({ repoRoot: root, env: { NERDGRAM_INSTALL: "zip" }, dockerenvPath: marker, containerenvPath: missing })).toBe("zip");
    expect(detectInstallKind({ repoRoot: root, env: { NERDGRAM_INSTALL: "flatpak" }, dockerenvPath: missing, containerenvPath: missing })).toBe("unknown");
    expect(detectInstallKind({ repoRoot: data, env: { NERDGRAM_INSTALL: "git" }, dockerenvPath: missing, containerenvPath: missing })).toBe("unknown");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads a commit from the app git dir and ignores a mirror", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-git-"));
    const sha = "abc1234abc1234abc1234abc1234abc1234abc12";
    await fs.mkdir(path.join(root, ".git", "refs", "heads"), { recursive: true });
    await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await fs.writeFile(path.join(root, ".git", "refs", "heads", "main"), `${sha}\n`);
    await fs.mkdir(path.join(root, "data", ".nerdgram-git"), { recursive: true });
    await fs.writeFile(path.join(root, "data", ".nerdgram-git", "HEAD"), "ref: refs/heads/main\n");
    expect(readGitHead(root)).toBe(sha);
    expect(readGitHead(path.join(root, "data"))).toBeNull();
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("docker guide", () => {
  it("uses the release tag and refuses to embed notes or a bad tag", () => {
    const guide = dockerGuideForTag("v1.2.0");
    expect(guide).not.toBeNull();
    const text = JSON.stringify(guide);
    expect(text).toContain("docker pull ghcr.io/networknerd1337/nerdgram1337:v1.2.0");
    expect(text).toContain("docker stop nerdgram1337");
    expect(text).toContain("docker rm nerdgram1337");
    expect(text).toContain("127.0.0.1:8787:8787");
    expect(text).toContain("nerdgram-data:/data");
    expect(text).toContain("NERDGRAM_DATA_DIR=/data");
    expect(text).toContain("docker compose pull");
    expect(text).toContain("docker compose up -d");
    expect(text).toContain("/data");
    expect(text).not.toContain(NOTES);
    expect(dockerGuideForTag("v1.2.0;reboot")).toBeNull();
    expect(dockerGuideForTag("v1.2.0-beta.1")).toBeNull();
  });
});

describe("command allow-list", () => {
  it("rejects shell fragments, clean, and hard reset", () => {
    const cwd = REPO_ROOT;
    expect(() => assertCommand({ command: "git", args: ["clean", "-fd"], cwd, timeoutMs: 1 }, cwd)).toThrow(/Refusing/);
    expect(() => assertCommand({ command: "git", args: ["reset", "--hard", "a".repeat(40)], cwd, timeoutMs: 1 }, cwd)).toThrow(/Refusing/);
    expect(() =>
      assertCommand({ command: "git", args: ["fetch", "origin", "refs/tags/v1.2.0;touch:refs/tags/v1.2.0;touch"], cwd, timeoutMs: 1 }, cwd),
    ).toThrow(/Refusing/);
    expect(() => assertCommand({ command: "bash", args: ["-c", "rm"], cwd, timeoutMs: 1 }, cwd)).toThrow(/Refusing/);
    expect(() => assertCommand({ command: "git", args: ["status", "--porcelain=v1"], cwd: "/tmp", timeoutMs: 1 }, cwd)).toThrow(/outside/);
  });
});

describe("update check API", () => {
  let cleanup = async () => {};
  const restore: (() => void)[] = [];

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    resetUpdatesForTests();
  });

  afterEach(async () => {
    stopUpdateChecker();
    resetUpdatesForTests();
    while (restore.length > 0) restore.pop()?.();
    await cleanup();
  });

  function useEnv(name: string, value: string | undefined) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    restore.push(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }

  it("reports the root version and install kind", async () => {
    useEnv("NERDGRAM_INSTALL", "zip");
    useEnv("NERDGRAM_COMMIT", "abc1234");
    const res = await request(app()).get("/api/version").set("Host", HOST);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe("1.0.0");
    expect(res.body.commit).toBe("abc1234");
    expect(res.body.installKind).toBe("zip");
    const health = await request(app()).get("/api/health").set("Host", HOST);
    expect(health.body.version).toBe("1.0.0");
    expect(health.body.installKind).toBe("zip");
  });

  it("keeps the three package.json versions identical", async () => {
    const read = async (file: string) => JSON.parse(await fs.readFile(path.join(REPO_ROOT, file), "utf8")) as { version: string };
    const root = await read("package.json");
    const client = await read("client/package.json");
    const server = await read("server/package.json");
    expect(client.version).toBe(root.version);
    expect(server.version).toBe(root.version);
  });

  it("caches GitHub, honors ETag 304, and stays quiet when offline", async () => {
    useEnv("NERDGRAM_GITHUB_TOKEN", "ghp_should_not_be_sent");
    let status = 200;
    const calls = mockFetch(() => jsonResponse(status, releaseBody("v1.2.0", NOTES)));
    let clock = Date.parse("2026-11-13T00:00:00Z");
    setUpdateClock(() => clock);

    const first = await manualCheck();
    expect(first.updateAvailable).toBe(true);
    expect(first.latest?.version).toBe("1.2.0");
    expect(first.latest?.body).toContain("NOTES_PWN_");
    expect(first.latest?.htmlUrl.startsWith("https://github.com/NetworkNerd1337/NerdGram1337/releases/")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(LATEST);
    expect(calls[0]?.authorization).toBeNull();

    clock += 60 * 60 * 1000;
    await runAutomaticCheck();
    expect(calls).toHaveLength(1);

    status = 304;
    clock += 25 * 60 * 60 * 1000;
    const again = await manualCheck();
    expect(again.latest?.version).toBe("1.2.0");
    expect(again.error).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls.at(-1)?.etag).toBe('"rel"');

    setUpdateFetch(async () => {
      throw new Error("offline");
    });
    clock += 25 * 60 * 60 * 1000;
    const quiet = await runAutomaticCheck();
    expect(quiet.error).toBeNull();
    expect(quiet.latest?.version).toBe("1.2.0");
    const manual = await manualCheck();
    expect(manual.error?.code).toBe("offline");
    expect(manual.error?.message).toMatch(/GitHub/);
  });

  it("treats no releases as up to date and ignores prereleases", async () => {
    mockFetch(() => jsonResponse(404, { message: "Not Found" }));
    const none = await manualCheck();
    expect(none.phase).toBe("no_release");
    expect(none.error).toBeNull();
    expect(none.updateAvailable).toBe(false);

    resetUpdatesForTests();
    mockFetch(() => jsonResponse(200, releaseBody("v9.0.0-beta.1")));
    const beta = await manualCheck();
    expect(beta.updateAvailable).toBe(false);
    expect(beta.phase).not.toBe("available");

    await saveUpdateSettings({ includePrerelease: true });
    mockFetch(() => jsonResponse(200, [releaseBody("v1.2.0"), releaseBody("v9.0.0-beta.1")]));
    const opted = await manualCheck();
    expect(opted.latest?.version).toBe("9.0.0-beta.1");
    expect(opted.canApply).toBe(false);
  });

  it("does not call GitHub when checks are disabled or automatic checks are off", async () => {
    const calls = mockFetch(() => jsonResponse(200, releaseBody("v1.2.0")));
    useEnv("NERDGRAM_UPDATE_CHECK", "false");
    const disabled = await manualCheck();
    expect(disabled.enabled).toBe(false);
    expect(disabled.phase).toBe("disabled");
    expect(calls).toHaveLength(0);
    await runAutomaticCheck();
    expect(calls).toHaveLength(0);

    useEnv("NERDGRAM_UPDATE_CHECK", undefined);
    await saveUpdateSettings({ automatic: false });
    await runAutomaticCheck();
    expect(calls).toHaveLength(0);
    const manual = await manualCheck();
    expect(manual.updateAvailable).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("keeps a skipped release quiet until a newer tag", async () => {
    mockFetch(() => jsonResponse(200, releaseBody("v1.2.0")));
    await manualCheck();
    const skipped = await skipCurrentRelease();
    expect(skipped.skipped).toBe(true);
    expect(skipped.updateAvailable).toBe(false);
    mockFetch(() => jsonResponse(200, releaseBody("v1.3.0")));
    const next = await manualCheck();
    expect(next.updateAvailable).toBe(true);
    expect(next.latest?.version).toBe("1.3.0");
  });

  it("rate limits are silent on the automatic check", async () => {
    mockFetch(() => jsonResponse(403, { message: "rate limit" }, { "x-ratelimit-remaining": "0" }));
    const auto = await runAutomaticCheck();
    expect(auto.error).toBeNull();
    expect(auto.updateAvailable).toBe(false);
    const manual = await manualCheck();
    expect(manual.error?.code).toBe("rate_limit");
  });

  it("rejects a bad host, origin, and content type on the update routes", async () => {
    const api = app();
    const foreign = await request(api).post("/api/updates/apply").set("Host", "evil.example").set("Content-Type", "application/json").send({});
    expect(foreign.status).toBe(403);

    const origin = await request(api)
      .post("/api/updates/apply")
      .set("Host", HOST)
      .set("Origin", "https://evil.example")
      .set("Content-Type", "application/json")
      .send({});
    expect(origin.status).toBe(403);

    const form = await request(api).post("/api/updates/check").set("Host", HOST).set("Content-Type", "text/plain").send("{}");
    expect(form.status).toBe(415);

    const missing = await request(api).post("/api/updates/apply").set("Host", HOST);
    expect(missing.status).toBe(415);

    const array = await request(api).post("/api/updates/settings").set("Host", HOST).set("Content-Type", "application/json").send([1]);
    expect(array.status).toBe(400);
  });

  it("refuses a dirty tree, the wrong remote, and a non-fast-forward, and fast-forwards when clean", async () => {
    useEnv("NERDGRAM_INSTALL", "git");
    mockFetch(() => jsonResponse(200, releaseBody("v1.2.0", NOTES)));
    await manualCheck();

    const dirty = scripted((call) => happy(call, { status: " M README.md" }));
    let res = await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({ tag: "v1.2.0;rm -rf /" });
    expect(res.status).toBe(202);
    let job = await waitJob();
    expect(job.error?.code).toBe("dirty_tree");
    expect(dirty.map((call) => call.args[0])).not.toContain("fetch");
    expect(JSON.stringify(dirty)).not.toContain("NOTES_PWN_");
    expect(JSON.stringify(dirty)).not.toContain("rm -rf");

    const wrong = scripted((call) => happy(call, { remote: "git@github.com:other/repo.git" }));
    res = await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({});
    expect(res.status).toBe(202);
    job = await waitJob();
    expect(job.error?.code).toBe("wrong_remote");
    expect(wrong.some((call) => call.args[0] === "fetch")).toBe(false);

    const behind = scripted((call) => happy(call, { ancestor: false }));
    await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({});
    job = await waitJob();
    expect(job.error?.code).toBe("not_fast_forward");
    expect(behind.some((call) => call.args[0] === "merge" || call.args[0] === "reset" || call.args[0] === "clean")).toBe(false);

    const calls = scripted((call) => happy(call));
    await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({});
    job = await waitJob();
    expect(job.error).toBeNull();
    expect(job.result?.restart.required).toBe(true);
    expect(job.result?.previousCommit).toBe("a".repeat(40));
    const rendered = calls.map((call) => `${call.command} ${call.args.join(" ")}`);
    expect(rendered[0]).toBe("git remote get-url origin");
    expect(rendered).toContain("git fetch origin refs/tags/v1.2.0:refs/tags/v1.2.0");
    expect(rendered).toContain("git merge --ff-only v1.2.0");
    expect(rendered).toContain("npm ci");
    expect(rendered).toContain("npm ci --prefix client");
    expect(rendered).toContain("npm ci --prefix server");
    expect(rendered).toContain("npm run build");
    expect(rendered.some((line) => line.includes("reset") || line.includes("clean") || line.includes("--hard"))).toBe(false);
    expect(calls.every((call) => call.cwd === REPO_ROOT)).toBe(true);
  });

  it("rolls back with reset --keep when the build fails", async () => {
    useEnv("NERDGRAM_INSTALL", "git");
    mockFetch(() => jsonResponse(200, releaseBody("v1.2.0")));
    await manualCheck();
    const calls = scripted((call) => happy(call, { failNpm: "run build" }));
    await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({});
    const job = await waitJob();
    expect(job.error?.code).toBe("update_failed");
    expect(calls.some((call) => call.args[0] === "reset" && call.args[1] === "--keep" && call.args[2] === "a".repeat(40))).toBe(true);
    expect(calls.some((call) => call.args.includes("--hard") || call.args[0] === "clean")).toBe(false);
  });

  it("never runs git for a docker or zip install", async () => {
    mockFetch(() => jsonResponse(200, releaseBody("v1.2.0", NOTES)));
    useEnv("NERDGRAM_INSTALL", "docker");
    const dockerCalls = scripted((call) => happy(call));
    const status = await manualCheck();
    expect(status.installKind).toBe("docker");
    expect(status.canApply).toBe(false);
    expect(status.docker?.steps[0]?.command).toContain("ghcr.io/networknerd1337/nerdgram1337:v1.2.0");
    expect(JSON.stringify(status.docker)).not.toContain("NOTES_PWN_");
    expect(status.matchesLatest).toBe(false);
    await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({});
    const job = await waitJob();
    expect(job.error?.code).toBe("docker_install");
    expect(dockerCalls).toHaveLength(0);

    useEnv("NERDGRAM_INSTALL", "zip");
    const zipCalls = scripted((call) => happy(call));
    await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({});
    const zipJob = await waitJob();
    expect(zipJob.error?.code).toBe("manual_only");
    expect(zipCalls).toHaveLength(0);
  });

  it("confirms a matching version and reports one that still lags", async () => {
    useEnv("NERDGRAM_INSTALL", "docker");
    mockFetch(() => jsonResponse(200, releaseBody("v1.0.0")));
    const same = await manualCheck();
    expect(same.matchesLatest).toBe(true);
    expect(same.updateAvailable).toBe(false);
    expect(same.canApply).toBe(false);
    expect(same.docker?.tag).toBe("v1.0.0");
    expect(same.docker?.steps.map((step) => step.command).join("\n")).toContain("127.0.0.1:8787:8787");
    expect(same.docker?.persistNote).toContain(".nerdgram-git");
    mockFetch(() => jsonResponse(200, releaseBody("v2.0.0")));
    const behind = await manualCheck();
    expect(behind.matchesLatest).toBe(false);
    expect(behind.currentVersion).toBe("1.0.0");
    expect(behind.latest?.version).toBe("2.0.0");
  });

  it("drops a malicious cached tag before any command", async () => {
    useEnv("NERDGRAM_INSTALL", "git");
    const calls = scripted((call) => happy(call));
    await expect(applyGitUpdate({ installKind: "git", tag: "v1.2.0;touch /tmp/pwn", onProgress: () => undefined })).rejects.toMatchObject({
      code: "invalid_tag",
    });
    expect(calls).toHaveLength(0);
  });

  it("serializes apply", async () => {
    useEnv("NERDGRAM_INSTALL", "git");
    mockFetch(() => jsonResponse(200, releaseBody("v1.2.0")));
    await manualCheck();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scripted(async (call) => {
      if (call.args[0] === "status") await gate;
      return happy(call);
    });
    const first = await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({});
    expect(first.status).toBe(202);
    const second = await request(app()).post("/api/updates/apply").set("Host", HOST).set("Content-Type", "application/json").send({});
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("update_busy");
    release();
    const job = await waitJob();
    expect(job.result?.ok).toBe(true);
  });

  it("does not call GitHub from server boot unless a test opts in", async () => {
    const calls = mockFetch(() => jsonResponse(200, releaseBody("v9.9.9")));
    await bootBackgroundTasks();
    expect(calls).toHaveLength(0);
    process.env.NERDGRAM_UPDATE_CHECK_IN_TEST = "1";
    startUpdateChecker();
    for (let attempt = 0; attempt < 20 && calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.url).toBe(LATEST);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await getUpdateStatus();
      if (status.checkedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });

  it("rewrites a release URL that is not this repository", async () => {
    mockFetch(() =>
      jsonResponse(200, releaseBody("v1.2.0", "ok", { html_url: "javascript:alert(1)" })),
    );
    const status = await manualCheck();
    expect(status.latest?.htmlUrl).toBe("https://github.com/NetworkNerd1337/NerdGram1337/releases/tag/v1.2.0");
  });
});

describe("sync loops on boot", () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    const { resetSyncForTests } = await import("../src/sync/engine.js");
    await resetSyncForTests();
    await cleanup();
  });

  it("starts watcher, reconcile, and retry when sync is already enabled", async () => {
    const { syncLoopsActive, resetSyncForTests } = await import("../src/sync/engine.js");
    await resetSyncForTests();
    const previous = {
      reconcile: process.env.NERDGRAM_SYNC_RECONCILE_MS,
      retry: process.env.NERDGRAM_SYNC_RETRY_MS,
      idle: process.env.NERDGRAM_SYNC_IDLE_MS,
    };
    process.env.NERDGRAM_SYNC_RECONCILE_MS = "600000";
    process.env.NERDGRAM_SYNC_RETRY_MS = "600000";
    process.env.NERDGRAM_SYNC_IDLE_MS = "600000";
    const data = process.env.NERDGRAM_DATA_DIR ?? "";
    await fs.mkdir(path.join(data, ".meta"), { recursive: true });
    await fs.writeFile(
      path.join(data, ".meta", "github-sync.json"),
      `${JSON.stringify({ version: 1, enabled: true, private: true, branch: "main" })}\n`,
    );
    const servers = await startServer({ port: 0, mode: "production" });
    try {
      expect(syncLoopsActive()).toEqual({ reconcile: true, retry: true, watch: true });
    } finally {
      await closeServers(servers);
      await resetSyncForTests();
    }
    expect(syncLoopsActive()).toEqual({ reconcile: false, retry: false, watch: false });

    await fs.writeFile(
      path.join(data, ".meta", "github-sync.json"),
      `${JSON.stringify({ version: 1, enabled: false, private: true, branch: "main" })}\n`,
    );
    const again = await startServer({ port: 0, mode: "production" });
    try {
      expect(syncLoopsActive().watch).toBe(false);
    } finally {
      await closeServers(again);
      await resetSyncForTests();
    }
    if (previous.reconcile === undefined) delete process.env.NERDGRAM_SYNC_RECONCILE_MS;
    else process.env.NERDGRAM_SYNC_RECONCILE_MS = previous.reconcile;
    if (previous.retry === undefined) delete process.env.NERDGRAM_SYNC_RETRY_MS;
    else process.env.NERDGRAM_SYNC_RETRY_MS = previous.retry;
    if (previous.idle === undefined) delete process.env.NERDGRAM_SYNC_IDLE_MS;
    else process.env.NERDGRAM_SYNC_IDLE_MS = previous.idle;
  });
});
