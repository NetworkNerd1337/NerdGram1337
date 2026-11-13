const COMMENTED = /^(\s*)%%[ \t]?/;

export function lineIsCommented(line: string): boolean {
  return /^\s*%%/.test(line);
}

export function commentLine(line: string): string {
  if (lineIsCommented(line)) return line;
  const match = /^(\s*)(.*)$/.exec(line);
  if (!match) return `%% ${line}`;
  return `${match[1]}%% ${match[2]}`;
}

export function uncommentLine(line: string): string {
  return line.replace(COMMENTED, "$1");
}

/** Comment or uncomment every line. A mixed selection adds comments. */
export function commentEdit(lines: string[]): string[] {
  const meaningful = lines.filter((line) => line.trim() !== "");
  const remove = meaningful.length > 0 && meaningful.every(lineIsCommented);
  return lines.map((line) => {
    if (remove) return lineIsCommented(line) ? uncommentLine(line) : line;
    if (lineIsCommented(line)) return line;
    return commentLine(line);
  });
}

/**
 * Toggle `%%` comments on 1-based line numbers.
 * Lines that are not listed stay byte-for-byte the same, including CRLF.
 */
export function toggleCommentLines(text: string, lineNumbers: number[]): string {
  if (lineNumbers.length === 0) return text;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const selected = [...new Set(lineNumbers)]
    .filter((number) => number >= 1 && number <= lines.length)
    .sort((a, b) => a - b);
  if (selected.length === 0) return text;
  const edited = commentEdit(selected.map((number) => lines[number - 1] ?? ""));
  selected.forEach((number, index) => {
    lines[number - 1] = edited[index] ?? "";
  });
  return lines.join(newline);
}
