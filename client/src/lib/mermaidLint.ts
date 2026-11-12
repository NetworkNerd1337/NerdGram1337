import type { Diagnostic } from "@codemirror/lint";
import { parseMermaid } from "./mermaidRender";

function lineMessage(err: unknown): { line: number; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const match =
    message.match(/Parse error on line (\d+)/i) ||
    message.match(/\bline\s+(\d+)\b/i);
  const line = match ? Math.max(1, Number(match[1])) : 1;
  return { line, message };
}

/** Run mermaid.parse and map failures to CodeMirror line diagnostics. */
export async function lintMermaidDoc(code: string): Promise<Diagnostic[]> {
  if (!code.trim()) return [];
  try {
    await parseMermaid(code);
    return [];
  } catch (err) {
    const { line, message } = lineMessage(err);
    const lines = code.split(/\r?\n/);
    const lineIndex = Math.min(Math.max(line - 1, 0), Math.max(lines.length - 1, 0));
    // Convert line number to document offsets
    let from = 0;
    for (let i = 0; i < lineIndex; i++) {
      from += (lines[i]?.length ?? 0) + 1;
    }
    const lineText = lines[lineIndex] ?? "";
    const to = from + lineText.length;
    return [
      {
        from,
        to: Math.max(to, from + 1),
        severity: "error",
        message,
      },
    ];
  }
}
