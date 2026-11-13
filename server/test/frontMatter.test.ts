import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  applyDiagramPatch,
  diagramInitConfig,
  diagramMetaFrom,
  diagramSearchRank,
  matchFrontMatter,
  migrateInitDirectives,
  parseDiagram,
  thumbnailCacheKey,
  FALLBACK_THEME,
  DEFAULT_FONT_FAMILY,
} from "../src/frontMatter.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const BODY = "flowchart LR\n  Internet --> Firewall\n";
const CRLF_BODY = "flowchart LR\r\n  Internet --> Firewall\r\n";

const frontMatterRegex = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

describe("front matter parsing", () => {
  it("leaves a diagram without front matter unchanged", () => {
    const source = `%% a comment\n${BODY}`;
    const parsed = parseDiagram(source);
    expect(parsed.hasFrontMatter).toBe(false);
    expect(parsed.malformed).toBe(false);
    expect(parsed.body).toBe(source);
    expect(parsed.title).toBeNull();
    expect(parsed.tags).toEqual([]);
    expect(diagramInitConfig(source, "dark")).toEqual({
      startOnLoad: false,
      securityLevel: "loose",
      suppressErrorRendering: true,
      theme: "dark",
      fontFamily: DEFAULT_FONT_FAMILY,
    });
  });

  it("matches Mermaid's front matter fence, including the awkward blank-line case", () => {
    const samples = [
      `---\ntitle: Network overview\n---\n${BODY}`,
      `---\r\ntitle: Network overview\r\n---\r\n${CRLF_BODY}`,
      "---\n\n---\n\nMORE\n---\n",
      "  ---\n  title: indented\n  ---\nflowchart LR\n  A --> B\n",
    ];
    for (const sample of samples) {
      const match = matchFrontMatter(sample);
      const regex = frontMatterRegex.exec(sample);
      expect(match?.length).toBe(regex?.[0].length ?? null);
      expect(match?.body).toBe(regex?.[2] ?? null);
    }
    expect(matchFrontMatter(BODY)).toBeNull();
  });

  it("reads title, theme, description, and tags", () => {
    const source = [
      "---",
      "title: Network overview",
      "displayMode: compact",
      "config:",
      "  theme: forest",
      "  look: handDrawn",
      "  layout: elk",
      "nerdgram:",
      "  description: Edge path",
      "  notes: |",
      "    Keep the lab notes",
      "  tags:",
      "    - network",
      "    - draft",
      "---",
      BODY,
    ].join("\n");
    const parsed = parseDiagram(source);
    expect(parsed.title).toBe("Network overview");
    expect(parsed.theme).toBe("forest");
    expect(parsed.look).toBe("handDrawn");
    expect(parsed.layout).toBe("elk");
    expect(parsed.displayMode).toBe("compact");
    expect(parsed.description).toBe("Edge path");
    expect(parsed.notes).toBe("Keep the lab notes\n");
    expect(parsed.tags).toEqual(["network", "draft"]);
    expect(parsed.body).toBe(BODY);
  });

  it("reports malformed YAML and refuses to rewrite it", () => {
    const source = `---\ntitle: [\nconfig:\n  theme: forest\n---\n${BODY}`;
    const parsed = parseDiagram(source);
    expect(parsed.malformed).toBe(true);
    expect(parsed.error).toBeTruthy();
    expect(parsed.title).toBeNull();
    const next = applyDiagramPatch(source, { theme: "dark", title: "Replaced" });
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error).toBeTruthy();
    expect(next.source).toBe(source);
  });

  it("preserves unknown keys, YAML comments, %% comments, and the body on a theme change", () => {
    const source = [
      "---",
      "# keep me",
      "title: Old",
      "owner: ada",
      "config:",
      "  theme: dark # theme note",
      "  extra: 1",
      "  flowchart:",
      "    curve: linear",
      "---",
      "%% do not touch",
      BODY,
    ].join("\n");
    const next = applyDiagramPatch(source, { theme: "forest", look: "handDrawn" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.source.endsWith(`%% do not touch\n${BODY}`)).toBe(true);
    expect(next.source).toContain("# keep me");
    expect(next.source).toContain("owner: ada");
    expect(next.source).toContain("extra: 1");
    expect(next.source).toContain("curve: linear");
    expect(next.source).toContain("# theme note");
    const parsed = parseDiagram(next.source);
    expect(parsed.theme).toBe("forest");
    expect(parsed.look).toBe("handDrawn");
    expect(parsed.title).toBe("Old");
    expect(parsed.body).toBe(`%% do not touch\n${BODY}`);
  });

  it("round-trips a theme change and tag edit on a CRLF file without touching the body", () => {
    const source = `---\r\ntitle: Network overview\r\nconfig:\r\n  theme: dark\r\n---\r\n${CRLF_BODY}`;
    const themed = applyDiagramPatch(source, { theme: "forest" });
    expect(themed.ok).toBe(true);
    if (!themed.ok) return;
    expect(themed.source.endsWith(CRLF_BODY)).toBe(true);
    expect(themed.source.includes("\r\n")).toBe(true);
    expect(parseDiagram(themed.source).theme).toBe("forest");

    const tagged = applyDiagramPatch(themed.source, {
      tags: ["network", "lab"],
      description: "Edge path",
      notes: "Line one\nLine two",
    });
    expect(tagged.ok).toBe(true);
    if (!tagged.ok) return;
    expect(tagged.source.endsWith(CRLF_BODY)).toBe(true);
    const parsed = parseDiagram(tagged.source);
    expect(parsed.tags).toEqual(["network", "lab"]);
    expect(parsed.description).toBe("Edge path");
    expect(parsed.notes).toBe("Line one\nLine two");
    expect(parsed.theme).toBe("forest");
    expect(parsed.body).toBe(CRLF_BODY);
  });

  it("keeps a comment-only header and adds a title without dropping the comment", () => {
    const source = `---\n# just a note\n---\n${BODY}`;
    const next = applyDiagramPatch(source, { title: "Network overview" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.source).toContain("# just a note");
    expect(next.source.endsWith(BODY)).toBe(true);
    expect(parseDiagram(next.source).title).toBe("Network overview");
  });

  it("lets front matter theme and a diagram-type theme win over the app fallback", () => {
    const forest = `---\nconfig:\n  theme: forest\n  look: handDrawn\n  securityLevel: strict\n---\n${BODY}`;
    const init = diagramInitConfig(forest, FALLBACK_THEME);
    expect(init.theme).toBe("forest");
    expect(init.look).toBe("handDrawn");
    expect(init.securityLevel).toBe("loose");
    expect(init.maxTextSize).toBeUndefined();

    const scoped = `---\nconfig:\n  theme: dark\n  flowchart:\n    theme: forest\n---\n${BODY}`;
    expect(diagramInitConfig(scoped, "dark").theme).toBe("forest");
  });

  it("changes the thumbnail cache key when only the theme, look, layout, or title changes", () => {
    const base = `---\nconfig:\n  theme: dark\n---\n${BODY}`;
    const theme = applyDiagramPatch(base, { theme: "forest" });
    const look = applyDiagramPatch(base, { look: "handDrawn" });
    const layout = applyDiagramPatch(base, { layout: "dagre" });
    const title = applyDiagramPatch(base, { title: "Network overview" });
    expect(theme.ok && look.ok && layout.ok && title.ok).toBe(true);
    if (!theme.ok || !look.ok || !layout.ok || !title.ok) return;
    const keys = [base, theme.source, look.source, layout.source, title.source].map(thumbnailCacheKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("changes the thumbnail cache key when only variables, CSS, font, or hand-drawn seed change", () => {
    const base = `---\nconfig:\n  theme: dark\n---\n${BODY}`;
    const variables = `---\nconfig:\n  theme: dark\n  themeVariables:\n    primaryColor: "#ff0000"\n---\n${BODY}`;
    const css = `---\nconfig:\n  theme: dark\n  themeCSS: ".node rect { fill: #fff }"\n---\n${BODY}`;
    const font = `---\nconfig:\n  theme: dark\n  fontFamily: Georgia\n---\n${BODY}`;
    const seed = `---\nconfig:\n  theme: dark\n  handDrawnSeed: 7\n---\n${BODY}`;
    const notes = applyDiagramPatch(base, { notes: "lab write-up" });
    expect(notes.ok).toBe(true);
    if (!notes.ok) return;
    const keys = [base, variables, css, font, seed, notes.source].map(thumbnailCacheKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(thumbnailCacheKey(base)).toBe(thumbnailCacheKey(base));
  });

  it("migrates a deprecated init directive and keeps an unknown key", () => {
    const source = [
      "---",
      "title: Network overview",
      "owner: ada",
      "config:",
      "  fontFamily: Georgia",
      "---",
      "%%{init: { 'theme': 'forest', 'look': 'handDrawn' }}%%",
      "%% keep this comment",
      BODY,
    ].join("\n");
    expect(parseDiagram(source).hasLegacyInit).toBe(true);
    expect(diagramInitConfig(source, "dark").theme).toBe("forest");
    const migrated = migrateInitDirectives(source);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.migrated).toBe(true);
    expect(migrated.source).not.toContain("%%{init:");
    expect(migrated.source).toContain("%% keep this comment");
    expect(migrated.source).toContain("owner: ada");
    expect(migrated.source).toContain("fontFamily: Georgia");
    const parsed = parseDiagram(migrated.source);
    expect(parsed.hasLegacyInit).toBe(false);
    expect(parsed.theme).toBe("forest");
    expect(parsed.look).toBe("handDrawn");
    expect(parsed.title).toBe("Network overview");
    expect(parsed.body).toBe(`%% keep this comment\n${BODY}`);
  });

  it("does not migrate when the directive cannot be parsed", () => {
    const source = `%%{init: { theme: forest }}%%\n${BODY}`;
    const migrated = migrateInitDirectives(source);
    expect(migrated.ok).toBe(false);
    expect(migrated.source).toBe(source);
  });

  it("ranks a file name ahead of a title, and still finds notes and tags", () => {
    const overview = {
      path: "Examples/Other.mmd",
      title: "Network overview",
      description: "Edge path",
      notes: "lab write-up",
      tags: ["lab-only"],
    };
    const named = {
      path: "Network overview.mmd",
      title: "Something else",
      description: "",
      notes: "",
      tags: [],
    };
    expect(diagramSearchRank(overview, "Network overview")).toBe(1);
    expect(diagramSearchRank(named, "Network overview")).toBe(0);
    expect(diagramSearchRank(overview, "lab write-up")).toBe(4);
    expect(diagramSearchRank(overview, "edge")).toBe(3);
    expect(diagramSearchRank(overview, "lab-only")).toBe(2);
    expect(diagramSearchRank(overview, "missing")).toBeNull();
    expect(
      diagramSearchRank(
        { ...overview, elements: [{ kind: "node", text: "Firewall", line: 2 }] },
        "Firewall",
      ),
    ).toBe(5);
    expect(
      diagramSearchRank(
        {
          ...named,
          elements: [{ kind: "node", text: "Network overview", line: 1 }],
        },
        "Network overview",
      ),
    ).toBe(0);
  });
});

describe("GET /api/diagram-meta", () => {
  let dir = "";
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns title, tags, and theme, skips .meta, and does not rewrite a broken header", async () => {
    const api = app();
    const good = [
      "---",
      "title: Network overview",
      "config:",
      "  theme: forest",
      "nerdgram:",
      "  description: Edge path",
      "  tags:",
      "    - network",
      "---",
      BODY,
    ].join("\n");
    const broken = `---\ntitle: [\n---\n${BODY}`;
    const created = await request(api)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "Examples/Overview.mmd", content: good });
    expect(created.status).toBe(200);

    const brokenWrite = await request(api)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "Broken.mmd", content: broken });
    expect(brokenWrite.status).toBe(200);

    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".meta", "hidden.mmd"),
      `---\ntitle: Secret\n---\n${BODY}`,
      "utf8",
    );
    const before = await fs.readFile(path.join(dir, "Broken.mmd"), "utf8");

    const blocked = await request(api).get("/api/diagram-meta").set("Host", "evil.example");
    expect(blocked.status).toBe(403);

    const listed = await request(api).get("/api/diagram-meta").set("Host", HOST);
    expect(listed.status).toBe(200);
    const diagrams = listed.body.diagrams as { path: string; title: string | null; tags: string[]; theme: string | null; malformed: boolean }[];
    expect(diagrams.map((item) => item.path).sort()).toEqual(["Broken.mmd", "Examples/Overview.mmd"]);
    const overview = diagrams.find((item) => item.path === "Examples/Overview.mmd");
    expect(overview).toMatchObject({
      title: "Network overview",
      tags: ["network"],
      theme: "forest",
      malformed: false,
    });
    expect(diagrams.find((item) => item.path === "Broken.mmd")?.malformed).toBe(true);
    expect(diagrams.some((item) => item.path.includes(".meta"))).toBe(false);

    const after = await fs.readFile(path.join(dir, "Broken.mmd"), "utf8");
    expect(after).toBe(before);
    expect(diagramMetaFrom("Examples/Overview.mmd", good).description).toBe("Edge path");
  });

  it("keeps front matter on duplicate and in the previous revision", async () => {
    const api = app();
    const original = `---\ntitle: Network overview\nconfig:\n  theme: forest\n---\n${BODY}`;
    const updated = `---\ntitle: Network overview\nconfig:\n  theme: forest\n---\n${BODY}%% edited\n`;
    const created = await request(api)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "Overview.mmd", content: original });
    expect(created.status).toBe(200);

    const duplicated = await request(api)
      .post("/api/duplicate")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "Overview.mmd" });
    expect(duplicated.status).toBe(201);
    const copy = await request(api)
      .get("/api/file")
      .set("Host", HOST)
      .query({ path: duplicated.body.path });
    expect(copy.body.content).toBe(original);

    const saved = await request(api)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({
        path: "Overview.mmd",
        content: updated,
        expectedMtimeMs: created.body.mtimeMs,
        expectedHash: created.body.hash,
      });
    expect(saved.status).toBe(200);

    const history = await request(api)
      .get("/api/history")
      .set("Host", HOST)
      .query({ path: "Overview.mmd" });
    expect(history.status).toBe(200);
    const revisionId = history.body.revisions[0].id as string;
    const revision = await request(api)
      .get("/api/history/revision")
      .set("Host", HOST)
      .query({ path: "Overview.mmd", id: revisionId });
    expect(revision.status).toBe(200);
    expect(revision.body.content).toBe(original);
    expect(revision.body.content).toContain("title: Network overview");
    expect(revision.body.content).toContain("theme: forest");
  });
});
