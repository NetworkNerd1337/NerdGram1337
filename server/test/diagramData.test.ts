import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clickTargetKind, extractClickLinks } from "../src/diagramLinks.js";
import { lintDiagram } from "../src/diagramLint.js";
import {
  diffIsEmpty,
  diffModels,
  escapeLabel,
  importDiagramData,
  readDataSource,
  readGeneratedModel,
  renderRefresh,
} from "../src/diagramData.js";
import { parseDiagram } from "../src/frontMatter.js";

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/samples");

describe("diagram data import", () => {
  it("turns a links CSV into a grouped flowchart", async () => {
    const text = await fs.readFile(path.join(samples, "campus-links.csv"), "utf8");
    const result = importDiagramData({ text, title: "Campus", sourceFile: "campus-links.csv" });
    expect(result.errors).toEqual([]);
    expect(result.shape).toBe("links");
    expect(result.direction).toBe("LR");
    expect(result.counts).toEqual({ nodes: 3, edges: 3, groups: 2 });
    expect(result.mermaid).toContain("flowchart LR");
    expect(result.mermaid).toContain('subgraph');
    expect(result.mermaid).toContain('["HQ"]');
    expect(result.mermaid).toContain('["Sites"]');
    expect(result.mermaid).toContain('|"Gi0/0 – Gi0/1"|');
    expect(result.mermaid).toContain('click Atlanta "nerdgram:Sites/Atlanta.mmd"');
    expect(result.mermaid).toContain("classDef router");
    expect(result.mermaid).toContain("classDef site");
    expect(lintDiagram(result.mermaid, { diagramPaths: ["Campus.mmd", "Sites/Atlanta.mmd"], sourcePath: "Campus.mmd" })).toEqual(
      [],
    );
  });

  it("turns JSON nodes and edges into a diagram with a child link", async () => {
    const text = await fs.readFile(path.join(samples, "campus.json"), "utf8");
    const result = importDiagramData({ text, sourceFile: "campus.json", direction: "TD" });
    expect(result.errors).toEqual([]);
    expect(result.shape).toBe("graph");
    expect(result.mermaid).toContain("flowchart TD");
    expect(result.mermaid).toContain('click atlanta "nerdgram:Sites/Atlanta.mmd" "Open Atlanta"');
    expect(result.mermaid).toContain('|"TenGigE0/0/1"|');
    expect(lintDiagram(result.mermaid, { diagramPaths: ["campus.mmd", "Sites/Atlanta.mmd"] })).toEqual([]);
    const source = readDataSource(result.mermaid);
    expect(source?.file).toBe("campus.json");
    expect(source?.shape).toBe("graph");
    expect(source?.mapping.id).toBe("id");
  });

  it("reports the row number for a bad links row", () => {
    const text = "Local Device,Remote Device\nCore,Atlanta\n,Remote\n";
    const result = importDiagramData({ text });
    expect(result.errors).toEqual([{ row: 3, message: "Row 3: local device is empty." }]);
    expect(result.mermaid).toBe("");
  });

  it("reports a JSON row number and rejects a diagram path that is not a workspace file", () => {
    const text = JSON.stringify({
      links: [
        { localDevice: "Core", remoteDevice: "Atlanta" },
        { localDevice: "Core", remoteDevice: "Edge", localDiagram: "javascript:alert(1)" },
      ],
    });
    const result = importDiagramData({ text });
    expect(result.errors.map((issue) => issue.row)).toEqual([2]);
    expect(result.errors[0]?.message).toContain("Row 2");
    expect(result.errors[0]?.message).toContain("not a workspace");
    expect(result.mermaid).not.toContain("javascript:");
  });

  it("escapes labels so they cannot close the node or inject a click directive", () => {
    const nasty = '"]\nclick pwn "javascript:alert(1)"\nclassDef evil fill:#fff\nA["';
    const text = `id,label,group\ncore,"${nasty.replaceAll('"', '""')}",HQ\nedge,Edge,HQ\n`;
    const edges = "source,target,label\ncore,edge,up\n";
    const result = importDiagramData({ text, edgesText: edges, shape: "graph", direction: "LR" });
    expect(result.errors).toEqual([]);
    const lines = result.mermaid.split("\n");
    expect(lines.some((line) => /^\s*click\b/i.test(line) && /javascript\s*:/i.test(line))).toBe(false);
    expect(lines.some((line) => /^\s*classDef\s+evil\b/.test(line))).toBe(false);
    expect(lines.some((line) => line.includes("%%{init"))).toBe(false);
    expect(result.mermaid).not.toMatch(/javascript\s*:/i);
    const clicks = extractClickLinks(result.mermaid);
    expect(clicks.every((click) => clickTargetKind(click.target) !== "unsafe")).toBe(true);
    expect(escapeLabel(nasty)).not.toContain("\n");
    expect(escapeLabel(nasty)).not.toContain('"');
    expect(lintDiagram(result.mermaid)).toEqual([]);
  });

  it("rejects an unknown data source", () => {
    expect(() => importDiagramData({ text: "device,port\n", format: "yaml" })).toThrow(/Cisco CDP output, or LLDP/);
  });

  it("refuses data larger than 512 KB", () => {
    expect(() => importDiagramData({ text: `id,label\n${"a".repeat(512 * 1024)}` })).toThrow(/512 KB/);
  });

  it("refreshes between markers and keeps hand edits, notes, and theme", () => {
    const first = importDiagramData({
      text: "id,label,group,type\ncore,Core,HQ,router\nedge,Edge,HQ,router\n",
      edgesText: "source,target,label\ncore,edge,Gi0/1\n",
      shape: "graph",
      title: "Campus",
      sourceFile: "campus.csv",
      edgesFile: "campus.edges.csv",
    });
    const hand = first.mermaid.replace(
      "%% nerdgram:generated end\n",
      '%% nerdgram:generated end\n\n%% kept by hand\n  manual["Kept"]\n',
    );
    const withNotes = hand.replace(
      "nerdgram:\n",
      "config:\n  theme: forest\nnerdgram:\n  notes: Do not drop this.\n",
    );
    const next = importDiagramData({
      text: "id,label,group,type\ncore,Core router,HQ,router\nedge,Edge,HQ,router\nremote,Remote,Sites,site\n",
      edgesText: "source,target,label\ncore,edge,Gi0/2\nedge,remote,Gi0/3\n",
      shape: "graph",
      mapping: first.mapping,
      edgesMapping: first.edgesMapping,
      direction: "TD",
      sourceFile: "campus.csv",
      edgesFile: "campus.edges.csv",
    });
    const source = readDataSource(withNotes);
    expect(source).not.toBeNull();
    const merged = renderRefresh(withNotes, next.model, { ...next.source, direction: "TD" });
    expect(merged).toContain("notes: Do not drop this.");
    expect(merged).toContain("theme: forest");
    expect(merged).toContain('manual["Kept"]');
    expect(merged).toContain("%% kept by hand");
    expect(merged).toContain("flowchart TD");
    expect(merged).not.toContain("Gi0/1");
    const before = readGeneratedModel(withNotes);
    const after = readGeneratedModel(merged);
    expect(before && after).toBeTruthy();
    const diff = diffModels(before!, after!);
    expect(diff.nodes.added.map((node) => node.id)).toContain("remote");
    expect(diff.nodes.changed.some((node) => node.id === "core" && node.fields.includes("label"))).toBe(true);
    expect(diff.edges.changed.some((edge) => edge.before === "Gi0/1" && edge.after === "Gi0/2")).toBe(true);
    expect(diff.edges.added.some((edge) => edge.target === "remote")).toBe(true);
    expect(diffIsEmpty(diff)).toBe(false);
    expect(parseDiagram(merged).malformed).toBe(false);
    expect(parseDiagram(merged).notes).toBe("Do not drop this.");
    expect(parseDiagram(merged).theme).toBe("forest");
    expect(
      lintDiagram(merged, { diagramPaths: ["campus.mmd"] }).filter((item) => item.ruleId !== "unconnected-node"),
    ).toEqual([]);
  });
});
