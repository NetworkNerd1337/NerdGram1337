import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/paths.js";
import { CLI_PACKAGE_NAME, VERSIONED_PACKAGES, cliPackageError, driftedVersions } from "../../scripts/check-version.mjs";

describe("cli package version", () => {
  it("includes cli/package.json in version:check", () => {
    expect(VERSIONED_PACKAGES).toContain("cli/package.json");
  });

  it("fails when the cli version drifts from the root", () => {
    const drifted = driftedVersions([
      { file: "package.json", version: "1.1.0" },
      { file: "client/package.json", version: "1.1.0" },
      { file: "server/package.json", version: "1.1.0" },
      { file: "cli/package.json", version: "9.9.9" },
    ]);
    expect(drifted).toEqual([{ file: "cli/package.json", version: "9.9.9" }]);
    expect(
      cliPackageError(
        {
          name: CLI_PACKAGE_NAME,
          version: "9.9.9",
          bin: { nerdgram: "./bin/nerdgram.js" },
          publishConfig: { access: "public" },
          files: ["bin", "dist"],
        },
        "1.1.0",
      ),
    ).toMatch(/9\.9\.9/);
  });

  it("rejects a package that is not the public nerdgram1337 command", () => {
    const base = {
      version: "1.1.0",
      bin: { nerdgram: "./bin/nerdgram.js" },
      publishConfig: { access: "public" },
      files: ["bin", "dist"],
    };
    expect(cliPackageError({ ...base, name: "nerdgram" }, "1.1.0")).toMatch(/nerdgram1337/);
    expect(cliPackageError({ ...base, name: CLI_PACKAGE_NAME, private: true }, "1.1.0")).toMatch(/private/);
    expect(cliPackageError({ ...base, name: CLI_PACKAGE_NAME, bin: {} }, "1.1.0")).toMatch(/nerdgram/);
  });

  it("accepts the cli package checked in to this tree", async () => {
    const root = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8")) as { version: string };
    const cli = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "cli/package.json"), "utf8"));
    expect(cliPackageError(cli, root.version)).toBeNull();
    expect(cli.name).toBe("nerdgram1337");
    expect(cli.bin.nerdgram).toBe("./bin/nerdgram.js");
  });

  it("version:check passes for this tree", () => {
    const stdout = execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts/check-version.mjs")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(stdout).toContain(CLI_PACKAGE_NAME);
  });

  it("documents npm install and npx", async () => {
    const readme = await fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8");
    const cliReadme = await fs.readFile(path.join(REPO_ROOT, "cli/README.md"), "utf8");
    const docs = await fs.readFile(path.join(REPO_ROOT, "docs/cli.md"), "utf8");
    const changelog = await fs.readFile(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    for (const text of [readme, cliReadme, docs]) {
      expect(text).toContain("npm install -g nerdgram1337");
      expect(text).toContain("npx nerdgram1337 --help");
    }
    const unreleased = changelog.split(/^## 1\./m)[0] ?? "";
    expect(unreleased).toContain("npm install -g nerdgram1337");
    expect(unreleased).toContain("npx nerdgram1337 --help");
  });
});
