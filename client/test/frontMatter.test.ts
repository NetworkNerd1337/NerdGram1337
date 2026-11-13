import { describe, expect, it } from "vitest";
import {
  applyDiagramPatch,
  diagramInitConfig,
  diagramSearchRank,
  parseDiagram,
  thumbnailCacheKey,
  DEFAULT_FONT_FAMILY,
} from "../src/lib/frontMatter";
import { commentEdit, toggleCommentLines } from "../src/lib/mermaidComments";

const BODY = "flowchart LR\n  Internet --> Firewall\n";
const CRLF_BODY = "flowchart LR\r\n  Internet --> Firewall\r\n";

describe("client front matter helper", () => {
  it("parses a diagram with no front matter as the original source", () => {
    const source = `%% keep\n${BODY}`;
    const parsed = parseDiagram(source);
    expect(parsed.hasFrontMatter).toBe(false);
    expect(parsed.malformed).toBe(false);
    expect(parsed.body).toBe(source);
    expect(parsed.title).toBeNull();
    expect(diagramInitConfig(source, "dark")).toEqual({
      startOnLoad: false,
      securityLevel: "loose",
      suppressErrorRendering: true,
      theme: "dark",
      fontFamily: DEFAULT_FONT_FAMILY,
    });
  });

  it("does not rewrite malformed YAML", () => {
    const source = `---\ntitle: [\n---\n${BODY}`;
    const parsed = parseDiagram(source);
    expect(parsed.malformed).toBe(true);
    expect(parsed.error).toBeTruthy();
    const next = applyDiagramPatch(source, { title: "Fixed", theme: "forest" });
    expect(next.ok).toBe(false);
    expect(next.source).toBe(source);
  });

  it("preserves CRLF, unknown keys, comments, and the diagram body", () => {
    const source = [
      "---",
      "# keep me",
      "title: Old",
      "owner: ada",
      "config:",
      "  theme: dark # theme note",
      "  extra: 1",
      "---",
      "%% do not touch",
      CRLF_BODY,
    ].join("\r\n");
    const next = applyDiagramPatch(source, { theme: "forest", tags: ["network", "lab"] });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.source.endsWith(`%% do not touch\r\n${CRLF_BODY}`)).toBe(true);
    expect(next.source).toContain("# keep me");
    expect(next.source).toContain("owner: ada");
    expect(next.source).toContain("extra: 1");
    expect(next.source).toContain("# theme note");
    const parsed = parseDiagram(next.source);
    expect(parsed.theme).toBe("forest");
    expect(parsed.tags).toEqual(["network", "lab"]);
    expect(parsed.body).toBe(`%% do not touch\r\n${CRLF_BODY}`);
  });

  it("round-trips a theme change and a tag edit", () => {
    const source = `---\ntitle: Network overview\nconfig:\n  theme: dark\n---\n${BODY}`;
    const themed = applyDiagramPatch(source, { theme: "base", look: "classic" });
    expect(themed.ok).toBe(true);
    if (!themed.ok) return;
    expect(parseDiagram(themed.source).theme).toBe("base");
    expect(themed.source.endsWith(BODY)).toBe(true);
    const tagged = applyDiagramPatch(themed.source, { tags: ["edge"] });
    expect(tagged.ok).toBe(true);
    if (!tagged.ok) return;
    expect(parseDiagram(tagged.source).tags).toEqual(["edge"]);
    expect(parseDiagram(tagged.source).theme).toBe("base");
    expect(tagged.source.endsWith(BODY)).toBe(true);
    expect(thumbnailCacheKey(source)).not.toBe(thumbnailCacheKey(themed.source));
  });

  it("changes the thumbnail cache key for a variables-only edit", () => {
    const base = `---\nconfig:\n  theme: dark\n---\n${BODY}`;
    const variables = `---\nconfig:\n  theme: dark\n  themeVariables:\n    primaryColor: "#ff0000"\n---\n${BODY}`;
    const font = `---\nconfig:\n  theme: dark\n  fontFamily: Georgia\n---\n${BODY}`;
    const css = `---\nconfig:\n  theme: dark\n  themeCSS: ".edge { stroke: red }"\n---\n${BODY}`;
    const seed = `---\nconfig:\n  theme: dark\n  handDrawnSeed: 4\n---\n${BODY}`;
    const keys = [base, variables, font, css, seed].map(thumbnailCacheKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ranks the file name ahead of the title and still matches notes", () => {
    expect(
      diagramSearchRank(
        {
          path: "Notes.mmd",
          title: "Network overview",
          description: "",
          notes: "lab write-up",
          tags: [],
        },
        "Network overview",
      ),
    ).toBe(1);
    expect(
      diagramSearchRank(
        {
          path: "Network overview.mmd",
          title: null,
          description: "",
          notes: "",
          tags: [],
        },
        "Network overview",
      ),
    ).toBe(0);
    expect(
      diagramSearchRank(
        {
          path: "Notes.mmd",
          title: null,
          description: "",
          notes: "lab write-up",
          tags: ["draft"],
        },
        "draft",
      ),
    ).toBe(2);
  });
});

describe("mermaid line comments", () => {
  it("toggles %% comments and leaves the other lines alone", () => {
    const source = `flowchart LR\n  A --> B\n  %% already\n`;
    const commented = toggleCommentLines(source, [1, 2]);
    expect(commented).toBe(`%% flowchart LR\n  %% A --> B\n  %% already\n`);
    expect(toggleCommentLines(commented, [1, 2])).toBe(source);
  });

  it("preserves CRLF outside the toggled line", () => {
    const source = "flowchart LR\r\n  A --> B\r\n";
    expect(toggleCommentLines(source, [2])).toBe("flowchart LR\r\n  %% A --> B\r\n");
  });

  it("comments a mixed selection instead of stripping the commented lines", () => {
    expect(commentEdit(["  A", "  %% B"])).toEqual(["  %% A", "  %% B"]);
  });
});
