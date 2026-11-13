import path from "node:path";
import { getMetaPath } from "../paths.js";
import { atomicWriteJson, readJsonFile } from "../storage.js";
import { parseSemver, stableTag, type SemVer } from "./semver.js";

export type StoredRelease = {
  tag: string;
  version: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
};

export type UpdateFile = {
  automatic: boolean;
  includePrerelease: boolean;
  skipped: string[];
  laterVersion: string | null;
  laterCheckedAt: string | null;
  cache: {
    url: string;
    etag: string | null;
    fetchedAt: string;
    notFound: boolean;
    release: StoredRelease | null;
  } | null;
  manualError: { code: string; message: string } | null;
};

export function updatesPath(): string {
  return path.join(getMetaPath(), "updates.json");
}

export function emptyUpdateFile(): UpdateFile {
  return {
    automatic: true,
    includePrerelease: false,
    skipped: [],
    laterVersion: null,
    laterCheckedAt: null,
    cache: null,
    manualError: null,
  };
}

export async function loadUpdateFile(): Promise<UpdateFile> {
  const parsed = await readJsonFile<Partial<UpdateFile>>(updatesPath());
  return sanitizeFile(parsed);
}

export async function saveUpdateFile(file: UpdateFile): Promise<void> {
  await atomicWriteJson(updatesPath(), sanitizeFile(file));
}

export function sanitizeFile(value: Partial<UpdateFile> | null | undefined): UpdateFile {
  const empty = emptyUpdateFile();
  if (!value || typeof value !== "object") return empty;
  empty.automatic = value.automatic !== false;
  empty.includePrerelease = value.includePrerelease === true;
  empty.skipped = Array.isArray(value.skipped)
    ? [...new Set(value.skipped.map((item) => (typeof item === "string" ? normalizeVersion(item) : null)).filter((item): item is string => item != null))]
    : [];
  empty.laterVersion = typeof value.laterVersion === "string" ? normalizeVersion(value.laterVersion) : null;
  empty.laterCheckedAt = typeof value.laterCheckedAt === "string" ? value.laterCheckedAt : null;
  empty.manualError = sanitizeError(value.manualError);
  empty.cache = sanitizeCache(value.cache);
  return empty;
}

function sanitizeError(value: unknown): { code: string; message: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { code?: unknown; message?: unknown };
  if (typeof record.code !== "string" || typeof record.message !== "string") return null;
  if (!/^[a-z0-9_-]{1,40}$/.test(record.code)) return null;
  return { code: record.code, message: record.message.slice(0, 300) };
}

function sanitizeCache(value: unknown): UpdateFile["cache"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<NonNullable<UpdateFile["cache"]>>;
  if (typeof record.fetchedAt !== "string" || typeof record.url !== "string") return null;
  if (!record.url.startsWith("https://api.github.com/repos/NetworkNerd1337/NerdGram1337/releases")) {
    return null;
  }
  const etag = typeof record.etag === "string" && record.etag.length < 200 ? record.etag : null;
  return {
    url: record.url,
    etag,
    fetchedAt: record.fetchedAt,
    notFound: record.notFound === true,
    release: sanitizeRelease(record.release),
  };
}

export function sanitizeRelease(value: unknown): StoredRelease | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StoredRelease>;
  if (typeof record.tag !== "string") return null;
  const parsed = parseSemver(record.tag);
  if (!parsed) return null;
  const version = formatStoredVersion(parsed);
  const tag = record.prerelease === true || parsed.prerelease.length > 0 ? `v${version}` : stableTag(parsed);
  if (!tag) return null;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 200) : version;
  const body = typeof record.body === "string" ? record.body.slice(0, 100_000) : "";
  const publishedAt = typeof record.publishedAt === "string" ? record.publishedAt.slice(0, 40) : null;
  return {
    tag,
    version,
    name,
    body,
    htmlUrl: canonicalReleaseUrl(tag, record.htmlUrl),
    publishedAt,
    prerelease: parsed.prerelease.length > 0,
  };
}

export function releaseFromGithub(value: unknown): StoredRelease | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.draft === true) return null;
  const tagName = typeof record.tag_name === "string" ? record.tag_name : "";
  const parsed = parseSemver(tagName);
  if (!parsed) return null;
  return sanitizeRelease({
    tag: tagName,
    version: formatStoredVersion(parsed),
    name: record.name,
    body: record.body,
    htmlUrl: record.html_url,
    publishedAt: record.published_at,
    prerelease: parsed.prerelease.length > 0,
  });
}

export function canonicalReleaseUrl(tag: string, raw: unknown): string {
  const fallback = `https://github.com/NetworkNerd1337/NerdGram1337/releases/tag/${encodeURIComponent(tag)}`;
  if (typeof raw !== "string") return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return fallback;
    if (!url.pathname.startsWith("/NetworkNerd1337/NerdGram1337/releases/")) return fallback;
    if (url.username || url.password) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

export function normalizeVersion(input: string): string | null {
  const parsed = parseSemver(input);
  if (!parsed || parsed.prerelease.length > 0) return parsed ? formatStoredVersion(parsed) : null;
  return formatStoredVersion(parsed);
}

function formatStoredVersion(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease.length === 0) return core;
  return `${core}-${version.prerelease.join(".")}`;
}
