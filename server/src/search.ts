import fs from "node:fs/promises";
import path from "node:path";
import {
  literalLocator,
  matchDiagramSearch,
  parseDiagram,
  searchMatchLabel,
  type DiagramSearchField,
  type DiagramSearchMatch,
  type DiagramTextElement,
  type SearchLocator,
  type SearchScope,
} from "./frontMatter.js";
import * as store from "./fsStore.js";
import { getDataRoot, getMetaPath } from "./paths.js";
import { extractTextElements } from "./textElements.js";
import { atomicWriteJson, httpFail, readJsonFile, rewriteMovedPath } from "./storage.js";

/**
 * Diagram search index.
 *
 * The index is a cache under `.meta/search/index.json`. `buildTree` does not
 * walk `.meta`, and search only considers files from that tree, so trash,
 * thumbnails, locks, versions, and other dot paths are never returned.
 *
 * A missing, stale, or unreadable index falls back to reading the diagram.
 * Entries are keyed by path plus mtime and size:
 * - save, duplicate, and import change the file, so the next search re-reads it
 * - move and rename leave the old path out of the tree and miss on the new path
 * - trash drops the file from the tree; restore puts it back and it is re-read
 * - an external edit that changes mtime or size is re-read
 *
 * The cache is not required for a correct result.
 */

export const MAX_SEARCH_QUERY_CHARS = 200;
export const MAX_SEARCH_REGEX_CHARS = 64;
export const MAX_SEARCH_RESULTS = 40;
export const MAX_SNIPPET_CHARS = 140;

const INDEX_VERSION = 1;

type IndexEntry = {
  mtimeMs: number;
  size: number;
  title: string | null;
  description: string;
  notes: string;
  tags: string[];
  elements: DiagramTextElement[];
};

type IndexFile = {
  version: number;
  entries: Record<string, IndexEntry>;
};

type Cache = {
  root: string;
  entries: Map<string, IndexEntry>;
  loaded: boolean;
  dirty: boolean;
};

let cache: Cache | null = null;
let chain: Promise<void> = Promise.resolve();

export type DiagramSearchHit = {
  path: string;
  name: string;
  title: string | null;
  rank: number;
  field: DiagramSearchField;
  element: string | null;
  label: string;
  line: number | null;
  snippet: string;
  matchStart: number;
  matchLength: number;
};

export type DiagramSearchResponse = {
  query: string;
  truncated: boolean;
  hits: DiagramSearchHit[];
};

function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function indexFile(): string {
  return path.join(getMetaPath(), "search", "index.json");
}

function cacheFor(root: string): Cache {
  if (!cache || cache.root !== root) {
    cache = { root, entries: new Map(), loaded: false, dirty: false };
  }
  return cache;
}

function isPublicDiagram(relativePath: string): boolean {
  if (!relativePath.toLowerCase().endsWith(".mmd")) return false;
  return !relativePath.split("/").some((part) => part.startsWith("."));
}

function isEntry(value: unknown): value is IndexEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as IndexEntry;
  return (
    typeof entry.mtimeMs === "number" &&
    typeof entry.size === "number" &&
    Array.isArray(entry.elements) &&
    Array.isArray(entry.tags)
  );
}

async function ensureLoaded(): Promise<Cache> {
  const current = cacheFor(getDataRoot());
  if (current.loaded) return current;
  const stored = await readJsonFile<IndexFile>(indexFile()).catch(() => null);
  if (stored && stored.version === INDEX_VERSION && stored.entries && typeof stored.entries === "object") {
    for (const [key, value] of Object.entries(stored.entries)) {
      if (!isPublicDiagram(key) || !isEntry(value) || current.entries.has(key)) continue;
      current.entries.set(key, value);
    }
  }
  current.loaded = true;
  return current;
}

async function persist(current: Cache): Promise<void> {
  if (!current.dirty) return;
  const entries: Record<string, IndexEntry> = {};
  for (const [key, value] of current.entries) {
    if (isPublicDiagram(key)) entries[key] = value;
  }
  await atomicWriteJson(indexFile(), { version: INDEX_VERSION, entries } satisfies IndexFile);
  current.dirty = false;
}

function recordFor(content: string, mtimeMs: number, size: number): IndexEntry {
  const parsed = parseDiagram(content);
  return {
    mtimeMs,
    size,
    title: parsed.title,
    description: parsed.description,
    notes: parsed.notes,
    tags: parsed.tags,
    elements: extractTextElements(content, parsed),
  };
}

/** Nested quantifiers such as `(a+)+` are rejected before the engine runs. */
const UNSAFE_NESTED = /(\([^()]*[+*][^()]*\))(?:[+*]|\{\d)/;

export function compileSearchLocator(query: string, regex: boolean): SearchLocator {
  const trimmed = query.trim();
  if (!trimmed) throw httpFail(400, "query is required", "invalid");
  if (trimmed.length > MAX_SEARCH_QUERY_CHARS) {
    throw httpFail(400, "Query is too long", "invalid");
  }
  if (!regex) {
    const locator = literalLocator(trimmed);
    if (!locator) throw httpFail(400, "query is required", "invalid");
    return locator;
  }
  const quantifiers = trimmed.match(/[+*]|\{\d/g) ?? [];
  if (
    trimmed.length > MAX_SEARCH_REGEX_CHARS ||
    UNSAFE_NESTED.test(trimmed) ||
    trimmed.includes("(?") ||
    /\\[1-9]/.test(trimmed) ||
    quantifiers.length > 8
  ) {
    throw httpFail(400, "That regular expression is not allowed", "unsafe_regex");
  }
  let expression: RegExp;
  try {
    expression = new RegExp(trimmed, "i");
  } catch {
    throw httpFail(400, "That regular expression is invalid", "invalid");
  }
  return (text: string) => {
    const haystack = text.length > 4_000 ? text.slice(0, 4_000) : text;
    const match = expression.exec(haystack);
    if (!match || match[0].length === 0) return null;
    return { index: match.index, length: match[0].length };
  };
}

export function snippetAround(
  text: string,
  index: number,
  length: number,
  max = MAX_SNIPPET_CHARS,
): { snippet: string; matchStart: number; matchLength: number } {
  const safeIndex = Math.max(0, Math.min(index, text.length));
  const safeLength = Math.max(0, Math.min(length, text.length - safeIndex));
  if (text.length <= max) {
    return { snippet: text, matchStart: safeIndex, matchLength: safeLength };
  }
  const room = Math.max(0, max - safeLength);
  let start = Math.max(0, safeIndex - Math.floor(room / 2));
  let end = Math.min(text.length, start + max);
  start = Math.max(0, end - max);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return {
    snippet: prefix + text.slice(start, end) + suffix,
    matchStart: prefix.length + (safeIndex - start),
    matchLength: safeLength,
  };
}

function toHit(
  filePath: string,
  name: string,
  title: string | null,
  match: DiagramSearchMatch,
): DiagramSearchHit {
  const snippet = snippetAround(match.text, match.index, match.length);
  return {
    path: filePath,
    name,
    title,
    rank: match.rank,
    field: match.field,
    element: match.elementKind,
    label: searchMatchLabel(match.field, match.elementKind),
    line: match.line,
    snippet: snippet.snippet,
    matchStart: snippet.matchStart,
    matchLength: snippet.matchLength,
  };
}

function flattenFiles(nodes: store.TreeNode[]): store.TreeNode[] {
  const files: store.TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "folder") {
      if (node.children) files.push(...flattenFiles(node.children));
    } else if (isPublicDiagram(node.path)) {
      files.push(node);
    }
  }
  return files;
}

async function entryFor(file: store.TreeNode, current: Cache): Promise<IndexEntry> {
  const cached = current.entries.get(file.path);
  const size = file.size ?? -1;
  if (cached && cached.mtimeMs === file.mtimeMs && cached.size === size) return cached;
  const disk = await store.readFile(file.path);
  const next = recordFor(disk.content, disk.mtimeMs, disk.size);
  current.entries.set(disk.path, next);
  current.dirty = true;
  return next;
}

export function discardSearchCache(): void {
  cache = null;
}

export async function rememberSearchEntry(
  relativePath: string,
  content: string,
  mtimeMs: number,
  size: number,
): Promise<void> {
  if (!isPublicDiagram(relativePath)) return;
  await queued(async () => {
    const current = await ensureLoaded();
    current.entries.set(relativePath, recordFor(content, mtimeMs, size));
    current.dirty = true;
    await persist(current);
  });
}

export async function moveSearchEntries(fromPath: string, toPath: string, isDir: boolean): Promise<void> {
  await queued(async () => {
    const current = await ensureLoaded();
    const moved: [string, IndexEntry][] = [];
    for (const [key, value] of current.entries) {
      const next = rewriteMovedPath(key, fromPath, toPath, isDir);
      if (next === key) continue;
      moved.push([key, value]);
    }
    if (moved.length === 0) return;
    for (const [key] of moved) current.entries.delete(key);
    for (const [key, value] of moved) {
      const next = rewriteMovedPath(key, fromPath, toPath, isDir);
      if (isPublicDiagram(next)) current.entries.set(next, value);
    }
    current.dirty = true;
    await persist(current);
  });
}

export async function removeSearchEntries(fromPath: string, isDir: boolean): Promise<void> {
  await queued(async () => {
    const current = await ensureLoaded();
    let changed = false;
    for (const key of [...current.entries.keys()]) {
      const drop = key === fromPath || (isDir && key.startsWith(`${fromPath}/`));
      if (!drop) continue;
      current.entries.delete(key);
      changed = true;
    }
    if (!changed) return;
    current.dirty = true;
    await persist(current);
  });
}

export async function searchDiagrams(options: {
  q: string;
  namesOnly?: boolean;
  contents?: boolean;
  regex?: boolean;
}): Promise<DiagramSearchResponse> {
  const query = options.q ?? "";
  if (!query.trim()) return { query: "", hits: [], truncated: false };
  const scope: SearchScope = options.namesOnly ? "names" : options.contents === false ? "meta" : "all";
  const locator = compileSearchLocator(query, options.regex === true);

  return queued(async () => {
    const current = await ensureLoaded();
    const files = flattenFiles(await store.buildTree());
    const live = new Set(files.map((file) => file.path));
    for (const key of [...current.entries.keys()]) {
      if (!live.has(key)) {
        current.entries.delete(key);
        current.dirty = true;
      }
    }

    const hits: DiagramSearchHit[] = [];
    for (const file of files) {
      const entry = await entryFor(file, current);
      const match = matchDiagramSearch(
        {
          path: file.path,
          title: entry.title,
          description: entry.description,
          notes: entry.notes,
          tags: entry.tags,
          elements: entry.elements,
        },
        query,
        locator,
        scope,
      );
      if (!match) continue;
      hits.push(toHit(file.path, file.name, entry.title, match));
    }

    hits.sort(
      (a, b) => a.rank - b.rank || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0),
    );
    const truncated = hits.length > MAX_SEARCH_RESULTS;
    await persist(current);
    return {
      query: query.trim(),
      truncated,
      hits: truncated ? hits.slice(0, MAX_SEARCH_RESULTS) : hits,
    };
  });
}
