import { matchFrontMatter } from "./frontMatter.js";

/**
 * Turn a Mermaid parse failure into a line, a column, and a short sentence.
 * Mermaid's own message includes a caret diagram and a list of token names.
 * That caret count is not the line in the file. `hash.loc` is the location
 * the parser stopped at, in the text Mermaid parsed after it removed the
 * YAML front matter: `first_line` is 1-based and `first_column` is 0-based.
 */

export type ParseLocation = {
  line: number;
  column: number;
  from: number;
  to: number;
  message: string;
};

type HashLoc = {
  first_line?: number;
  last_line?: number;
  first_column?: number;
  last_column?: number;
};

export function locateParseError(error: unknown, source: string): ParseLocation {
  const hash = readHash(error);
  const loc = hash?.loc;
  const shift = frontMatterLineShift(source);
  if (loc && typeof loc.first_line === "number" && loc.first_line > 0) {
    const line = loc.first_line + shift;
    const column = typeof loc.first_column === "number" && loc.first_column >= 0 ? loc.first_column + 1 : 1;
    const span = spanFor(source, line, column, loc);
    return { ...span, message: plainMessage(line, column, hash?.token) };
  }

  const message = error instanceof Error ? error.message : String(error);
  const lineMatch = message.match(/Parse error on line (\d+)/i) ?? message.match(/\bline\s+(\d+)\b/i);
  const line = (lineMatch ? Math.max(1, Number(lineMatch[1])) : 1) + shift;
  const column = caretColumn(message, source, line);
  const span = spanFor(source, line, column, null);
  return { ...span, message: plainMessage(line, column, undefined) };
}

export function isMermaidEnvironmentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /DOMPurify|document is not defined|window is not defined|CSSStyleSheet is not defined/i.test(message);
}

/** Lines Mermaid removes before the parser runs. Comment lines stay, as blank lines. */
export function frontMatterLineShift(source: string): number {
  const front = matchFrontMatter(source);
  if (!front || front.length <= 0) return 0;
  const prefix = source.slice(0, front.length);
  let lines = 0;
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] === "\n") lines += 1;
  }
  return lines;
}

function readHash(error: unknown): { loc?: HashLoc; token?: string } | null {
  if (!error || typeof error !== "object" || !("hash" in error)) return null;
  const hash = (error as { hash?: unknown }).hash;
  if (!hash || typeof hash !== "object") return null;
  const record = hash as { loc?: HashLoc; token?: unknown };
  return { loc: record.loc, token: typeof record.token === "string" ? record.token : undefined };
}

function spanFor(source: string, line: number, column: number, loc: HashLoc | null): Omit<ParseLocation, "message"> {
  const lines = source.split(/\n/);
  const index = Math.min(Math.max(line - 1, 0), Math.max(lines.length - 1, 0));
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) lineStart += (lines[i]?.length ?? 0) + 1;
  const lineText = (lines[index] ?? "").replace(/\r$/, "");
  const from = lineStart + Math.min(Math.max(column - 1, 0), lineText.length);
  let to = lineStart + lineText.length;
  if (
    loc &&
    loc.last_line === loc.first_line &&
    typeof loc.last_column === "number" &&
    typeof loc.first_column === "number" &&
    loc.last_column > loc.first_column
  ) {
    to = lineStart + Math.min(loc.last_column, lineText.length);
  }
  if (to <= from) to = Math.min(lineStart + lineText.length, from + 1);
  if (to <= from) to = from + 1;
  return { line: index + 1, column: from - lineStart + 1, from, to };
}

function caretColumn(message: string, source: string, line: number): number {
  const lines = message.split(/\n/);
  const caret = lines.find((item) => /^\s*-+\^/.test(item) || /^\s*\^+$/.test(item));
  if (!caret) return 1;
  const mark = caret.lastIndexOf("^");
  if (mark < 0) return 1;
  const sourceLine = source.split(/\n/)[line - 1] ?? "";
  if (sourceLine.length <= mark) return mark + 1;
  return 1;
}

function plainMessage(line: number, column: number, token: string | undefined): string {
  const where = `Line ${line}, column ${column}`;
  const found = foundPhrase(token);
  if (!found) return `${where}: this isn't valid Mermaid.`;
  return `${where}: this isn't valid Mermaid. The parser stopped at ${found}.`;
}

function foundPhrase(token: string | undefined): string | null {
  if (!token) return null;
  const name = token.replace(/^'+|'+$/g, "").toUpperCase();
  if (name === "EOF") return "the end of the diagram";
  if (name === "NEWLINE" || name === "NL") return "the end of the line";
  if (name === "INVALID") return "text Mermaid doesn't accept here";
  return null;
}
