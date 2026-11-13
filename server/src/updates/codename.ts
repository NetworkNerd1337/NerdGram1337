import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";
import { parseSemver } from "./semver.js";

/**
 * Same rule as scripts/codenames.mjs. A code name is a single capitalized
 * word, so a release title cannot smuggle markup or a second sentence.
 */
export const CODENAME_RE = /^[A-Z][A-Za-z0-9]{1,31}$/;

const TITLE_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\s+"([A-Z][A-Za-z0-9]{1,31})"$/;

export type CodenameMap = Record<string, string>;

export function readCodenames(repoRoot = REPO_ROOT): CodenameMap {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { codenames?: unknown };
    return sanitizeCodenames(parsed.codenames);
  } catch {
    return {};
  }
}

export function sanitizeCodenames(value: unknown): CodenameMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map: CodenameMap = {};
  for (const [key, name] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(key)) continue;
    if (typeof name !== "string" || !CODENAME_RE.test(name)) continue;
    map[key] = name;
  }
  return map;
}

export function codenameForVersion(version: string, map: CodenameMap = readCodenames()): string | null {
  const parsed = parseSemver(version);
  if (!parsed) return null;
  const name = map[String(parsed.major)];
  if (!name || !CODENAME_RE.test(name)) return null;
  return name;
}

/**
 * A release title may supply a code name only when the map has no entry for
 * that major, and only when the title is exactly `vX.Y.Z "Name"` for the
 * same version the tag already parsed.
 */
export function codenameFromReleaseTitle(version: string, title: string): string | null {
  const parsed = parseSemver(version);
  if (!parsed) return null;
  const match = TITLE_RE.exec(title.trim());
  if (!match) return null;
  if (Number(match[1]) !== parsed.major || Number(match[2]) !== parsed.minor || Number(match[3]) !== parsed.patch) {
    return null;
  }
  return match[4] ?? null;
}

export function releaseCodename(
  version: string,
  title: string | null | undefined,
  map: CodenameMap = readCodenames(),
): string | null {
  const fromMap = codenameForVersion(version, map);
  if (fromMap) return fromMap;
  if (!title) return null;
  return codenameFromReleaseTitle(version, title);
}

/** `v1.0.5 "Atlas"`, or `v1.0.5` when this major has no code name. */
export function formatVersionLabel(version: string, codename: string | null | undefined): string {
  const trimmed = version.trim();
  const base = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  if (!codename || !CODENAME_RE.test(codename)) return base;
  return `${base} "${codename}"`;
}
