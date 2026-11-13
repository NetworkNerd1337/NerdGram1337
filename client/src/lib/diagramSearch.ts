import { api } from "../api";
import type { DiagramSearchResponse } from "../types";

/**
 * Shared diagram search. The dashboard field and the command palette both
 * call this. It debounces at the call site and does not read diagram files.
 */
export function searchDiagrams(
  query: string,
  options: { namesOnly?: boolean; signal?: AbortSignal } = {},
): Promise<DiagramSearchResponse> {
  return api.search(query, options);
}

/** Editor URL for a hit. `line` scrolls to the match; `find` opens the find panel. */
export function editorHref(path: string, line: number | null | undefined, find: string): string {
  const params = new URLSearchParams();
  if (line != null && line > 0) params.set("line", String(line));
  const needle = find.trim();
  if (needle) params.set("find", needle);
  const qs = params.toString();
  return qs ? `/edit/${path}?${qs}` : `/edit/${path}`;
}
