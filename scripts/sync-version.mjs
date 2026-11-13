import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCodename } from "./codenames.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const current = currentCodename(root);
if (!current.ok) {
  console.error(current.error);
  process.exit(1);
}
const rootVersion = current.version;
const codename = current.codename;

for (const file of ["client/package.json", "server/package.json"]) {
  const full = join(root, file);
  const text = readFileSync(full, "utf8");
  const next = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${rootVersion}$2`);
  if (next === text) {
    const current = JSON.parse(text).version;
    if (current !== rootVersion) {
      console.error(`${file} has no version field to update.`);
      process.exit(1);
    }
    continue;
  }
  writeFileSync(full, next);
  console.log(`${file} -> ${rootVersion}`);
}

const dockerfilePath = join(root, "Dockerfile");
const dockerfile = readFileSync(dockerfilePath, "utf8")
  .replace(/^ARG NERDGRAM_VERSION=\S+\s*$/gm, `ARG NERDGRAM_VERSION=${rootVersion}`)
  .replace(/^ARG NERDGRAM_CODENAME=\S+\s*$/gm, `ARG NERDGRAM_CODENAME=${codename}`);
if (!dockerfile.includes(`ARG NERDGRAM_CODENAME=${codename}`)) {
  console.error("Dockerfile has no ARG NERDGRAM_CODENAME line to update.");
  process.exit(1);
}
writeFileSync(dockerfilePath, dockerfile);

const composePath = join(root, "compose.yaml");
const compose = readFileSync(composePath, "utf8")
  .replace(/ghcr\.io\/networknerd1337\/nerdgram1337:v\d+\.\d+\.\d+/g, `ghcr.io/networknerd1337/nerdgram1337:v${rootVersion}`)
  .replace(/NERDGRAM_VERSION:\s*"[^"]+"/g, `NERDGRAM_VERSION: "${rootVersion}"`)
  .replace(/NERDGRAM_CODENAME:\s*"[^"]+"/g, `NERDGRAM_CODENAME: "${codename}"`);
if (!compose.includes(`NERDGRAM_CODENAME: "${codename}"`)) {
  console.error("compose.yaml has no NERDGRAM_CODENAME pin to update.");
  process.exit(1);
}
writeFileSync(composePath, compose);

for (const file of ["package-lock.json", "client/package-lock.json", "server/package-lock.json"]) {
  const full = join(root, file);
  let seen = 0;
  const text = readFileSync(full, "utf8");
  const next = text.replace(/"version": "[^"]+"/g, (match) => {
    seen += 1;
    if (seen <= 2) return `"version": "${rootVersion}"`;
    return match;
  });
  if (seen < 2) {
    console.error(`${file} does not have a package version to update.`);
    process.exit(1);
  }
  writeFileSync(full, next);
}

console.log(`Dockerfile, compose.yaml, and lockfiles -> ${rootVersion} "${codename}"`);
