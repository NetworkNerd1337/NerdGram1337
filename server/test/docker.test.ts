import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDockerIgnored } from "../src/dockerContext.js";
import { bundledSampleFiles } from "../src/seed.js";
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

    const codename = JSON.parse(await read("package.json")).codenames["1"] as string;
    expect(dockerfile).toContain(`ARG NERDGRAM_VERSION=${version}`);
    expect(dockerfile).toContain(`ARG NERDGRAM_CODENAME=${codename}`);
    expect(dockerfile).toContain('org.opencontainers.image.codename="${NERDGRAM_CODENAME}"');
    expect(dockerfile).toContain("NERDGRAM_CODENAME=${NERDGRAM_CODENAME}");
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
    expect(compose).not.toMatch(/^\s*build\s*:/m);
    const buildCompose = await read("compose.build.yaml");
    expect(buildCompose).toContain("image: nerdgram1337:local");
    expect(buildCompose).toContain(`NERDGRAM_VERSION: "${version}"`);
    expect(buildCompose).toContain(`NERDGRAM_CODENAME: "${codename}"`);
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
    expect(publish).toContain("org.opencontainers.image.codename");
    expect(publish).toContain("NERDGRAM_CODENAME=${{ env.codename }}");
    expect(release).toContain("changelog-notes.mjs --title");
    expect(release).toContain("name: ${{ steps.notes.outputs.title }}");
    expect(publish).toContain('tags:\n      - "v*.*.*"');
    expect(release).toContain('tags:\n      - "v*.*.*"');
    expect(ci).toContain("scripts/docker-smoke.sh");
    expect(ci).toContain("push: false");
  });

  it("ships every bundled sample, including ones added under diagrams/", async () => {
    const ignore = await read(".dockerignore");
    const samples = await bundledSampleFiles();
    expect(samples).toEqual(
      expect.arrayContaining(["Welcome.mmd", "NetworkMap.mmd", "Examples/Sequence.mmd", "WAN.mmd", "Sites/Atlanta.mmd"]),
    );
    const excluded = samples.filter((file) => isDockerIgnored(ignore, `diagrams/${file}`));
    expect(excluded).toEqual([]);

    const oldIgnore = [
      "diagrams/**",
      "!diagrams/Welcome.mmd",
      "!diagrams/NetworkMap.mmd",
      "!diagrams/Examples/",
      "!diagrams/Examples/Sequence.mmd",
    ].join("\n");
    expect(isDockerIgnored(oldIgnore, "diagrams/Welcome.mmd")).toBe(false);
    expect(isDockerIgnored(oldIgnore, "diagrams/WAN.mmd")).toBe(true);
    expect(isDockerIgnored(oldIgnore, "diagrams/Sites/Atlanta.mmd")).toBe(true);
  });
});
