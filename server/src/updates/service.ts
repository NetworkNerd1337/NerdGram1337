import fs from "node:fs/promises";
import path from "node:path";
import { httpFail } from "../storage.js";
import { dockerGuideForTag, type DockerGuide } from "./dockerGuide.js";
import { applyGitUpdate, type ApplyOutcome } from "./gitApply.js";
import type { InstallKind } from "./installKind.js";
import { setCommandRunner } from "./commands.js";
import { relationToRelease, stableTag, parseSemver } from "./semver.js";
import {
  loadUpdateFile,
  releaseFromGithub,
  saveUpdateFile,
  type StoredRelease,
  type UpdateFile,
} from "./state.js";
import { getVersionInfo, type VersionInfo } from "./versionInfo.js";

const LATEST_URL = "https://api.github.com/repos/NetworkNerd1337/NerdGram1337/releases/latest";
const LIST_URL = "https://api.github.com/repos/NetworkNerd1337/NerdGram1337/releases?per_page=20";
const USER_AGENT = "NerdGram1337 (update check; +https://github.com/NetworkNerd1337/NerdGram1337)";
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdatePhase = "disabled" | "current" | "available" | "ahead" | "unknown" | "no_release";

export type UpdateStatus = {
  enabled: boolean;
  automatic: boolean;
  includePrerelease: boolean;
  installKind: InstallKind;
  currentVersion: string;
  commit: string | null;
  phase: UpdatePhase;
  updateAvailable: boolean;
  skipped: boolean;
  dismissed: boolean;
  skippedVersions: string[];
  latest: StoredRelease | null;
  checkedAt: string | null;
  error: { code: string; message: string } | null;
  canApply: boolean;
  matchesLatest: boolean;
  docker: DockerGuide | null;
};

export type UpdateJob = {
  running: boolean;
  phase: string;
  lines: string[];
  error: { code: string; message: string } | null;
  result: ApplyOutcome | null;
};

type FetchLike = typeof fetch;

let fetchImpl: FetchLike = globalThis.fetch.bind(globalThis);
let now = () => Date.now();
let chain: Promise<unknown> = Promise.resolve();
let timer: NodeJS.Timeout | null = null;
let checkerStarted = false;
let applyLocked = false;
let job: UpdateJob | null = null;

export function setUpdateFetch(next: FetchLike | null): void {
  fetchImpl = next ?? globalThis.fetch.bind(globalThis);
}

export function setUpdateClock(next: (() => number) | null): void {
  now = next ?? (() => Date.now());
}

export function resetUpdatesForTests(): void {
  stopUpdateChecker();
  setUpdateFetch(null);
  setUpdateClock(null);
  setCommandRunner(null);
  chain = Promise.resolve();
  applyLocked = false;
  job = null;
  delete process.env.NERDGRAM_UPDATE_CHECK_IN_TEST;
}

export function checksEnabled(): boolean {
  const raw = process.env.NERDGRAM_UPDATE_CHECK?.trim().toLowerCase() ?? "";
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function intervalMs(): number {
  const raw = process.env.NERDGRAM_UPDATE_INTERVAL_MS?.trim() ?? "";
  if (!raw) return DEFAULT_INTERVAL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.min(7 * DEFAULT_INTERVAL_MS, Math.max(1000, Math.trunc(value)));
}

export function prereleaseForced(): boolean {
  const raw = process.env.NERDGRAM_UPDATE_INCLUDE_PRERELEASE?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function startUpdateChecker(): void {
  if (checkerStarted) return;
  checkerStarted = true;
  const tick = () => {
    void runAutomaticCheck().catch(() => undefined);
  };
  tick();
  timer = setInterval(tick, intervalMs());
  timer.unref?.();
}

export function stopUpdateChecker(): void {
  checkerStarted = false;
  if (timer) clearInterval(timer);
  timer = null;
}

export async function runAutomaticCheck(): Promise<UpdateStatus> {
  if (!checksEnabled()) return getUpdateStatus();
  return exclusive(async () => {
    const file = await loadUpdateFile();
    if (!file.automatic) return statusOf(file, getVersionInfo());
    if (cacheFresh(file)) return statusOf(file, getVersionInfo());
    const next = await refresh(file, false, prereleaseForced() || file.includePrerelease);
    await saveUpdateFile(next);
    return statusOf(next, getVersionInfo());
  });
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const file = await loadUpdateFile();
  return statusOf(file, getVersionInfo());
}

export async function manualCheck(): Promise<UpdateStatus> {
  if (!checksEnabled()) return getUpdateStatus();
  return exclusive(async () => {
    const file = await loadUpdateFile();
    file.laterVersion = null;
    file.laterCheckedAt = null;
    const next = await refresh(file, true, prereleaseForced() || file.includePrerelease);
    await saveUpdateFile(next);
    return statusOf(next, getVersionInfo());
  });
}

export async function saveUpdateSettings(input: {
  automatic?: boolean;
  includePrerelease?: boolean;
  clearSkipped?: boolean;
}): Promise<UpdateStatus> {
  return exclusive(async () => {
    const file = await loadUpdateFile();
    if (typeof input.automatic === "boolean") file.automatic = input.automatic;
    if (typeof input.includePrerelease === "boolean") file.includePrerelease = input.includePrerelease;
    if (input.clearSkipped) file.skipped = [];
    await saveUpdateFile(file);
    return statusOf(file, getVersionInfo());
  });
}

export async function skipCurrentRelease(): Promise<UpdateStatus> {
  return exclusive(async () => {
    const file = await loadUpdateFile();
    const version = file.cache?.release?.version;
    if (!version) throw httpFail(409, "There is no release to skip.", "invalid");
    if (!file.skipped.includes(version)) file.skipped.push(version);
    await saveUpdateFile(file);
    return statusOf(file, getVersionInfo());
  });
}

export async function dismissCurrentRelease(): Promise<UpdateStatus> {
  return exclusive(async () => {
    const file = await loadUpdateFile();
    const release = file.cache?.release;
    if (!release || !file.cache) throw httpFail(409, "There is no release to dismiss.", "invalid");
    file.laterVersion = release.version;
    file.laterCheckedAt = file.cache.fetchedAt;
    await saveUpdateFile(file);
    return statusOf(file, getVersionInfo());
  });
}

export function getUpdateJob(): UpdateJob | null {
  return job ? { ...job, lines: [...job.lines], error: job.error ? { ...job.error } : null, result: job.result } : null;
}

export function startApply(): UpdateJob {
  if (!checksEnabled()) {
    throw httpFail(403, "Update checks are turned off (NERDGRAM_UPDATE_CHECK=false).", "disabled");
  }
  if (applyLocked) {
    throw httpFail(409, "An update is already running.", "update_busy");
  }
  applyLocked = true;
  const current: UpdateJob = { running: true, phase: "checking", lines: [], error: null, result: null };
  job = current;
  void exclusive(() => runApply(current))
    .catch((err) => {
      const failure = asFailure(err);
      current.error = { code: failure.code, message: failure.message };
      current.phase = "failed";
      if (current.lines.length === 0) current.lines.push(failure.message);
    })
    .finally(() => {
      current.running = false;
      applyLocked = false;
    });
  return getUpdateJob() ?? current;
}

async function runApply(current: UpdateJob): Promise<void> {
  const file = await loadUpdateFile();
  const info = getVersionInfo();
  const release = file.cache?.release;
  if (!release) throw httpFail(409, "There is no release to install.", "invalid");
  const view = statusOf(file, info);
  if (!view.updateAvailable && view.phase !== "available") {
    throw httpFail(409, "This install is not behind a stable release.", "invalid");
  }
  if (view.skipped) throw httpFail(409, "That release was skipped. Reset skipped versions to install it.", "skipped");
  const tag = release.tag;
  const outcome = await applyGitUpdate({
    installKind: info.installKind,
    tag,
    onProgress: (progress) => {
      current.phase = progress.phase;
      current.lines = progress.lines;
    },
  });
  current.result = outcome;
  current.phase = "done";
}

async function refresh(file: UpdateFile, manual: boolean, includePrerelease: boolean): Promise<UpdateFile> {
  const url = includePrerelease ? LIST_URL : LATEST_URL;
  try {
    const fetched = await fetchRelease(url, file.cache?.url === url ? file.cache.etag : null, includePrerelease);
    const fetchedAt = new Date(now()).toISOString();
    if (fetched.notModified && file.cache) {
      file.cache = { ...file.cache, fetchedAt, etag: fetched.etag ?? file.cache.etag };
      file.manualError = null;
      return file;
    }
    if (fetched.notFound) {
      file.cache = { url, etag: fetched.etag, fetchedAt, notFound: true, release: null };
      file.manualError = null;
      return file;
    }
    file.cache = {
      url,
      etag: fetched.etag,
      fetchedAt,
      notFound: false,
      release: fetched.release,
    };
    file.manualError = null;
    return file;
  } catch (err) {
    const failure = asFailure(err);
    if (manual) file.manualError = { code: failure.code, message: failure.message };
    return file;
  }
}

type FetchResult = {
  notModified: boolean;
  notFound: boolean;
  etag: string | null;
  release: StoredRelease | null;
};

async function fetchRelease(url: string, etag: string | null, includePrerelease: boolean): Promise<FetchResult> {
  const fixture = process.env.NERDGRAM_UPDATE_FIXTURE?.trim();
  if (fixture) return readFixture(fixture);

  const response = await githubGet(url, etag, 0);
  const nextEtag = response.headers.get("etag");
  if (response.status === 304) {
    return { notModified: true, notFound: false, etag: nextEtag ?? etag, release: null };
  }
  if (response.status === 404) {
    return { notModified: false, notFound: true, etag: nextEtag, release: null };
  }
  if (
    response.status === 403 ||
    response.status === 429 ||
    (response.headers.get("x-ratelimit-remaining") === "0" && !response.ok)
  ) {
    throw httpFail(429, "GitHub rate limit reached. The check will try again later.", "rate_limit");
  }
  if (!response.ok) {
    throw httpFail(502, "Could not reach GitHub.", "offline");
  }
  const json: unknown = await response.json();
  const release = Array.isArray(json) ? pickRelease(json, includePrerelease) : releaseFromGithub(json);
  return { notModified: false, notFound: false, etag: nextEtag, release };
}

function pickRelease(list: unknown[], includePrerelease: boolean): StoredRelease | null {
  let best: StoredRelease | null = null;
  for (const item of list) {
    const release = releaseFromGithub(item);
    if (!release) continue;
    if (release.prerelease && !includePrerelease) continue;
    if (!best) {
      best = release;
      continue;
    }
    const left = parseSemver(release.tag);
    const right = parseSemver(best.tag);
    if (left && right && relationToRelease(best.version, release.version, true) === "newer") best = release;
  }
  return best;
}

async function readFixture(file: string): Promise<FetchResult> {
  if (!path.isAbsolute(file) || !file.endsWith(".json")) {
    throw httpFail(500, "The update fixture path is not a JSON file.", "invalid");
  }
  const raw = await fs.readFile(file, "utf8");
  const json: unknown = JSON.parse(raw);
  return {
    notModified: false,
    notFound: json === null,
    etag: null,
    release: json && typeof json === "object" && !Array.isArray(json) ? releaseFromGithub(json) : null,
  };
}

async function githubGet(url: string, etag: string | null, hops: number): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (etag) headers["If-None-Match"] = etag;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw httpFail(502, "Could not reach GitHub.", "offline");
  }
  if (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308) {
    const location = response.headers.get("location");
    if (!location || hops >= 2 || !allowedRedirect(location)) {
      throw httpFail(502, "Could not reach GitHub.", "offline");
    }
    const next = new URL(location, url);
    return githubGet(next.toString(), etag, hops + 1);
  }
  return response;
}

function allowedRedirect(location: string): boolean {
  try {
    const url = new URL(location);
    return url.protocol === "https:" && url.hostname === "api.github.com";
  } catch {
    return false;
  }
}

function cacheFresh(file: UpdateFile): boolean {
  if (!file.cache?.fetchedAt) return false;
  const fetched = Date.parse(file.cache.fetchedAt);
  if (!Number.isFinite(fetched)) return false;
  const age = now() - fetched;
  return age >= 0 && age < intervalMs();
}

function statusOf(file: UpdateFile, info: VersionInfo): UpdateStatus {
  const enabled = checksEnabled();
  const includePrerelease = prereleaseForced() || file.includePrerelease;
  const release = file.cache?.release ?? null;
  const relation = release ? relationToRelease(info.version, release.tag, includePrerelease) : "incomparable";
  const skipped = Boolean(release && file.skipped.includes(release.version));
  const dismissed = Boolean(
    release && file.cache && file.laterVersion === release.version && file.laterCheckedAt === file.cache.fetchedAt,
  );
  let phase: UpdatePhase = "unknown";
  if (!enabled) phase = "disabled";
  else if (file.cache?.notFound) phase = "no_release";
  else if (relation === "newer") phase = "available";
  else if (relation === "ahead") phase = "ahead";
  else if (relation === "same") phase = "current";

  const updateAvailable = enabled && phase === "available" && !skipped;
  const stable = release ? stableTag(parseSemver(release.tag) ?? { major: 0, minor: 0, patch: 0, prerelease: ["x"] }) : null;
  const canApply = updateAvailable && info.installKind === "git" && stable === release?.tag;
  const docker =
    info.installKind === "docker" && release && stable === release.tag && relation === "newer"
      ? dockerGuideForTag(release.tag)
      : null;

  return {
    enabled,
    automatic: enabled && file.automatic,
    includePrerelease,
    installKind: info.installKind,
    currentVersion: info.version,
    commit: info.commit,
    phase,
    updateAvailable,
    skipped,
    dismissed,
    skippedVersions: file.skipped,
    latest: relation === "incomparable" && release?.prerelease && !includePrerelease ? null : release,
    checkedAt: file.cache?.fetchedAt ?? null,
    error: enabled ? file.manualError : null,
    canApply,
    matchesLatest: relation === "same",
    docker,
  };
}

function asFailure(err: unknown): { code: string; message: string } {
  if (err instanceof Error && err.name === "CommandRejected") {
    return { code: "rejected", message: err.message };
  }
  if (err instanceof Error && "code" in err && "status" in err) {
    const code = String((err as { code?: unknown }).code);
    return { code: /^[a-z0-9_-]+$/.test(code) ? code : "update", message: err.message };
  }
  if (err instanceof Error && err.message) return { code: "update", message: err.message };
  return { code: "update", message: "The update did not finish." };
}

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
