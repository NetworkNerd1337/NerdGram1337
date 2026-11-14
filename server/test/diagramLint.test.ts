import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyEdits,
  lintDiagram,
  mergeAstFacts,
  normalizeLintRules,
  type LintDiagnostic,
  type LintFix,
} from "../src/diagramLint.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function byRule(source: string, ruleId: string, options?: Parameters<typeof lintDiagram>[1]): LintDiagnostic[] {
  return lintDiagram(source, options).filter((item) => item.ruleId === ruleId);
}

function fixNamed(diagnostic: LintDiagnostic, id: LintFix["id"]): LintFix {
  const fix = diagnostic.fixes.find((item) => item.id === id);
  expect(fix, `${id} on ${diagnostic.message}`).toBeTruthy();
  if (!fix) throw new Error("missing fix");
  return fix;
}

function restored(source: string, fix: LintFix): string {
  const next = applyEdits(source, fix.edits);
  const inverse = fix.edits.map((edit) => ({
    from: edit.from,
    to: edit.from + edit.insert.length,
    insert: source.slice(edit.from, edit.to),
  }));
  return applyEdits(next, inverse);
}

describe("duplicate node ids", () => {
  it("warns when the same id is defined with two labels and can rename or jump", () => {
    const source = "flowchart LR\n  A[One] --> B[End]\n  A[Two]\n";
    const hits = byRule(source, "duplicate-id");
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit?.line).toBe(3);
    expect(hit?.message).toContain("Two");
    expect(hit?.message).toContain("One");
    const rename = fixNamed(hit!, "rename-duplicate");
    expect(applyEdits(source, rename.edits)).toContain("A2[Two]");
    expect(applyEdits(source, rename.edits)).toContain("A[One]");
    expect(restored(source, rename)).toBe(source);
    const jump = fixNamed(hit!, "jump-to-definition");
    expect(jump.edits).toEqual([]);
    expect(source.slice(jump.jump?.from, jump.jump?.to)).toBe("A");
    expect(applyEdits(source, jump.edits)).toBe(source);
  });

  it("stays quiet when the same id repeats the same label", () => {
    const source = "flowchart LR\n  A[One] --> B[End]\n  A[One] --> C[More]\n";
    expect(byRule(source, "duplicate-id")).toEqual([]);
  });
});

describe("unconnected flowchart nodes", () => {
  it("warns about a node left out of the connections", () => {
    const source = "flowchart LR\n  A[Start] --> B[End]\n  C[Orphan]\n";
    const hits = byRule(source, "unconnected-node");
    expect(hits.map((hit) => hit.subject)).toEqual(["C"]);
    expect(hits[0]?.line).toBe(3);
  });

  it("does not warn when every node is connected, or when a single node has no edges", () => {
    expect(byRule("flowchart LR\n  A[Start] --> B[End]\n", "unconnected-node")).toEqual([]);
    expect(byRule("flowchart LR\n  A[Only]\n", "unconnected-node")).toEqual([]);
    expect(byRule("flowchart TD\n  Internet --> Firewall\n  Firewall --> Core\n", "unconnected-node")).toEqual([]);
  });
});

describe("edges to a node with no label", () => {
  it("warns when a connection names an id that was never labeled", () => {
    const source = "flowchart LR\n  Start[Start] --> Ennd\n";
    const hits = byRule(source, "unlabeled-endpoint");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("Ennd");
    expect(hits[0]?.message).toMatch(/no label/i);
  });

  it("does not warn for implicit ids, or when every endpoint has a label", () => {
    expect(byRule("flowchart LR\n  Internet --> Firewall\n", "unlabeled-endpoint")).toEqual([]);
    expect(byRule("flowchart LR\n  Start[Start] --> End[End]\n", "unlabeled-endpoint")).toEqual([]);
  });

  it("does not flag an implicit flowchart just because one extra node has a label", () => {
    const source = "flowchart LR\n  Internet --> Firewall\n  Firewall --> Core\n  C[Orphan]\n";
    expect(byRule(source, "unlabeled-endpoint")).toEqual([]);
    expect(byRule(source, "unconnected-node").map((hit) => hit.subject)).toEqual(["C"]);
  });

  it("warns on a sequence message to a participant that was never declared", () => {
    const source = "sequenceDiagram\n  participant Alice\n  Alice->>Alic: Hi\n";
    const hits = byRule(source, "unlabeled-endpoint");
    expect(hits.map((hit) => hit.subject)).toEqual(["Alic"]);
  });

  it("does not warn when sequence participants are only implicit", () => {
    const source = "sequenceDiagram\n  Alice->>Bob: Hi\n";
    expect(byRule(source, "unlabeled-endpoint")).toEqual([]);
  });

  it("warns on a state transition to an undeclared state, and not on a plain transition list", () => {
    const declared = "stateDiagram-v2\n  state \"Moving\" as Moving\n  Still --> Moving\n";
    expect(byRule(declared, "unlabeled-endpoint").map((hit) => hit.subject)).toEqual(["Still"]);
    const plain = "stateDiagram-v2\n  [*] --> Still\n  Still --> Moving\n";
    expect(byRule(plain, "unlabeled-endpoint")).toEqual([]);
  });
});

describe("classDef and class", () => {
  it("warns about an unused classDef and removes it", () => {
    const source = "flowchart LR\n  classDef muted fill:#eee\n  classDef used fill:#333\n  A[One]:::used --> B[Two]\n";
    const hits = byRule(source, "unused-class");
    expect(hits.map((hit) => hit.subject)).toEqual(["muted"]);
    const remove = fixNamed(hits[0]!, "remove-classdef");
    const next = applyEdits(source, remove.edits);
    expect(next).not.toContain("muted");
    expect(next).toContain("classDef used");
    expect(restored(source, remove)).toBe(source);
    expect(byRule(next, "unused-class")).toEqual([]);
  });

  it("does not warn when the class is applied, including the default class", () => {
    const source = "flowchart LR\n  classDef used fill:#333\n  classDef default fill:#fff\n  A[One]:::used --> B[Two]\n";
    expect(byRule(source, "unused-class")).toEqual([]);
    expect(byRule(source, "undefined-class")).toEqual([]);
  });

  it("warns about a class that was never defined and can create it", () => {
    const source = "flowchart LR\n  A[One] --> B[Two]\n  class A missing\n";
    const hits = byRule(source, "undefined-class");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("missing");
    const create = fixNamed(hits[0]!, "create-class");
    const next = applyEdits(source, create.edits);
    expect(next).toContain("classDef missing fill:#f9f,stroke:#333");
    expect(byRule(next, "undefined-class")).toEqual([]);
    expect(restored(source, create)).toBe(source);
  });

  it("warns about a ::: class with no classDef, on flowcharts and state diagrams", () => {
    expect(byRule("flowchart LR\n  A[One]:::missing --> B[Two]\n", "undefined-class")[0]?.subject).toBe("missing");
    const state = "stateDiagram-v2\n  [*] --> Still\n  classDef bad fill:#f00\n  class Still other\n";
    expect(byRule(state, "undefined-class").map((hit) => hit.subject)).toEqual(["other"]);
    expect(byRule(state, "unused-class").map((hit) => hit.subject)).toEqual(["bad"]);
  });
});

describe("front matter", () => {
  it("points at a YAML header that cannot be parsed", () => {
    const source = "---\ntitle: [\n---\nflowchart LR\n  A --> B\n";
    const hits = byRule(source, "front-matter");
    expect(hits.some((hit) => hit.severity === "error" && /YAML header/.test(hit.message))).toBe(true);
    expect(hits[0]?.line).toBeGreaterThan(0);
  });

  it("warns about an unknown theme and tags that are not a list", () => {
    const source = "---\ntitle: Map\nconfig:\n  theme: neon\nnerdgram:\n  tags: lab\n---\nflowchart LR\n  A[One] --> B[Two]\n";
    const hits = byRule(source, "front-matter");
    expect(hits.map((hit) => hit.message).join("\n")).toMatch(/neon/);
    expect(hits.map((hit) => hit.message).join("\n")).toMatch(/Tags/);
  });

  it("accepts a normal header", () => {
    const source = "---\ntitle: Map\nconfig:\n  theme: forest\n  look: classic\n  layout: dagre\nnerdgram:\n  tags:\n    - lab\n---\nflowchart LR\n  A[One] --> B[Two]\n";
    expect(byRule(source, "front-matter")).toEqual([]);
  });
});

describe("click links to diagrams", () => {
  const source = 'flowchart LR\n  A[One] --> B[Two]\n  click A "Missing.mmd" "Open"\n  click B "https://example.com"\n';

  it("warns when a diagram path is not in the workspace", () => {
    const hits = byRule(source, "broken-click", { diagramPaths: ["Welcome.mmd", "Examples/Sequence.mmd"] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("Missing.mmd");
    expect(hits[0]?.message).toMatch(/does not match/);
    expect(hits[0]?.fixes.map((fix) => fix.id)).toEqual(["repair-links"]);
  });

  it("stays quiet for a known path, a web link, and when no workspace list was given", () => {
    expect(byRule(source, "broken-click", { diagramPaths: ["Missing.mmd"] })).toEqual([]);
    expect(byRule(source, "broken-click")).toEqual([]);
    const linked = 'flowchart LR\n  A[One] --> B[Two]\n  click A "./Examples/Sequence.mmd"\n';
    expect(byRule(linked, "broken-click", { diagramPaths: ["Examples/Sequence.mmd"] })).toEqual([]);
  });

  it("resolves nerdgram: and relative paths from the diagram that contains them", () => {
    const sourcePath = "Sites/WAN.mmd";
    const paths = ["WAN.mmd", "Sites/WAN.mmd", "Sites/Atlanta.mmd"];
    const linked =
      'flowchart LR\n  A[Atlanta] --> B[Overview]\n  click A "nerdgram:Sites/Atlanta.mmd"\n  click B "../WAN.mmd"\n';
    expect(byRule(linked, "broken-click", { diagramPaths: paths, sourcePath })).toEqual([]);
    const missing = 'flowchart LR\n  A[Atlanta]\n  click A "Missing.mmd"\n';
    const hits = byRule(missing, "broken-click", { diagramPaths: paths, sourcePath });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toMatch(/does not match/);
    const escape = 'flowchart LR\n  A[Atlanta]\n  click A "../../secret.mmd"\n';
    const escaped = byRule(escape, "broken-click", { diagramPaths: paths, sourcePath })[0];
    expect(escaped?.message).toMatch(/leaves the workspace/);
    expect(escaped?.fixes).toEqual([]);
  });
});

describe("rule switches and samples", () => {
  it("turns a rule off without hiding the others", () => {
    const source = "flowchart LR\n  A[One] --> Ennd\n  C[Orphan]\n";
    const hits = lintDiagram(source, { rules: { "unlabeled-endpoint": false } });
    expect(hits.some((hit) => hit.ruleId === "unlabeled-endpoint")).toBe(false);
    expect(hits.some((hit) => hit.ruleId === "unconnected-node")).toBe(true);
    expect(normalizeLintRules({ "duplicate-id": false, ignored: true, "unused-class": "no" })["unused-class"]).toBe(true);
    expect(normalizeLintRules({ "duplicate-id": false })["duplicate-id"]).toBe(false);
  });

  it("does not flag the sample diagrams", () => {
    const samples = [
      "diagrams/Welcome.mmd",
      "diagrams/NetworkMap.mmd",
      "diagrams/Examples/Sequence.mmd",
      "diagrams/WAN.mmd",
      "diagrams/Sites/Atlanta.mmd",
    ];
    const diagramPaths = samples.map((file) => file.slice("diagrams/".length));
    for (const file of samples) {
      const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
      const sourcePath = file.slice("diagrams/".length);
      expect(lintDiagram(source, { diagramPaths, sourcePath }), file).toEqual([]);
    }
  });

  it("checks a large flowchart without a noticeable delay", () => {
    const lines = ["flowchart LR"];
    for (let index = 0; index < 2000; index += 1) {
      lines.push(`  n${index}[Step ${index}] --> n${index + 1}[Step ${index + 1}]`);
    }
    const started = performance.now();
    const hits = lintDiagram(`${lines.join("\n")}\n`);
    expect(performance.now() - started).toBeLessThan(250);
    expect(hits.filter((hit) => hit.severity === "error")).toEqual([]);
    expect(hits.some((hit) => hit.ruleId === "unconnected-node")).toBe(false);
  });
});

describe("Mermaid database confirmation", () => {
  it("drops an unconnected warning the database shows as connected", () => {
    const source = "flowchart LR\n  A[Start] --> B[End]\n";
    const merged = mergeAstFacts(source, [{
      ruleId: "unconnected-node",
      severity: "warning",
      subject: "A",
      message: "Node \"A\" is defined but never connected to another node.",
      from: 0,
      to: 1,
      line: 1,
      column: 1,
      fixes: [],
    }], {
      kind: "flowchart",
      nodes: [
        { id: "A", label: "Start" },
        { id: "B", label: "End" },
      ],
      edges: [{ from: "A", to: "B" }],
    });
    expect(merged.some((hit) => hit.ruleId === "unconnected-node" && hit.subject === "A")).toBe(false);
  });

  it("adds a node the database sees and the text scan missed", () => {
    const source = "flowchart LR\n  Hidden[Hidden]\n  A[Start] --> B[End]\n";
    const merged = mergeAstFacts(source, [], {
      kind: "flowchart",
      nodes: [
        { id: "Hidden", label: "Hidden" },
        { id: "A", label: "Start" },
        { id: "B", label: "End" },
      ],
      edges: [{ from: "A", to: "B" }],
    });
    expect(merged.map((hit) => hit.subject)).toEqual(["Hidden"]);
    expect(source.slice(merged[0]?.from, merged[0]?.to)).toBe("Hidden");
  });
});
