import { describe, expect, it } from "vitest";
import { mermaidSyntaxDiagnostic } from "../src/mermaidSyntax.js";
import { locateParseError } from "../src/parseError.js";

describe("parse error lines", () => {
  it("uses the parser location instead of the caret line in the message", () => {
    const source = "flowchart LR\n  A -->\n";
    const located = locateParseError(
      {
        message: "Parse error on line 4:\nExpecting 'NODE_STRING', got 'EOF'",
        hash: { token: "EOF", loc: { first_line: 2, last_line: 2, first_column: 3, last_column: 8 } },
      },
      source,
    );
    expect(located.line).toBe(2);
    expect(located.column).toBe(4);
    expect(source.slice(located.from, located.to)).toContain("-->");
  });

  it("adds the front matter lines Mermaid strips before parsing", async () => {
    const source = "---\ntitle: T\n---\nflowchart LR\n  A -->\n";
    const diagnostic = await mermaidSyntaxDiagnostic(source);
    expect(diagnostic?.ruleId).toBe("parse");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.line).toBe(5);
    expect(source.split("\n")[diagnostic!.line - 1]).toContain("-->");
  });

  it("does not report a syntax error for a diagram Mermaid can parse", async () => {
    const diagnostic = await mermaidSyntaxDiagnostic("flowchart LR\n  A[One] --> B[Two]\n");
    expect(diagnostic).toBeNull();
  });
});
