import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Same rule as server/src/updates/codename.ts. Atlas and Meridian match. */
export const CODENAME_RE = /^[A-Z][A-Za-z0-9]{1,31}$/;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {unknown} value
 * @returns {{ ok: true, map: Record<string, string> } | { ok: false, error: string }}
 */
export function parseCodenames(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error: 'Root package.json needs a codenames map, for example { "1": "Atlas", "2": "Meridian" }.',
    };
  }
  /** @type {Record<string, string>} */
  const map = {};
  for (const [key, name] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(key)) {
      return { ok: false, error: `codenames key ${key} is not a major version.` };
    }
    if (typeof name !== "string" || !CODENAME_RE.test(name)) {
      return { ok: false, error: `codenames[${key}] must be a code name like Atlas.` };
    }
    map[key] = name;
  }
  return { ok: true, map };
}

/**
 * Majors 1..current that have no entry. A major without a code name fails CI.
 * @param {string} version
 * @param {Record<string, string>} map
 */
export function missingMajors(version, map) {
  const major = Number(version.split(".")[0]);
  const missing = [];
  for (let n = 1; n <= major; n += 1) {
    if (!map[String(n)]) missing.push(n);
  }
  return missing;
}

/**
 * @param {string} version
 * @param {Record<string, string>} map
 */
export function codenameForVersion(version, map) {
  const major = version.split(".")[0] ?? "";
  return map[major] ?? null;
}

export function readRootPackage(repoRoot = root) {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
}

/**
 * Code name for the root package.json version, or an error string.
 * @returns {{ ok: true, version: string, codename: string, map: Record<string, string> } | { ok: false, error: string }}
 */
export function currentCodename(repoRoot = root) {
  const pkg = readRootPackage(repoRoot);
  const version = pkg.version;
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    return { ok: false, error: `Root package.json version must be a stable X.Y.Z. Got ${version}.` };
  }
  const parsed = parseCodenames(pkg.codenames);
  if (!parsed.ok) return parsed;
  const missing = missingMajors(version, parsed.map);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Major version ${missing.join(", ")} has no code name in package.json codenames.`,
    };
  }
  const codename = codenameForVersion(version, parsed.map);
  if (!codename) return { ok: false, error: `Major version ${version.split(".")[0]} has no code name.` };
  return { ok: true, version, codename, map: parsed.map };
}

const invoked = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invoked) {
  const current = currentCodename();
  if (!current.ok) {
    console.error(current.error);
    process.exit(1);
  }
  process.stdout.write(`${current.codename}\n`);
}
