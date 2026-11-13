import { Document, isMap, isSeq, parseDocument } from "yaml";

/**
 * Mermaid-native YAML front matter for `.mmd` files.
 *
 * Mermaid 12 reads `title`, `displayMode`, and `config` from a leading
 * `---` block and ignores every other top-level key. Description, notes,
 * and tags live under `nerdgram:` so they stay in the file. There is no
 * second theme or config format.
 *
 * Import this module for later work instead of parsing headers again:
 * `thumbnailCacheKey` (#10), `diagramSearchRank` (#13), and the `title` /
 * `theme` fields (#18 presentation, #17 templates).
 */

/** Themes registered by mermaid 12.3 (`themes_default`). */
export const MERMAID_THEMES = [
  "default",
  "neutral",
  "dark",
  "forest",
  "base",
  "neo",
  "neo-dark",
  "redux",
  "redux-dark",
  "redux-color",
  "redux-dark-color",
] as const;

export const MERMAID_LOOKS = ["classic", "handDrawn", "neo"] as const;

export const MERMAID_LAYOUTS = ["elk", "dagre"] as const;

export const FLOWCHART_CURVES = [
  "basis",
  "bumpX",
  "bumpY",
  "cardinal",
  "catmullRom",
  "linear",
  "monotoneX",
  "monotoneY",
  "natural",
  "step",
  "stepAfter",
  "stepBefore",
] as const;

export const ELK_NODE_PLACEMENTS = [
  "SIMPLE",
  "NETWORK_SIMPLEX",
  "LINEAR_SEGMENTS",
  "BRANDES_KOEPF",
] as const;

/** App fallback when a file does not set `config.theme`. Matches the editor and thumbnails. */
export const FALLBACK_THEME = "dark";

/** Same family the renderer already passed to `mermaid.initialize`. */
export const DEFAULT_FONT_FAMILY = '"IBM Plex Sans", system-ui, sans-serif';

const NERDGRAM = "nerdgram";

/** Keys Mermaid refuses from front matter. Never offer these in the UI. */
const SECURE_CONFIG_KEYS = new Set([
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
]);

const whitespace = /\s/;

export type Scalar = string | number | boolean | null;

export type FrontMatterMatch = {
  /** Horizontal indent of the opening fence. Mermaid requires the closer to match it. */
  indent: string;
  /** YAML between the fences, still indented when the fence was indented. */
  body: string;
  /** Length of the whole match, including the newline that closes the fence. */
  length: number;
};

export type DiagramPatch = {
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  theme?: string | null;
  look?: string | null;
  layout?: string | null;
  displayMode?: string | null;
  fontFamily?: string | null;
  handDrawnSeed?: number | null;
  themeCSS?: string | null;
  /** `null` or `""` deletes that variable. Absent keys are left alone. */
  themeVariables?: Record<string, Scalar | undefined> | null;
  /** `null` or `""` deletes that ELK option. Absent keys are left alone. */
  elk?: Record<string, Scalar | undefined> | null;
  flowchartCurve?: string | null;
};

export type DiagramDocument = {
  hasFrontMatter: boolean;
  malformed: boolean;
  /** First line of the parser error. Empty when the header is readable. */
  error: string | null;
  /** 1-based line of `error` in the file, when the header itself failed. */
  errorLine: number | null;
  /** Diagram source after the front matter block. The whole file when there is no block. */
  body: string;
  title: string | null;
  description: string;
  notes: string;
  tags: string[];
  theme: string | null;
  look: string | null;
  layout: string | null;
  displayMode: string | null;
  fontFamily: string | null;
  handDrawnSeed: number | null;
  themeCSS: string | null;
  themeVariables: Record<string, Scalar>;
  flowchartCurve: string | null;
  elk: Record<string, Scalar>;
  /** Parsed `config` object. Empty when the header failed or was absent. */
  config: Record<string, unknown>;
  /**
   * Merged `%%{init}%%` / `%%{initialize}%%` objects from the diagram body.
   * Later directives win. Empty when one of them cannot be parsed, matching
   * Mermaid, which drops the set if `JSON.parse` throws.
   */
  initConfig: Record<string, unknown>;
  hasLegacyInit: boolean;
  initError: string | null;
  /**
   * Changes when title, theme, look, layout, or the diagram body changes.
   * Thumbnail caches (#10) should use this rather than the graph body alone.
   */
  cacheKey: string;
};

export type ApplyResult =
  | { ok: true; source: string }
  | { ok: false; error: string; source: string };

export type MigrateResult =
  | { ok: true; source: string; migrated: boolean }
  | { ok: false; error: string; source: string };

type InitHit = {
  start: number;
  end: number;
  value: Record<string, unknown> | null;
  error: string | null;
};

function isLineBreak(char: string | undefined): boolean {
  return char === "\n" || char === "\r";
}

function lastLineBreakInWhitespaceRun(text: string, from: number): number {
  let index = -1;
  for (let i = from; i < text.length && whitespace.test(text[i] ?? ""); i += 1) {
    if (isLineBreak(text[i])) index = i;
  }
  return index;
}

/**
 * Locate a leading front matter block the way Mermaid 12.3 does.
 * A file that does not start with `---` (optional indent) has no block,
 * even if a later line is `---`.
 */
export function matchFrontMatter(text: string): FrontMatterMatch | null {
  let cursor = 0;
  while (cursor < text.length && whitespace.test(text[cursor] ?? "") && !isLineBreak(text[cursor])) {
    cursor += 1;
  }
  const indent = text.slice(0, cursor);
  if (!text.startsWith("---", cursor)) return null;

  const openingEnds: number[] = [];
  for (let i = cursor + 3; i < text.length && whitespace.test(text[i] ?? ""); i += 1) {
    if (isLineBreak(text[i])) openingEnds.push(i);
  }
  if (openingEnds.length === 0) return null;

  const closingFence = `${indent}---`;
  const closingEnd = (index: number): number =>
    isLineBreak(text[index]) && text.startsWith(closingFence, index + 1)
      ? lastLineBreakInWhitespaceRun(text, index + 1 + closingFence.length)
      : -1;

  const earliestBodyStart = (openingEnds[0] ?? 0) + 1;
  let lastClosingFence = -1;
  for (let i = earliestBodyStart; i < text.length; i += 1) {
    if (closingEnd(i) !== -1) lastClosingFence = i;
  }
  if (lastClosingFence === -1) return null;

  let openingEnd = openingEnds[0] ?? 0;
  for (const candidate of openingEnds) {
    if (candidate < lastClosingFence) openingEnd = candidate;
  }

  const bodyStart = openingEnd + 1;
  for (let i = bodyStart; i <= lastClosingFence; i += 1) {
    const matchEnd = closingEnd(i);
    if (matchEnd !== -1) {
      return { indent, body: text.slice(bodyStart, i), length: matchEnd + 1 };
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const previous = out[key];
    if (isPlainObject(previous) && isPlainObject(value)) {
      out[key] = deepMerge(previous, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const item of value) {
    const text = asString(item)?.trim();
    if (text && !tags.includes(text)) tags.push(text);
  }
  return tags;
}

function scalarRecord(value: unknown): Record<string, Scalar> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, Scalar> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      item == null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      out[key] = item as Scalar;
    }
  }
  return out;
}

function yamlText(match: FrontMatterMatch): string {
  const normalized = match.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!match.indent) return normalized;
  return normalized
    .split("\n")
    .map((line) => (line.startsWith(match.indent) ? line.slice(match.indent.length) : line))
    .join("\n");
}

function firstErrorLine(error: { linePos?: readonly { line: number }[] | null }): number {
  const line = error.linePos?.[0]?.line;
  return typeof line === "number" && line > 0 ? line : 1;
}

function parseInitArgs(raw: string): { value: Record<string, unknown> | null; error: string | null } {
  if (!raw) return { value: {}, error: null };
  const attempts = raw.includes("'") ? [raw, raw.replace(/'/g, '"')] : [raw];
  let last = "The init directive is not JSON.";
  for (const attempt of attempts) {
    try {
      const value = JSON.parse(attempt) as unknown;
      if (!isPlainObject(value)) {
        return { value: null, error: "The init directive must be a JSON object." };
      }
      return { value, error: null };
    } catch (err) {
      last = err instanceof Error ? err.message : last;
    }
  }
  return { value: null, error: last };
}

function findInitDirectives(text: string): InitHit[] {
  const hits: InitHit[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("%%{", cursor);
    if (start === -1) break;
    let index = start + 3;
    while (index < text.length && whitespace.test(text[index] ?? "")) index += 1;
    const word = /^[A-Za-z]+/.exec(text.slice(index));
    if (!word) {
      cursor = start + 3;
      continue;
    }
    index += word[0].length;
    while (index < text.length && whitespace.test(text[index] ?? "")) index += 1;
    if (text[index] === ":") {
      index += 1;
      while (index < text.length && whitespace.test(text[index] ?? "")) index += 1;
    }
    const close = text.indexOf("}%%", index);
    if (close === -1) break;
    const end = close + 3;
    const name = word[0].toLowerCase();
    if (name === "init" || name === "initialize") {
      const parsed = parseInitArgs(text.slice(index, close).trim());
      hits.push({ start, end, value: parsed.value, error: parsed.error });
    }
    cursor = end;
  }
  return hits;
}

function emptyDocument(): DiagramDocument {
  return {
    hasFrontMatter: false,
    malformed: false,
    error: null,
    errorLine: null,
    body: "",
    title: null,
    description: "",
    notes: "",
    tags: [],
    theme: null,
    look: null,
    layout: null,
    displayMode: null,
    fontFamily: null,
    handDrawnSeed: null,
    themeCSS: null,
    themeVariables: {},
    flowchartCurve: null,
    elk: {},
    config: {},
    initConfig: {},
    hasLegacyInit: false,
    initError: null,
    cacheKey: "",
  };
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hash the whole diagram text (front matter header and body, including any
 * `%%{init}%%` directives). A variables-only, font, seed, or CSS edit has to
 * miss the thumbnail cache the same way a theme edit does. Notes and tags
 * are in that header, so they miss too; that is cheaper than serving a stale
 * picture.
 */
function cacheKeyFor(source: string): string {
  return `${fnv1a(source)}:${source.length}`;
}

function readConfig(data: Record<string, unknown>): {
  config: Record<string, unknown>;
  theme: string | null;
  look: string | null;
  layout: string | null;
  fontFamily: string | null;
  handDrawnSeed: number | null;
  themeCSS: string | null;
  themeVariables: Record<string, Scalar>;
  flowchartCurve: string | null;
  elk: Record<string, Scalar>;
} {
  const config = isPlainObject(data.config) ? data.config : {};
  const flowchart = isPlainObject(config.flowchart) ? config.flowchart : {};
  const seed = config.handDrawnSeed;
  return {
    config,
    theme: asString(config.theme),
    look: asString(config.look),
    layout: asString(config.layout),
    fontFamily: asString(config.fontFamily),
    handDrawnSeed: typeof seed === "number" && Number.isFinite(seed) ? seed : null,
    themeCSS: asString(config.themeCSS),
    themeVariables: scalarRecord(config.themeVariables),
    flowchartCurve: asString(flowchart.curve),
    elk: scalarRecord(config.elk),
  };
}

function withInits(document: DiagramDocument, body: string, source: string): DiagramDocument {
  const hits = findInitDirectives(body);
  const failed = hits.find((hit) => hit.error);
  let initConfig: Record<string, unknown> = {};
  if (!failed) {
    for (const hit of hits) {
      if (hit.value) initConfig = deepMerge(initConfig, hit.value);
    }
  }
  const next: DiagramDocument = {
    ...document,
    body,
    hasLegacyInit: hits.length > 0,
    initError: failed?.error ?? null,
    initConfig,
  };
  next.cacheKey = cacheKeyFor(source);
  return next;
}

/** Parse a diagram file. Does not modify the text. */
export function parseDiagram(source: string): DiagramDocument {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const match = matchFrontMatter(text);
  if (!match) return withInits({ ...emptyDocument(), body: text }, text, text);

  const doc = parseDocument(yamlText(match), { schema: "core", prettyErrors: false });
  const body = text.slice(match.length);
  if (doc.errors.length > 0) {
    const error = doc.errors[0];
    const message = error?.message.split("\n")[0]?.trim() || "The YAML front matter could not be parsed.";
    return withInits(
      {
        ...emptyDocument(),
        hasFrontMatter: true,
        malformed: true,
        error: message,
        errorLine: error ? firstErrorLine(error) : 1,
        body,
      },
      body,
      text,
    );
  }

  const raw = doc.toJS() as unknown;
  if (raw != null && !isPlainObject(raw)) {
    return withInits(
      {
        ...emptyDocument(),
        hasFrontMatter: true,
        malformed: true,
        error: "Front matter must be a YAML mapping of keys.",
        errorLine: 1,
        body,
      },
      body,
      text,
    );
  }

  const data = raw ?? {};
  const nerdgram = isPlainObject(data[NERDGRAM]) ? data[NERDGRAM] : {};
  const config = readConfig(data);
  const titleText = asString(data.title);
  const title = titleText && titleText.trim() ? titleText : null;
  const parsed: DiagramDocument = {
    ...emptyDocument(),
    hasFrontMatter: true,
    body,
    title,
    description: asString(nerdgram.description) ?? "",
    notes: asString(nerdgram.notes) ?? "",
    tags: asTags(nerdgram.tags),
    displayMode: asString(data.displayMode),
    ...config,
  };
  return withInits(parsed, body, text);
}

export function thumbnailCacheKey(source: string): string {
  return parseDiagram(source).cacheKey;
}

/** Mermaid config-section name for the first real diagram line, when we know it. */
export function diagramConfigKey(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    const word = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (word === "graph" || word === "flowchart" || word === "flowchart-elk") return "flowchart";
    if (word === "sequencediagram") return "sequence";
    if (word === "classdiagram") return "class";
    if (word === "statediagram" || word === "statediagram-v2") return "state";
    if (word === "erdiagram") return "er";
    if (word === "gantt") return "gantt";
    if (word === "journey") return "journey";
    if (word === "pie") return "pie";
    if (word === "mindmap") return "mindmap";
    if (word === "timeline") return "timeline";
    if (word === "gitgraph") return "gitGraph";
    if (word === "c4context" || word === "c4container" || word === "c4component") return "c4";
    if (word === "quadrantchart") return "quadrantChart";
    if (word === "requirementdiagram") return "requirement";
    if (word === "xychart-beta" || word === "xychart") return "xyChart";
    if (word === "block-beta" || word === "block") return "block";
    if (word === "sankey-beta" || word === "sankey") return "sankey";
    if (word === "packet-beta" || word === "packet") return "packet";
    if (word === "kanban") return "kanban";
    if (word === "architecture-beta" || word === "architecture") return "architecture";
    return null;
  }
  return null;
}

function appearance(
  config: Record<string, unknown>,
  body: string,
  key: string,
): string | undefined {
  const sectionName = diagramConfigKey(body);
  const section =
    sectionName && isPlainObject(config[sectionName]) ? config[sectionName] : null;
  const scoped = section ? asString(section[key]) : null;
  if (scoped) return scoped;
  return asString(config[key]) ?? undefined;
}

/**
 * Config passed to `mermaid.initialize` before render.
 * File `config` wins over the fallback theme. A diagram-type block wins over
 * the root `theme` / `look` / `layout`, which is Mermaid's own order.
 * Secure keys from the file are dropped. Files with no config keep the
 * historical initialize values: loose security, the fallback theme, and the
 * IBM Plex font.
 */
export function diagramInitConfig(
  source: string,
  fallbackTheme: string = FALLBACK_THEME,
): Record<string, unknown> {
  const parsed = parseDiagram(source);
  const effective = parsed.malformed ? {} : deepMerge(parsed.config, parsed.initConfig);
  const init: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(effective)) {
    if (SECURE_CONFIG_KEYS.has(key) || key.startsWith("__")) continue;
    init[key] = value;
  }
  init.startOnLoad = false;
  init.securityLevel = "loose";
  // A bad diagram must not append Mermaid's error SVG to document.body.
  init.suppressErrorRendering = true;
  init.theme = appearance(effective, parsed.body, "theme") ?? fallbackTheme;
  const look = appearance(effective, parsed.body, "look");
  if (look) init.look = look;
  else delete init.look;
  const layout = appearance(effective, parsed.body, "layout");
  if (layout) init.layout = layout;
  else delete init.layout;
  const fontFamily = asString(effective.fontFamily);
  init.fontFamily = fontFamily || DEFAULT_FONT_FAMILY;
  return init;
}

function newlineOf(source: string): "\n" | "\r\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function isEmptyCollection(node: unknown): boolean {
  if (isMap(node) || isSeq(node)) return node.items.length === 0;
  return false;
}

function pruneEmpty(doc: Document, path: string[]): void {
  if (path.length === 0) return;
  const node = doc.getIn(path);
  if (!isEmptyCollection(node)) return;
  doc.deleteIn(path);
  pruneEmpty(doc, path.slice(0, -1));
}

function setOrClear(doc: Document, path: string[], value: unknown): void {
  const clear =
    value == null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0);
  if (clear) doc.deleteIn(path);
  else doc.setIn(path, value);
  pruneEmpty(doc, path.slice(0, -1));
}

function loadDocument(yaml: string): { doc: Document; error: string | null } {
  const doc = parseDocument(yaml, { schema: "core", prettyErrors: false });
  if (doc.errors.length > 0) {
    const message =
      doc.errors[0]?.message.split("\n")[0]?.trim() || "The YAML front matter could not be parsed.";
    return { doc, error: message };
  }
  const raw = doc.toJS() as unknown;
  if (raw != null && !isPlainObject(raw)) {
    return { doc, error: "Front matter must be a YAML mapping of keys." };
  }
  if (!isMap(doc.contents)) {
    const blank = new Document({}, { schema: "core" });
    (doc as { contents: unknown }).contents = blank.contents;
  }
  return { doc, error: null };
}

function compose(source: string, body: string, doc: Document | null): string {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const newline = newlineOf(source);
  if (!doc || !isMap(doc.contents) || doc.contents.items.length === 0) {
    return bom + body;
  }
  let yaml = doc.toString({ lineWidth: 0 });
  if (!yaml.endsWith("\n")) yaml += "\n";
  let header = `---\n${yaml}---\n`;
  if (newline === "\r\n") header = header.replace(/\n/g, "\r\n");
  return bom + header + body;
}

function applyToDocument(doc: Document, patch: DiagramPatch): void {
  if ("title" in patch) setOrClear(doc, ["title"], patch.title ?? null);
  if ("displayMode" in patch) setOrClear(doc, ["displayMode"], patch.displayMode?.trim() ?? null);
  if ("description" in patch) setOrClear(doc, [NERDGRAM, "description"], patch.description ?? null);
  if ("notes" in patch) setOrClear(doc, [NERDGRAM, "notes"], patch.notes ?? null);
  if ("tags" in patch) {
    const tags = (patch.tags ?? []).map((tag) => tag.trim()).filter((tag, index, all) => tag && all.indexOf(tag) === index);
    setOrClear(doc, [NERDGRAM, "tags"], tags);
  }
  if ("theme" in patch) setOrClear(doc, ["config", "theme"], patch.theme?.trim() ?? null);
  if ("look" in patch) setOrClear(doc, ["config", "look"], patch.look?.trim() ?? null);
  if ("layout" in patch) setOrClear(doc, ["config", "layout"], patch.layout?.trim() ?? null);
  if ("fontFamily" in patch) setOrClear(doc, ["config", "fontFamily"], patch.fontFamily?.trim() ?? null);
  if ("themeCSS" in patch) setOrClear(doc, ["config", "themeCSS"], patch.themeCSS ?? null);
  if ("handDrawnSeed" in patch) {
    if (patch.handDrawnSeed == null || !Number.isFinite(patch.handDrawnSeed)) {
      setOrClear(doc, ["config", "handDrawnSeed"], null);
    } else {
      setOrClear(doc, ["config", "handDrawnSeed"], patch.handDrawnSeed);
    }
  }
  if (patch.themeVariables) {
    for (const [key, value] of Object.entries(patch.themeVariables)) {
      setOrClear(doc, ["config", "themeVariables", key], value ?? null);
    }
  }
  if (patch.elk) {
    for (const [key, value] of Object.entries(patch.elk)) {
      setOrClear(doc, ["config", "elk", key], value ?? null);
    }
  }
  if ("flowchartCurve" in patch) {
    setOrClear(doc, ["config", "flowchart", "curve"], patch.flowchartCurve?.trim() ?? null);
  }
  pruneEmpty(doc, [NERDGRAM]);
  pruneEmpty(doc, ["config"]);
}

/**
 * Update front matter and leave the diagram body byte-for-byte unchanged.
 * Malformed YAML is returned untouched so autosave cannot replace it.
 */
export function applyDiagramPatch(source: string, patch: DiagramPatch): ApplyResult {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const match = matchFrontMatter(text);
  if (match) {
    const loaded = loadDocument(yamlText(match));
    if (loaded.error) return { ok: false, error: loaded.error, source };
    try {
      applyToDocument(loaded.doc, patch);
      return { ok: true, source: compose(source, text.slice(match.length), loaded.doc) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update front matter.";
      return { ok: false, error: message, source };
    }
  }

  const doc = new Document({}, { schema: "core" });
  try {
    applyToDocument(doc, patch);
    return { ok: true, source: compose(source, text, doc) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update front matter.";
    return { ok: false, error: message, source };
  }
}

function removeSpans(body: string, spans: { start: number; end: number }[]): string {
  let next = body;
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  for (const span of ordered) {
    const lineStart = next.lastIndexOf("\n", span.start - 1) + 1;
    const newlineAt = next.indexOf("\n", span.end);
    const lineEnd = newlineAt === -1 ? next.length : newlineAt;
    const line = next.slice(lineStart, lineEnd);
    const removed =
      line.slice(0, span.start - lineStart) + line.slice(span.end - lineStart);
    if (removed.trim() === "") {
      const dropTo = newlineAt === -1 ? next.length : newlineAt + 1;
      next = next.slice(0, lineStart) + next.slice(dropTo);
    } else {
      next = next.slice(0, span.start) + next.slice(span.end);
    }
  }
  return next;
}

/**
 * Move deprecated `%%{init}%%` / `%%{initialize}%%` directives into `config`.
 * Directive keys overwrite the same front matter keys so the diagram keeps
 * the look Mermaid already renders (Mermaid merges the directive on top).
 * Other front matter keys, including `nerdgram` and unknown keys, stay.
 */
export function migrateInitDirectives(source: string): MigrateResult {
  const parsed = parseDiagram(source);
  if (parsed.malformed) {
    return {
      ok: false,
      error: parsed.error || "Fix the YAML front matter before moving the directive.",
      source,
    };
  }
  if (!parsed.hasLegacyInit) return { ok: true, source, migrated: false };
  if (parsed.initError) return { ok: false, error: parsed.initError, source };

  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const match = matchFrontMatter(text);
  const body = match ? text.slice(match.length) : text;
  const hits = findInitDirectives(body).filter((hit) => hit.value);
  const loaded = match
    ? loadDocument(yamlText(match))
    : { doc: new Document({}, { schema: "core" }), error: null };
  if (loaded.error || !loaded.doc) return { ok: false, error: loaded.error || "Could not read front matter.", source };

  try {
    for (const hit of hits) {
      if (!hit.value) continue;
      for (const [key, value] of Object.entries(hit.value)) {
        loaded.doc.setIn(["config", key], value);
      }
    }
    pruneEmpty(loaded.doc, ["config"]);
    const nextBody = removeSpans(body, hits);
    return { ok: true, source: compose(source, nextBody, loaded.doc), migrated: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not move the init directive.";
    return { ok: false, error: message, source };
  }
}

export type DiagramSearchFields = {
  path: string;
  title: string | null;
  description: string;
  notes: string;
  tags: string[];
};

/**
 * Lower is a better match. `null` means no match.
 * The file name and path outrank title, tags, description, and notes
 * when more than one field matches.
 */
export function diagramSearchRank(item: DiagramSearchFields, query: string): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const path = item.path.toLowerCase();
  const fileName = path.split("/").pop()?.replace(/\.mmd$/i, "") ?? path;
  if (fileName.includes(needle) || path.includes(needle)) return 0;
  if ((item.title ?? "").toLowerCase().includes(needle)) return 1;
  if (item.tags.some((tag) => tag.toLowerCase().includes(needle))) return 2;
  if (item.description.toLowerCase().includes(needle)) return 3;
  if (item.notes.toLowerCase().includes(needle)) return 4;
  return null;
}

export type DiagramMeta = {
  path: string;
  title: string | null;
  description: string;
  notes: string;
  tags: string[];
  theme: string | null;
  look: string | null;
  layout: string | null;
  malformed: boolean;
  error: string | null;
  cacheKey: string;
};

export function diagramMetaFrom(path: string, source: string): DiagramMeta {
  const parsed = parseDiagram(source);
  return {
    path,
    title: parsed.title,
    description: parsed.description,
    notes: parsed.notes,
    tags: parsed.tags,
    theme: parsed.theme,
    look: parsed.look,
    layout: parsed.layout,
    malformed: parsed.malformed,
    error: parsed.error,
    cacheKey: parsed.cacheKey,
  };
}
