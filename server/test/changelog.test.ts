import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/paths.js";

function notes(args: string[], changelog?: string): { code: number; stdout: string; stderr: string } {
  const dir = changelog == null ? "" : fs.mkdtempSync(path.join(os.tmpdir(), "nerdgram-notes-"));
  const file = dir ? path.join(dir, "CHANGELOG.md") : "";
  if (file) fs.writeFileSync(file, changelog ?? "");
  const argv = [...args];
  if (file) argv.push("--file", file);
  try {
    const stdout = execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts/changelog-notes.mjs"), ...argv], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const error = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      code: error.status ?? 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("changelog notes", () => {
  it("prints the Atlas title and the 1.0.6 section without the heading", () => {
    const title = notes(["--title", "v1.0.6"]);
    expect(title.code).toBe(0);
    expect(title.stdout).toBe('v1.0.6 "Atlas"\n');
    const body = notes(["v1.0.6"]);
    expect(body.code).toBe(0);
    expect(body.stdout.startsWith("Patch on the Atlas line.")).toBe(true);
    expect(body.stdout).toContain("Take over editing");
    expect(body.stdout).not.toContain('## 1.0.6 "Atlas"');
    expect(body.stdout).not.toContain("### Highlights");
  });

  it("matches a quoted heading and a bracket heading, and not a longer patch", () => {
    const quoted = notes(
      ["v1.2.3"],
      '## 1.2.3 "Atlas" - 2026-11-13\n\nQuoted body.\n\n## 1.2.30\n\nOther.\n',
    );
    expect(quoted.code).toBe(0);
    expect(quoted.stdout).toBe("Quoted body.\n");
    const bracket = notes(["v1.2.3"], "## [1.2.3]\n\nBracket body.\n");
    expect(bracket.stdout).toBe("Bracket body.\n");
    const longer = notes(["v1.0.5"], '## 1.0.50 "Atlas" - 2026-11-13\n\nNot this one.\n');
    expect(longer.code).toBe(2);
    expect(longer.stderr).toMatch(/no section for 1\.0\.5/);
  });

  it("titles a later major from the map and refuses a heading that names the wrong code name", () => {
    const meridian = notes(["--title", "v2.0.0"], '## 2.0.0 "Meridian" - 2026-12-01\n\nNext line.\n');
    expect(meridian.code).toBe(0);
    expect(meridian.stdout).toBe('v2.0.0 "Meridian"\n');
    const wrong = notes(["--title", "v1.0.5"], '## 1.0.5 "Wrong" - 2026-11-13\n\nBody.\n');
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toMatch(/does not match package.json Atlas/);
    const empty = notes(["v1.0.5"], "## 1.0.5 \"Atlas\" - 2026-11-13\n\n");
    expect(empty.code).toBe(2);
    expect(empty.stderr).toMatch(/empty/);
    const badTag = notes(["v1.0.5-beta.1"]);
    expect(badTag.code).toBe(2);
  });
});
