#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// A checkout uses the server build so local edits apply without a pack.
// A registry install has only the bundled program under dist/.
const checkout = [
  process.env.NERDGRAM_CLI,
  path.resolve(here, "../../server/dist/cli.js"),
  path.resolve(here, "../server/dist/cli.js"),
].filter((file) => typeof file === "string" && file.length > 0);

const bundled = path.resolve(here, "../dist/cli.js");
const imageCli = "/app/server/dist/cli.js";
const target =
  checkout.find((file) => existsSync(file)) ??
  (existsSync(bundled) ? bundled : existsSync(imageCli) ? imageCli : undefined);

if (!target) {
  console.error(
    "nerdgram could not find its program. From a checkout, run npm run build, then node server/dist/cli.js. From npm, reinstall nerdgram1337.",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
