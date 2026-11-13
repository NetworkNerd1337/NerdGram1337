import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/paths.js";

async function read(relative: string): Promise<string> {
  return fs.readFile(path.join(REPO_ROOT, relative), "utf8");
}

describe("docker packaging", () => {
  it("publishes loopback only and pins the image tag to the package version", async () => {
    const version = JSON.parse(await read("package.json")).version as string;
    const dockerfile = await read("Dockerfile");
    const compose = await read("compose.yaml");
    const ignore = await read(".dockerignore");
    const publish = await read(".github/workflows/docker-publish.yml");
    const ci = await read(".github/workflows/ci.yml");
    const release = await read(".github/workflows/release.yml");

    expect(dockerfile).toContain(`ARG NERDGRAM_VERSION=${version}`);
    expect(dockerfile).toContain("HOST=0.0.0.0");
    expect(dockerfile).toContain("NERDGRAM_DATA_DIR=/data");
    expect(dockerfile).toContain("NERDGRAM_INSTALL=docker");
    expect(dockerfile).toContain("NERDGRAM_COMMIT");
    expect(dockerfile).toContain("/api/health");
    expect(dockerfile).toContain("--uid 1001");
    expect(dockerfile).toContain("org.opencontainers.image.source");
    expect(dockerfile).toContain("org.opencontainers.image.revision");
    expect(dockerfile).not.toMatch(/apt-get install[^\n]*\bgit\b/);

    expect(compose).toContain(`ghcr.io/networknerd1337/nerdgram1337:v${version}`);
    expect(compose).toContain("127.0.0.1:8787:8787");
    expect(compose).toContain("container_name: nerdgram1337");
    expect(compose).toContain("name: nerdgram-data");
    expect(compose).toContain("unless-stopped");
    expect(compose).not.toMatch(/(^|[\s"'])8787:8787/);
    expect(dockerfile).not.toMatch(/(^|[\s"'])8787:8787/);

    for (const needle of ["node_modules", ".git", ".meta", "github-token"]) {
      expect(ignore).toContain(needle);
    }

    expect(publish).toContain("packages: write");
    expect(publish).toContain("contents: read");
    expect(publish).not.toContain("pull_request");
    expect(publish).toContain("linux/amd64,linux/arm64");
    expect(publish).toContain("scripts/check-version.mjs");
    expect(publish).toContain('tags:\n      - "v*.*.*"');
    expect(release).toContain('tags:\n      - "v*.*.*"');
    expect(ci).toContain("scripts/docker-smoke.sh");
    expect(ci).toContain("push: false");
  });
});
