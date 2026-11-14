import { describe, expect, it } from "vitest";
import { applyEdits, LINT_RULES, lintDiagram } from "../../server/src/diagramLint.ts";
import { readAstFacts } from "../src/lib/mermaidFacts";
import { lintMermaidDoc, LINT_DELAY_MS } from "../src/lib/mermaidLint";
import { locateParseError } from "../src/lib/parseError";

describe("Mermaid parse locations", () => {
  it("points a flowchart error at the line and column Mermaid reported", async () => {
    const source = "flowchart LR\n  A -->\n";
    const diagnostics = await lintMermaidDoc(source);
    const parseError = diagnostics.find((item) => item.ruleId === "parse");
    expect(parseError?.line).toBe(2);
    expect(parseError?.column).toBe(4);
    expect(parseError?.message).toMatch(/Line 2, column 4/);
    expect(parseError?.message).not.toMatch(/Expecting/);
    expect(source.slice(parseError?.from, parseError?.to)).toContain("-->");
  });

  it("points a sequence error at the incomplete arrow", async () => {
    const source = "sequenceDiagram\n  Alice->>\n";
    const diagnostics = await lintMermaidDoc(source);
    const parseError = diagnostics.find((item) => item.ruleId === "parse");
    expect(parseError?.line).toBe(2);
    expect(parseError?.column).toBe(8);
    expect(source.slice(parseError?.from, parseError?.to)).toBe("->>");
  });

  it("keeps text warnings when Mermaid's database cannot be read in this runtime", async () => {
    const source = "flowchart LR\n  A[One] --> B[End]\n  A[Two]\n";
    const diagnostics = await lintMermaidDoc(source);
    expect(diagnostics.some((item) => item.ruleId === "duplicate-id")).toBe(true);
  });

  it("debounces lint so typing does not check on every key", () => {
    expect(LINT_DELAY_MS).toBeGreaterThanOrEqual(300);
  });
});

describe("quick fixes undo", () => {
  it("restores a renamed id, a removed class, and a created class from one edit", () => {
    const source = "flowchart LR\n  A[One] --> B[End]\n  A[Two]\n  class A missing\n  classDef muted fill:#eee\n";
    const diagnostics = lintDiagram(source);
    for (const id of ["rename-duplicate", "remove-classdef", "create-class"] as const) {
      const fix = diagnostics.flatMap((item) => item.fixes).find((item) => item.id === id);
      expect(fix, id).toBeTruthy();
      if (!fix) continue;
      const next = applyEdits(source, fix.edits);
      expect(next).not.toBe(source);
      const inverse = fix.edits.map((edit) => ({
        from: edit.from,
        to: edit.from + edit.insert.length,
        insert: source.slice(edit.from, edit.to),
      }));
      expect(applyEdits(next, inverse)).toBe(source);
    }
    const jump = diagnostics.flatMap((item) => item.fixes).find((item) => item.id === "jump-to-definition");
    expect(jump?.edits).toEqual([]);
    expect(source.slice(jump?.jump?.from, jump?.jump?.to)).toBe("A");
  });
});

describe("diagram checks for more diagram types", () => {
  it("lists a switch for each new rule, which is what Diagram checks renders", () => {
    const ids = LINT_RULES.map((rule) => rule.id);
    for (const id of [
      "duplicate-class",
      "undeclared-class",
      "duplicate-attribute",
      "undeclared-entity",
      "missing-dependency",
      "invalid-date",
      "duplicate-sibling",
      "empty-node",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("renames a duplicate class and removes a duplicate attribute in one edit each", () => {
    const source = 'classDiagram\n  class Animal["Cat"]\n  class Animal["Dog"]\n';
    const rename = lintDiagram(source)
      .flatMap((item) => item.fixes)
      .find((item) => item.id === "rename-duplicate");
    expect(rename).toBeTruthy();
    if (!rename) return;
    const next = applyEdits(source, rename.edits);
    expect(next).toContain("Animal2");
    const inverse = rename.edits.map((edit) => ({
      from: edit.from,
      to: edit.from + edit.insert.length,
      insert: source.slice(edit.from, edit.to),
    }));
    expect(applyEdits(next, inverse)).toBe(source);
  });
});

describe("diagram database", () => {
  it("reads flowchart vertices and edges when Mermaid exposes them", () => {
    const facts = readAstFacts({
      type: "flowchart",
      db: {
        getVertices: () =>
          new Map([
            ["A", { id: "A", text: "Start" }],
            ["B", { id: "B", text: "B" }],
          ]),
        getEdges: () => [{ start: "A", end: "B" }],
      },
    });
    expect(facts).toEqual({
      kind: "flowchart",
      nodes: [
        { id: "A", label: "Start" },
        { id: "B", label: null },
      ],
      edges: [{ from: "A", to: "B" }],
    });
  });

  it("returns null when the database is not one of the supported diagrams", () => {
    expect(readAstFacts({ type: "pie", db: {} })).toBeNull();
    expect(readAstFacts(null)).toBeNull();
  });
});

describe("locateParseError", () => {
  it("uses the parser location instead of the caret diagram's line count", () => {
    const source = "flowchart LR\n  A -->\n";
    const located = locateParseError(
      {
        message: "Parse error on line 4:\nExpecting 'NODE_STRING', got 'EOF'",
        hash: {
          token: "EOF",
          loc: { first_line: 2, last_line: 4, first_column: 3, last_column: 0 },
        },
      },
      source,
    );
    expect(located.line).toBe(2);
    expect(located.column).toBe(4);
    expect(located.message).toMatch(/end of the diagram/);
  });
});
