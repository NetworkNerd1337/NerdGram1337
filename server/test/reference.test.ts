import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/paths.js";
import {
  getReferencePage,
  listReference,
  referenceWriteLayout,
  rewriteReferenceLinks,
  syncReference,
} from "../src/syntaxReference.js";
import { makeTempDataDir } from "./helpers.js";

const TOKEN = "SyncedTokenXY";

function pageHtml(): string {
  return `<!doctype html><html><head><title>Diagram | Mermaid</title></head><body><main class="vp-doc"><h1>Diagram</h1><p>${TOKEN}</p></main></body></html>`;
}

async function bundledHash(): Promise<string> {
  const raw = await fs.readFile(path.join(REPO_ROOT, "reference", "manifest.json"));
  return createHash("sha256").update(raw).digest("hex");
}

describe("reference sync layout", () => {
  let cleanup = async () => {};
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await cleanup();
    cleanup = async () => {};
  });

  it("serves the bundled mirror when the data directory has no synced copy", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const listed = await listReference();
    expect(listed.pages.some((page) => page.id === "flowchart")).toBe(true);
    const page = await getReferencePage("flowchart");
    expect(page.content).not.toContain(TOKEN);
    await expect(fs.access(path.join(temp.dir, ".meta", "reference"))).rejects.toThrow();
  });

  it("writes a synced copy under the data directory and leaves the bundled tree alone", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const before = await bundledHash();
    globalThis.fetch = async () =>
      new Response(pageHtml(), { status: 200, headers: { "content-type": "text/html" } });
    const manifest = await syncReference();
    expect(manifest.pages.length).toBeGreaterThan(5);
    expect(manifest.pages.some((page) => page.id === "flowchart")).toBe(true);
    const synced = await fs.readFile(path.join(temp.dir, ".meta", "reference", "pages", "flowchart.md"), "utf8");
    expect(synced).toContain(TOKEN);
    const page = await getReferencePage("flowchart");
    expect(page.content).toContain(TOKEN);
    expect(await bundledHash()).toBe(before);
    await expect(fs.access(path.join(REPO_ROOT, "reference.staging"))).rejects.toThrow();
    await expect(fs.access(path.join(REPO_ROOT, "reference.bak"))).rejects.toThrow();
    await expect(fs.access(path.join(temp.dir, ".meta", "reference.staging"))).rejects.toThrow();
  });

  it("keeps the bundled mirror when sync fails", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const before = await bundledHash();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("syntax-reference")) return new Response("no", { status: 500 });
      return new Response(pageHtml(), { status: 200, headers: { "content-type": "text/html" } });
    };
    await expect(syncReference()).rejects.toThrow(/existing library left unchanged/);
    expect(await bundledHash()).toBe(before);
    await expect(fs.access(path.join(temp.dir, ".meta", "reference", "manifest.json"))).rejects.toThrow();
    const page = await getReferencePage("flowchart");
    expect(page.content).not.toContain(TOKEN);
  });

  it("rewrites retired Mermaid doc URLs so a sync cannot put them back", async () => {
    const retired =
      "See [Getting Started](https://mermaid.js.org/getting-started.html#_4-calling-the-mermaid-javascript-api) and [Flowchart](https://mermaid.js.org/flowchart.html#links-between-nodes).";
    const rewritten = rewriteReferenceLinks(retired);
    expect(rewritten).toContain(
      "https://mermaid.js.org/intro/getting-started.html#_4-calling-the-mermaid-javascript-api",
    );
    expect(rewritten).toContain("https://mermaid.js.org/syntax/flowchart.html#links-between-nodes");
    expect(rewritten).not.toContain("https://mermaid.js.org/getting-started.html");
    expect(rewritten).not.toContain("](https://mermaid.js.org/flowchart.html");

    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    globalThis.fetch = async () =>
      new Response(
        `<!doctype html><html><head><title>Diagram | Mermaid</title></head><body><main class="vp-doc"><p><a href="https://mermaid.js.org/getting-started.html">Start</a> <a href="https://mermaid.js.org/pie.html">Pie</a></p><p>${TOKEN}</p></main></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    await syncReference();
    const synced = await fs.readFile(
      path.join(temp.dir, ".meta", "reference", "pages", "flowchart.md"),
      "utf8",
    );
    expect(synced).toContain("https://mermaid.js.org/intro/getting-started.html");
    expect(synced).toContain("https://mermaid.js.org/syntax/pie.html");
    expect(synced).not.toContain("https://mermaid.js.org/getting-started.html");
    expect(synced).not.toMatch(/https:\/\/mermaid\.js\.org\/pie\.html/);
    const served = await getReferencePage("syntax-reference");
    expect(served.content).toContain("https://mermaid.js.org/intro/getting-started.html");
    expect(served.content).not.toContain("https://mermaid.js.org/getting-started.html");
  });

  it("keeps the repo-root layout when NERDGRAM_DATA_DIR is unset", async () => {
    const previous = process.env.NERDGRAM_DATA_DIR;
    delete process.env.NERDGRAM_DATA_DIR;
    try {
      const layout = referenceWriteLayout();
      expect(layout.inDataDir).toBe(false);
      expect(layout.live).toBe(path.join(REPO_ROOT, "reference"));
      expect(layout.staging).toBe(path.join(REPO_ROOT, "reference.staging"));
    } finally {
      if (previous === undefined) delete process.env.NERDGRAM_DATA_DIR;
      else process.env.NERDGRAM_DATA_DIR = previous;
    }
  });
});
