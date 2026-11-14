import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "cli", "dist");

let esbuild;
try {
  esbuild = (await import("esbuild")).default;
} catch {
  console.error("esbuild is not installed. From the repository root, run npm ci, then pack the CLI again.");
  process.exit(1);
}

rmSync(outdir, { recursive: true, force: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: { cli: "server/src/cli.ts" },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outdir,
  chunkNames: "chunk-[hash]",
  packages: "external",
  sourcemap: false,
  legalComments: "none",
});

const entry = readFileSync(join(outdir, "cli.js"), "utf8");
const startup = ["puppeteer", "mermaid", "cheerio", "yaml"];
const leaked = startup.filter((name) => new RegExp(`from ["']${name}["']`).test(entry));
if (leaked.length > 0) {
  console.error(`cli/dist/cli.js imports ${leaked.join(", ")} at startup. nerdgram --help has to run before those load.`);
  process.exit(1);
}

console.error("Built cli/dist from server/src/cli.ts.");
