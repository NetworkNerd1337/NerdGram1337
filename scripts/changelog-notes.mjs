import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codenameForVersion, currentCodename, parseCodenames, readRootPackage } from "./codenames.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Heading forms the release workflow accepts. The version is a whole X.Y.Z,
 * so `## 1.0.5` does not match a `## 1.0.50` section.
 *
 *   ## 1.0.5
 *   ## 1.0.5 "Atlas"
 *   ## 1.0.5 "Atlas" - 2026-11-13
 *   ## [1.0.5]
 *   ## [1.0.5] - 2026-11-13
 *   ## [1.0.5] "Atlas" - 2026-11-13
 */
const HEADING =
  /^## (?:\[((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\]|((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)))(?:\s+"([A-Z][A-Za-z0-9]{1,31})")?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;

/**
 * @param {string} markdown
 * @param {string} version
 * @returns {{ heading: string, version: string, codename: string | null, date: string | null, body: string } | null}
 */
export function findChangelogSection(markdown, version) {
  const parts = String(markdown).split(/\n(?=## )/);
  for (const part of parts) {
    const first = (part.split(/\r?\n/, 1)[0] ?? "").replace(/\r$/, "");
    const match = HEADING.exec(first);
    if (!match) continue;
    const found = match[1] || match[2];
    if (found !== version) continue;
    const body = part.split(/\r?\n/).slice(1).join("\n").trim();
    return {
      heading: first,
      version: found,
      codename: match[3] ?? null,
      date: match[4] ?? null,
      body,
    };
  }
  return null;
}

/**
 * GitHub Release title. The version comes from the tag. The code name comes
 * from the codenames map for that major, not from the release title text.
 * @param {string} version
 * @param {string} codename
 */
export function releaseTitle(version, codename) {
  return `v${version} "${codename}"`;
}

/**
 * @param {string[]} argv
 */
export function runChangelogNotes(argv, repoRoot = root) {
  let titleOnly = false;
  /** @type {string | null} */
  let file = null;
  /** @type {string[]} */
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--title") {
      titleOnly = true;
      continue;
    }
    if (arg === "--file") {
      const next = argv[index + 1];
      if (!next) return { code: 2, stdout: "", stderr: "--file needs a path.\n" };
      file = next;
      index += 1;
      continue;
    }
    positional.push(arg);
  }

  const tag = positional[0] ?? "";
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match) return { code: 2, stdout: "", stderr: `Tag ${tag} is not a stable vX.Y.Z release.\n` };
  const version = `${match[1]}.${match[2]}.${match[3]}`;

  if (!file) {
    const current = currentCodename(repoRoot);
    if (!current.ok) return { code: 2, stdout: "", stderr: `${current.error}\n` };
    if (current.version !== version) {
      return {
        code: 2,
        stdout: "",
        stderr: `Tag ${tag} does not match package.json v${current.version}.\n`,
      };
    }
  }

  const pkg = readRootPackage(repoRoot);
  const parsed = parseCodenames(pkg.codenames);
  if (!parsed.ok) return { code: 2, stdout: "", stderr: `${parsed.error}\n` };
  const codename = codenameForVersion(version, parsed.map);
  if (!codename) {
    return {
      code: 2,
      stdout: "",
      stderr: `Major version ${version.split(".")[0]} has no code name in package.json codenames.\n`,
    };
  }

  const changelogPath = file ?? join(repoRoot, "CHANGELOG.md");
  let changelog = "";
  try {
    changelog = readFileSync(changelogPath, "utf8");
  } catch {
    return { code: 2, stdout: "", stderr: `Could not read ${changelogPath}.\n` };
  }
  const section = findChangelogSection(changelog, version);
  if (!section) return { code: 2, stdout: "", stderr: `CHANGELOG.md has no section for ${version}.\n` };
  if (section.codename && section.codename !== codename) {
    return {
      code: 2,
      stdout: "",
      stderr: `CHANGELOG heading code name ${section.codename} does not match package.json ${codename}.\n`,
    };
  }
  if (!section.body) return { code: 2, stdout: "", stderr: `CHANGELOG.md section ${version} is empty.\n` };

  if (titleOnly) return { code: 0, stdout: `${releaseTitle(version, codename)}\n`, stderr: "" };
  return { code: 0, stdout: `${section.body}\n`, stderr: "" };
}

const invoked = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invoked) {
  const result = runChangelogNotes(process.argv.slice(2));
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.code !== 0) process.exit(result.code);
}
