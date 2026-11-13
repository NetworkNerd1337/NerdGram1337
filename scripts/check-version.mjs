import { readFileSync, writeFileSync } from "node:fs";
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

console.log(`Version ${expected} matches in root, client, and server.`);
