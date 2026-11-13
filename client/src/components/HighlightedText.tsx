/**
 * Highlight a match inside plain text. The file text is a React child, so
 * characters such as `<` stay text and are not parsed as HTML.
 */
export function HighlightedText({
  text,
  start,
  length,
}: {
  text: string;
  start: number;
  length: number;
}) {
  const safeStart = Number.isFinite(start) ? Math.max(0, Math.min(text.length, Math.floor(start))) : 0;
  const safeLength = Number.isFinite(length)
    ? Math.max(0, Math.min(text.length - safeStart, Math.floor(length)))
    : 0;
  if (safeLength <= 0) return text;
  return (
    <>
      {text.slice(0, safeStart)}
      <mark>{text.slice(safeStart, safeStart + safeLength)}</mark>
      {text.slice(safeStart + safeLength)}
    </>
  );
}
