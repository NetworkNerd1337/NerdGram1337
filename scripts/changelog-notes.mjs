import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tag = process.argv[2] ?? "";
const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
if (!match) {
  console.error(`Tag ${tag} is not a stable vX.Y.Z release.`);
  process.exit(2);
}
const version = `${match[1]}.${match[2]}.${match[3]}`;
const changelog = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "CHANGELOG.md"), "utf8");
const sections = changelog.split(/\n(?=## )/);
const section = sections.find((part) => part.startsWith(`## ${version}`) || part.startsWith(`## [${version}]`));
if (!section) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(2);
}
const body = section
  .split(/\n/)
  .slice(1)
  .join("\n")
  .trim();
if (!body) {
  console.error(`CHANGELOG.md section ${version} is empty.`);
  process.exit(2);
}
process.stdout.write(`${body}\n`);
