import mermaid from "mermaid";
import { lintDiagram, type LintDiagnostic, type LintOptions } from "./diagramLint.js";
import { isMermaidEnvironmentError, locateParseError } from "./parseError.js";

/**
 * Syntax errors from Mermaid's parser, as error diagnostics.
 * A clean diagram still throws in Node once parsing is finished, because
 * Mermaid then touches DOMPurify. That is not a syntax error.
 */
export async function mermaidSyntaxDiagnostic(source: string): Promise<LintDiagnostic | null> {
  if (!source.trim()) return null;
  try {
    await mermaid.parse(source);
    return null;
  } catch (error) {
    if (isMermaidEnvironmentError(error)) return null;
    const message = error instanceof Error ? error.message : String(error);
    const hash =
      error && typeof error === "object" && "hash" in error
        ? (error as { hash?: { loc?: { first_line?: number } } }).hash
        : undefined;
    const hasLocation = typeof hash?.loc?.first_line === "number" && hash.loc.first_line > 0;
    if (!hasLocation && !/parse error on line/i.test(message)) return null;
    const located = locateParseError(error, source);
    return {
      ruleId: "parse",
      severity: "error",
      message: located.message,
      from: located.from,
      to: located.to,
      line: located.line,
      column: located.column,
      fixes: [],
    };
  }
}

/** Text checks plus a Mermaid syntax error, when the diagram does not parse. */
export async function lintDiagramSource(source: string, options: LintOptions = {}): Promise<LintDiagnostic[]> {
  const diagnostics = lintDiagram(source, options);
  const syntax = await mermaidSyntaxDiagnostic(source);
  if (!syntax) return diagnostics;
  return [...diagnostics, syntax].sort(
    (a, b) => a.from - b.from || a.line - b.line || String(a.ruleId).localeCompare(String(b.ruleId)),
  );
}
