import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (typeof rootVersion !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(rootVersion)) {
  console.error(`Root package.json version must be a stable X.Y.Z. Got ${rootVersion}.`);
  process.exit(1);
}

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
const dockerfile = readFileSync(dockerfilePath, "utf8").replace(
  /^ARG NERDGRAM_VERSION=\S+\s*$/gm,
  `ARG NERDGRAM_VERSION=${rootVersion}`,
);
writeFileSync(dockerfilePath, dockerfile);

const composePath = join(root, "compose.yaml");
const compose = readFileSync(composePath, "utf8")
  .replace(/ghcr\.io\/networknerd1337\/nerdgram1337:v\d+\.\d+\.\d+/g, `ghcr.io/networknerd1337/nerdgram1337:v${rootVersion}`)
  .replace(/NERDGRAM_VERSION:\s*"[^"]+"/g, `NERDGRAM_VERSION: "${rootVersion}"`);
writeFileSync(composePath, compose);
console.log(`Dockerfile and compose.yaml -> ${rootVersion}`);
