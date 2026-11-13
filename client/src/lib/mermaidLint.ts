import type { Diagnostic } from "@codemirror/lint";
import { parseDiagram } from "./frontMatter";
import { parseMermaid } from "./mermaidRender";

function lineMessage(err: unknown): { line: number; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const match =
    message.match(/Parse error on line (\d+)/i) ||
    message.match(/\bline\s+(\d+)\b/i);
  const line = match ? Math.max(1, Number(match[1])) : 1;
  return { line, message };
}

function diagnosticAt(code: string, line: number, message: string): Diagnostic {
  const lines = code.split(/\r?\n/);
  const lineIndex = Math.min(Math.max(line - 1, 0), Math.max(lines.length - 1, 0));
  let from = 0;
  for (let i = 0; i < lineIndex; i++) {
    from += (lines[i]?.length ?? 0) + 1;
  }
  const lineText = lines[lineIndex] ?? "";
  const to = from + lineText.length;
  return {
    from,
    to: Math.max(to, from + 1),
    severity: "error",
    message,
  };
}

/** Front matter failures plus mermaid.parse, as CodeMirror line diagnostics. */
export async function lintMermaidDoc(code: string): Promise<Diagnostic[]> {
  if (!code.trim()) return [];
  const diagnostics: Diagnostic[] = [];
  const header = parseDiagram(code);
  if (header.malformed) {
    diagnostics.push(
      diagnosticAt(
        code,
        header.errorLine ?? 1,
        header.error || "The YAML front matter could not be parsed.",
      ),
    );
  }
  try {
    await parseMermaid(code);
  } catch (err) {
    const { line, message } = lineMessage(err);
    if (!header.malformed || !/yaml|front matter/i.test(message)) {
      diagnostics.push(diagnosticAt(code, line, message));
    }
  }
  return diagnostics;
}
