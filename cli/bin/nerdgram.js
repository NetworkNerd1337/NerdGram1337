#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.NERDGRAM_CLI,
  path.resolve(here, "../../server/dist/cli.js"),
  path.resolve(here, "../server/dist/cli.js"),
  "/app/server/dist/cli.js",
].filter((file) => typeof file === "string" && file.length > 0);

const target = candidates.find((file) => existsSync(file));
if (!target) {
  console.error("nerdgram could not find server/dist/cli.js. From a checkout, run npm run build, then node server/dist/cli.js.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
