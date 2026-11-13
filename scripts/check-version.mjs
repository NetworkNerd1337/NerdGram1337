import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["package.json", "client/package.json", "server/package.json"];
const versions = files.map((file) => {
  const json = JSON.parse(readFileSync(join(root, file), "utf8"));
  return { file, version: json.version };
});

const expected = versions[0]?.version;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (typeof expected !== "string" || !semver.test(expected)) {
  console.error(`Root package.json version must be a stable X.Y.Z. Got ${expected}.`);
  process.exit(1);
}

const drifted = versions.filter((item) => item.version !== expected);
if (drifted.length > 0) {
  console.error("package.json versions differ. The root package.json version is the source of truth.");
  console.error("Run npm run version:sync from the project root.");
  for (const item of versions) console.error(`  ${item.file}: ${item.version}`);
  process.exit(1);
}

const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
const versionArgs = [...dockerfile.matchAll(/^ARG NERDGRAM_VERSION=(\S+)\s*$/gm)].map((match) => match[1]);
if (versionArgs.length === 0 || versionArgs.some((version) => version !== expected)) {
  console.error(`Dockerfile ARG NERDGRAM_VERSION must be ${expected}. Found ${versionArgs.join(", ") || "none"}.`);
  process.exit(1);
}

const compose = readFileSync(join(root, "compose.yaml"), "utf8");
const image = `ghcr.io/networknerd1337/nerdgram1337:v${expected}`;
if (!compose.includes(image) || !compose.includes(`NERDGRAM_VERSION: "${expected}"`)) {
  console.error(`compose.yaml must pin ${image} and NERDGRAM_VERSION ${expected}.`);
  process.exit(1);
}

const readmePath = join(root, "README.md");
if (!existsSync(readmePath)) {
  console.error("README.md is missing. Version examples in the README are checked against package.json.");
  process.exit(1);
}
const readme = readFileSync(readmePath, "utf8");
assertReadmeVersions(readme, expected);
assertReadmeLinks(readme, root);

console.log(
  `Version ${expected} matches in root, client, server, Dockerfile, compose.yaml, and README.md.`,
);

/**
 * Commands in the README use a vX.Y.Z placeholder so a release does not have
 * to edit every example. A concrete version that does slip in has to match
 * the root package.json. `npm run version:sync` does not rewrite the README.
 */
function assertReadmeVersions(markdown, version) {
  const patterns = [
    /ghcr\.io\/networknerd1337\/nerdgram1337:v(\d+\.\d+\.\d+)/g,
    /nerdgram1337@(\d+\.\d+\.\d+)/g,
    /NERDGRAM_VERSION(?:=|:)\s*"?(\d+\.\d+\.\d+)/g,
    /(?<![A-Za-z0-9.])v(\d+\.\d+\.\d+)\b/g,
  ];
  const bad = new Set();
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      if (match[1] !== version) bad.add(match[0]);
    }
  }
  if (bad.size > 0) {
    console.error(`README version examples must match package.json ${version}, or use the vX.Y.Z placeholder.`);
    for (const item of bad) console.error(`  ${item}`);
    process.exit(1);
  }
}

function assertReadmeLinks(markdown, repoRoot) {
  const { headings, links } = markdownOutsideFences(markdown);
  const slugs = githubSlugs(headings);
  const missingAnchors = [];
  const missingFiles = [];
  let skippedFiles = 0;

  for (const target of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const hash = target.startsWith("#") ? target.slice(1) : null;
    if (hash != null && !target.includes("/")) {
      const id = decodeURIComponent(hash);
      if (!slugs.has(id)) missingAnchors.push(`#${id}`);
      continue;
    }
    const pathPart = target.split("#")[0] ?? "";
    if (!pathPart) continue;
    const relative = decodeURIComponent(pathPart);
    if (existsSync(join(repoRoot, relative))) continue;
    if (relative.includes("/")) {
      const top = relative.split("/")[0];
      if (!existsSync(join(repoRoot, top))) {
        skippedFiles += 1;
        continue;
      }
    }
    missingFiles.push(relative);
  }

  if (missingAnchors.length > 0 || missingFiles.length > 0) {
    console.error("README links do not resolve.");
    for (const item of missingAnchors) console.error(`  missing anchor ${item}`);
    for (const item of missingFiles) console.error(`  missing file ${item}`);
    process.exit(1);
  }
  if (skippedFiles > 0) {
    console.log(`README file links skipped: ${skippedFiles} (those directories are not in this tree).`);
  }
}

function markdownOutsideFences(markdown) {
  const headings = [];
  const links = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = /^(```+|~~~+)/.exec(line.trim());
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) headings.push(headingText(heading[2]));
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      links.push(match[1]);
    }
  }
  return { headings, links };
}

function headingText(raw) {
  return raw
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .trim();
}

function githubSlugs(headings) {
  const seen = new Map();
  const slugs = new Set();
  for (const text of headings) {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}
