#!/usr/bin/env bash
# Pack cli/ and prove the tarball runs on a clean directory.
# npm pack --dry-run lists the registry contents. The install and npx steps
# use that same tarball, not the checkout's server/dist.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

export PUPPETEER_SKIP_DOWNLOAD=1

dry="$(mktemp)"
tarball_json="$(mktemp)"
work="$(mktemp -d)"
tarball=""
cleanup() {
  rm -rf "$work"
  rm -f "$dry" "$tarball_json"
  if [ -n "$tarball" ]; then
    rm -f "$tarball"
  fi
}
trap cleanup EXIT

cd "$root/cli"
echo "npm pack --dry-run"
npm pack --dry-run --json > "$dry"

PACK_JSON="$dry" node --input-type=module <<'EOF'
import fs from "node:fs";
const packs = JSON.parse(fs.readFileSync(process.env.PACK_JSON, "utf8"));
const pack = Array.isArray(packs) ? packs[0] : packs;
if (!pack || pack.name !== "nerdgram1337") {
  console.error("npm pack --dry-run did not describe nerdgram1337.");
  process.exit(1);
}
const files = (pack.files ?? []).map((file) => (typeof file === "string" ? file : file.path));
const required = ["package.json", "bin/nerdgram.js", "dist/cli.js", "README.md", "LICENSE"];
const missing = required.filter((file) => !files.includes(file));
if (missing.length > 0) {
  console.error(`Tarball is missing ${missing.join(", ")}.`);
  console.error(files.join("\n"));
  process.exit(1);
}
if (files.some((file) => file.includes("node_modules") || file.startsWith("server/"))) {
  console.error("Tarball includes files outside the CLI package.");
  process.exit(1);
}
const unpacked = Number(pack.unpackedSize ?? 0);
if (!Number.isFinite(unpacked) || unpacked <= 0 || unpacked > 5_000_000) {
  console.error(`Tarball unpacked size ${unpacked} is outside the expected range.`);
  process.exit(1);
}
console.log(`Dry run ok: ${pack.name}@${pack.version}, ${files.length} files, ${unpacked} bytes unpacked.`);
EOF

echo "npm pack"
npm pack --json > "$tarball_json"
filename="$(PACK_JSON="$tarball_json" node --input-type=module <<'EOF'
import fs from "node:fs";
const packs = JSON.parse(fs.readFileSync(process.env.PACK_JSON, "utf8"));
const pack = Array.isArray(packs) ? packs[0] : packs;
if (!pack?.filename || pack.name !== "nerdgram1337") {
  console.error("npm pack did not write a nerdgram1337 tarball.");
  process.exit(1);
}
process.stdout.write(pack.filename);
EOF
)"
tarball="$root/cli/$filename"

if [ ! -f "$tarball" ]; then
  echo "Missing tarball $tarball" >&2
  exit 1
fi

install="$work/install"
mkdir -p "$install"
cd "$install"
npm init -y >/dev/null
npm install --no-fund --no-audit "$tarball"

echo "nerdgram --help from the installed tarball"
"$install/node_modules/.bin/nerdgram" --help > "$work/help.txt"
if ! grep -q "repair-links" "$work/help.txt"; then
  echo "nerdgram --help did not print the command list." >&2
  cat "$work/help.txt" >&2
  exit 1
fi

printf 'flowchart LR\n  A[One] --> B[Two]\n' > "$work/tiny.mmd"
echo "nerdgram lint of a local file from the installed tarball"
"$install/node_modules/.bin/nerdgram" lint "$work/tiny.mmd" > "$work/lint.txt"

npxdir="$work/npx"
mkdir -p "$npxdir"
cd "$npxdir"
echo "npx from the tarball"
npx --yes --package "$tarball" nerdgram --help > "$work/npx-help.txt"
if ! grep -q "repair-links" "$work/npx-help.txt"; then
  echo "npx from the tarball did not print the command list." >&2
  cat "$work/npx-help.txt" >&2
  exit 1
fi

echo "CLI pack smoke passed."
