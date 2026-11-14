import { parseDiagram } from "./frontMatter.js";

/**
 * Diagram links stored as Mermaid `click` directives.
 *
 * A workspace link is `nerdgram:Sites/Atlanta.mmd` (or the older `diagram:`
 * form the broken-link check already understood) or a relative `.mmd` path.
 * Both stay inside the workspace: `..` that would leave it is rejected, and
 * hidden segments such as `.meta` are rejected, matching `resolveSafePath`.
 * The strings live in the `.mmd` file, so GitHub sync copies them with the
 * diagram and they still resolve after a pull.
 */

export type ClickLink = {
  nodeId: string;
  target: string;
  from: number;
  to: number;
  line: number;
  column: number;
};

export type ResolvedDiagramTarget =
  | { ok: true; path: string }
  | { ok: false; reason: "not-diagram" | "escape" | "invalid" };

export type ClickTargetKind = "diagram" | "external" | "unsafe" | "none";

export type IndexedLink = {
  from: string;
  raw: string;
  line: number;
  resolved: string | null;
  broken: boolean;
};

export type DiagramLinkEnds = {
  linksTo: { path: string | null; target: string; line: number; broken: boolean }[];
  linkedFrom: { path: string; target: string; line: number }[];
};

const DIAGRAM_SCHEME = /^(nerdgram|diagram):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_HTTP = /^https?:$/i;

/**
 * True when a click URL looks like a workspace diagram rather than a web
 * address. `nerdgram:` and `diagram:` are workspace paths. A relative `.mmd`
 * path, a `./` path, or any other path with a slash is too.
 */
export function isDiagramLink(url: string): boolean {
  if (!url || url.startsWith("//")) return false;
  if (ANY_SCHEME.test(url) && !DIAGRAM_SCHEME.test(url)) return false;
  const pathPart = url.split(/[?#]/)[0] ?? "";
  return DIAGRAM_SCHEME.test(url) || /\.mmd$/i.test(pathPart) || pathPart.startsWith("./") || pathPart.includes("/");
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** `javascript:`, `data:`, and other non-http schemes are unsafe. http(s) is external. */
export function clickTargetKind(raw: string): ClickTargetKind {
  const url = raw.trim();
  if (!url) return "none";
  if (url.startsWith("//") || hasControlCharacter(url)) return "unsafe";
  const squashed = url.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  if (squashed.startsWith("javascript:") || squashed.startsWith("vbscript:") || squashed.startsWith("data:")) {
    return "unsafe";
  }
  if (DIAGRAM_SCHEME.test(url)) return "diagram";
  const scheme = ANY_SCHEME.exec(url);
  if (scheme) {
    const safe = safeHttpUrl(url);
    return safe ? "external" : "unsafe";
  }
  return isDiagramLink(url) ? "diagram" : "none";
}

export type ClickAction =
  | { type: "navigate"; path: string }
  | { type: "external"; url: string }
  | { type: "broken"; message: string }
  | { type: "ignore" };

const BLOCKED_LINK = "This link was blocked. Only a diagram in this workspace or an http(s) address can be opened.";

/**
 * Decide what a click should do. A missing diagram or an unsafe URL stays on
 * the current page with a message. `knownPaths` null skips the existence
 * check so the caller can load the file and report a missing one itself.
 */
export function actionForClickTarget(
  target: string,
  sourcePath: string,
  knownPaths: readonly string[] | null,
): ClickAction {
  const kind = clickTargetKind(target);
  if (kind === "unsafe") return { type: "broken", message: BLOCKED_LINK };
  if (kind === "external") {
    const url = safeHttpUrl(target);
    if (!url) return { type: "broken", message: BLOCKED_LINK };
    return { type: "external", url };
  }
  if (kind !== "diagram") return { type: "ignore" };
  const resolved = resolveDiagramTarget(target, sourcePath);
  if (!resolved.ok) {
    const message =
      resolved.reason === "escape"
        ? `“${target.trim()}” points outside the workspace. This diagram stayed open.`
        : `“${target.trim()}” is not a diagram in this workspace. This diagram stayed open.`;
    return { type: "broken", message };
  }
  if (knownPaths && !knownPaths.some((path) => normalizeWorkspacePath(path) === resolved.path)) {
    return {
      type: "broken",
      message: `No diagram at ${resolved.path}. This diagram stayed open.`,
    };
  }
  return { type: "navigate", path: resolved.path };
}

/** http(s) URL with no userinfo. Anything else, including `javascript:`, is null. */
export function safeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || hasControlCharacter(trimmed) || trimmed.startsWith("//")) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!SAFE_HTTP.test(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

function parentPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

/**
 * Resolve a click target against the diagram that contains it.
 * `nerdgram:` and `diagram:` are workspace-absolute. Anything else is
 * relative to that diagram's folder. The result is a `.mmd` path with no
 * leading slash, or a refusal when the path leaves the workspace.
 */
export function resolveDiagramTarget(raw: string, sourcePath = ""): ResolvedDiagramTarget {
  const trimmed = raw.trim();
  if (!isDiagramLink(trimmed)) return { ok: false, reason: "not-diagram" };
  let target = trimmed.replace(/\\/g, "/");
  const scheme = DIAGRAM_SCHEME.exec(target);
  if (scheme) target = target.slice(scheme[0].length);
  const cut = target.search(/[?#]/);
  if (cut >= 0) target = target.slice(0, cut);
  target = target.replace(/^\/+/, "");
  if (!target || target.includes("\0")) return { ok: false, reason: "invalid" };

  const base = scheme ? "" : parentPath(sourcePath);
  const combined = base ? `${base}/${target}` : target;
  const parts: string[] = [];
  for (const part of combined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return { ok: false, reason: "escape" };
      parts.pop();
      continue;
    }
    if (part.startsWith(".")) return { ok: false, reason: "invalid" };
    parts.push(part);
  }
  const path = parts.join("/");
  if (!path.toLowerCase().endsWith(".mmd")) return { ok: false, reason: "not-diagram" };
  return { ok: true, path };
}

/**
 * Normalize a workspace path. Unlike a click target, this may be a folder, so
 * it does not require a `.mmd` suffix. `..` that would leave the workspace is
 * left unresolved so a later confine check still rejects it.
 */
export function normalizeWorkspacePath(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  const parts: string[] = [];
  for (const part of trimmed.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return trimmed.replace(/^\.\//, "");
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function diagramTargetExists(target: string, paths: readonly string[], sourcePath = ""): boolean {
  const resolved = resolveDiagramTarget(target, sourcePath);
  if (!resolved.ok) return false;
  return paths.some((path) => normalizeWorkspacePath(path) === resolved.path);
}

/** One `click` line. Callbacks (`click id call ...`) have no URL and return null. */
export function parseClickLine(line: string, lineStart: number, lineNo: number): ClickLink | null {
  const match = /^\s*click\s+([A-Za-z_][\w-]*)\s+(.*)$/i.exec(line);
  if (!match || match[1] == null || match[2] == null) return null;
  const nodeId = match[1];
  const rest = match[2];
  if (/^\s*call\b/i.test(rest)) return null;
  const href = /^\s*href\s+/i.exec(rest);
  const urlPart = href ? rest.slice(href[0].length) : rest;
  const urlPartStart = line.length - rest.length + (href ? href[0].length : 0);
  const quoted = /"([^"]*)"/.exec(urlPart);
  if (!quoted || quoted[1] == null || quoted.index == null) return null;
  const quoteAt = urlPartStart + quoted.index;
  const from = lineStart + quoteAt + 1;
  return {
    nodeId,
    target: quoted[1],
    from,
    to: from + quoted[1].length,
    line: lineNo,
    column: quoteAt + 2,
  };
}

export function extractClickLinks(source: string): ClickLink[] {
  const parsed = parseDiagram(source);
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const text = bom ? source.slice(bom) : source;
  const start = bom + (text.length - parsed.body.length);
  const end = Math.min(source.length, start + parsed.body.length);
  const links: ClickLink[] = [];
  let lineStart = start;
  let lineNo = 1;
  for (let index = 0; index < start && index < source.length; index += 1) {
    if (source[index] === "\n") lineNo += 1;
  }
  for (let index = start; index <= end; index += 1) {
    if (index !== end && source[index] !== "\n") continue;
    let textEnd = index;
    if (textEnd > lineStart && source[textEnd - 1] === "\r") textEnd -= 1;
    const line = source.slice(lineStart, textEnd);
    if (line.trim() && !line.trimStart().startsWith("%%")) {
      const click = parseClickLine(line, lineStart, lineNo);
      if (click) links.push(click);
    }
    lineNo += 1;
    lineStart = index + 1;
  }
  return links;
}

export function indexDiagramLinks(files: readonly { path: string; content: string }[]): IndexedLink[] {
  const known = new Set(files.map((file) => normalizeWorkspacePath(file.path)));
  const links: IndexedLink[] = [];
  for (const file of files) {
    for (const click of extractClickLinks(file.content)) {
      if (clickTargetKind(click.target) !== "diagram") continue;
      const resolved = resolveDiagramTarget(click.target, file.path);
      const path = resolved.ok ? resolved.path : null;
      links.push({
        from: normalizeWorkspacePath(file.path),
        raw: click.target,
        line: click.line,
        resolved: path,
        broken: path == null || !known.has(path),
      });
    }
  }
  return links;
}

export function linksFor(links: readonly IndexedLink[], path: string): DiagramLinkEnds {
  const wanted = normalizeWorkspacePath(path);
  return {
    linksTo: links
      .filter((link) => link.from === wanted)
      .map((link) => ({
        path: link.broken ? null : link.resolved,
        target: link.raw,
        line: link.line,
        broken: link.broken,
      })),
    linkedFrom: links
      .filter((link) => link.resolved === wanted && link.from !== wanted && !link.broken)
      .map((link) => ({ path: link.from, target: link.raw, line: link.line })),
  };
}

/** Files outside `target` that link to it, or to a diagram inside it when it is a folder. */
export function inboundLinkFiles(links: readonly IndexedLink[], target: string, isDirectory: boolean): string[] {
  const wanted = normalizeWorkspacePath(target);
  const files = new Set<string>();
  for (const link of links) {
    if (!link.resolved || link.broken) continue;
    const hit = isDirectory ? link.resolved === wanted || link.resolved.startsWith(`${wanted}/`) : link.resolved === wanted;
    if (!hit) continue;
    const inside = isDirectory && (link.from === wanted || link.from.startsWith(`${wanted}/`));
    if (inside || link.from === wanted) continue;
    files.add(link.from);
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

export function relocateDiagramPath(filePath: string, from: string, to: string, isDirectory: boolean): string {
  const source = normalizeWorkspacePath(filePath);
  const oldBase = normalizeWorkspacePath(from);
  const nextBase = normalizeWorkspacePath(to);
  if (!oldBase || !nextBase) return source;
  if (!isDirectory) return source === oldBase ? nextBase : source;
  if (source === oldBase) return nextBase;
  if (source.startsWith(`${oldBase}/`)) return `${nextBase}${source.slice(oldBase.length)}`;
  return source;
}

export function relativeDiagramPath(fromFile: string, toFile: string): string {
  const fromParts = parentPath(fromFile).split("/").filter(Boolean);
  const toParts = normalizeWorkspacePath(toFile).split("/").filter(Boolean);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared += 1;
  const ups = fromParts.length - shared;
  const relative = [...Array.from({ length: ups }, () => ".."), ...toParts.slice(shared)].join("/");
  return relative || toParts[toParts.length - 1] || toFile;
}

/** Keep `nerdgram:` or `diagram:` when that is what the author wrote. Otherwise stay relative. */
export function retargetClick(original: string, nextPath: string, fromFile: string): string {
  const trimmed = original.trim();
  const scheme = DIAGRAM_SCHEME.exec(trimmed);
  const hashAt = trimmed.search(/[?#]/);
  const suffix = hashAt >= 0 ? trimmed.slice(hashAt) : "";
  if (scheme) {
    const name = scheme[1]?.toLowerCase() === "diagram" ? "diagram" : "nerdgram";
    return `${name}:${nextPath}${suffix}`;
  }
  let relative = relativeDiagramPath(fromFile, nextPath);
  if (trimmed.startsWith("./") && !relative.startsWith(".")) relative = `./${relative}`;
  return `${relative}${suffix}`;
}

export type LinkRewrite = {
  path: string;
  nextPath: string;
  content: string;
};

export type LinkRepairMatch = "content" | "basename" | "ambiguous";

/** A missing diagram and the file that may have replaced it. `to` is null when more than one file matches. */
export type LinkRepairSuggestion = {
  from: string;
  to: string | null;
  match: LinkRepairMatch;
  candidates: string[];
};

export type LinkRepairEdit = {
  line: number;
  target: string;
  next: string;
};

/** One diagram whose click targets would change. The file is not written until the repair is confirmed. */
export type LinkRepairChange = {
  path: string;
  links: LinkRepairEdit[];
};

/** A data file that already moved with a diagram renamed outside the app. */
export type DataFileRepair = {
  diagram: string;
  from: string;
  to: string;
};

export type LinkRepairPlan = {
  suggestions: LinkRepairSuggestion[];
  changes: LinkRepairChange[];
  /** Source paths to rewrite when the sibling data file moved with the diagram. */
  dataFiles: DataFileRepair[];
  applied: boolean;
  saved: string[];
};

/**
 * Rewrite click targets that still resolve to a path in `moves`.
 * The moved file is already at `to`. Each map entry is applied to the
 * original text, so two renames in one pass do not rewrite each other.
 * An empty `to` is ignored. Callers leave ambiguous matches out of `moves`.
 */
export function planRepairRewrites(
  files: readonly { path: string; content: string }[],
  moves: readonly { from: string; to: string }[],
): { path: string; content: string; links: LinkRepairEdit[] }[] {
  const map = new Map<string, string>();
  for (const move of moves) {
    const from = normalizeWorkspacePath(move.from);
    const to = normalizeWorkspacePath(move.to);
    if (!from || !to || from === to) continue;
    map.set(from, to);
  }
  if (map.size === 0) return [];

  const rewrites: { path: string; content: string; links: LinkRepairEdit[] }[] = [];
  for (const file of files) {
    const filePath = normalizeWorkspacePath(file.path);
    const edits: { from: number; to: number; insert: string }[] = [];
    const links: LinkRepairEdit[] = [];
    for (const click of extractClickLinks(file.content)) {
      if (clickTargetKind(click.target) !== "diagram") continue;
      const resolved = resolveDiagramTarget(click.target, filePath);
      if (!resolved.ok) continue;
      const nextPath = map.get(resolved.path);
      if (!nextPath || nextPath === resolved.path) continue;
      const insert = retargetClick(click.target, nextPath, filePath);
      if (insert === click.target) continue;
      edits.push({ from: click.from, to: click.to, insert });
      links.push({ line: click.line, target: click.target, next: insert });
    }
    if (edits.length === 0) continue;
    const ordered = edits.sort((a, b) => b.from - a.from);
    let content = file.content;
    for (const edit of ordered) {
      content = content.slice(0, edit.from) + edit.insert + content.slice(edit.to);
    }
    if (content !== file.content) rewrites.push({ path: filePath, content, links });
  }
  return rewrites.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * New text for every diagram whose click targets must change so they still
 * resolve after `from` moves to `to`. Absolute `nerdgram:` links inside a
 * moved file are left alone when their target did not move.
 */
export function planLinkRewrites(
  files: readonly { path: string; content: string }[],
  from: string,
  to: string,
  isDirectory: boolean,
): LinkRewrite[] {
  const rewrites: LinkRewrite[] = [];
  for (const file of files) {
    const nextFile = relocateDiagramPath(file.path, from, to, isDirectory);
    const edits: { from: number; to: number; insert: string }[] = [];
    for (const click of extractClickLinks(file.content)) {
      if (clickTargetKind(click.target) !== "diagram") continue;
      const resolved = resolveDiagramTarget(click.target, file.path);
      if (!resolved.ok) continue;
      const nextTarget = relocateDiagramPath(resolved.path, from, to, isDirectory);
      if (nextTarget === resolved.path && nextFile === normalizeWorkspacePath(file.path)) continue;
      const insert = retargetClick(click.target, nextTarget, nextFile);
      if (insert !== click.target) edits.push({ from: click.from, to: click.to, insert });
    }
    if (edits.length === 0) continue;
    const ordered = edits.sort((a, b) => b.from - a.from);
    let content = file.content;
    for (const edit of ordered) {
      content = content.slice(0, edit.from) + edit.insert + content.slice(edit.to);
    }
    if (content !== file.content) {
      rewrites.push({ path: normalizeWorkspacePath(file.path), nextPath: nextFile, content });
    }
  }
  return rewrites.sort((a, b) => a.path.localeCompare(b.path));
}

const NODE_ID = /^[A-Za-z_][\w-]*$/;

/** Mermaid line inserted by "Link node to diagram...". */
export function diagramLinkLine(nodeId: string, diagramPath: string, title?: string): string {
  if (!NODE_ID.test(nodeId)) throw new Error("Node id must start with a letter or underscore.");
  const path = normalizeWorkspacePath(diagramPath);
  if (!path.toLowerCase().endsWith(".mmd")) throw new Error("Choose a .mmd diagram.");
  const tip = title?.trim() ? ` "${title.trim().replace(/"/g, "")}"` : "";
  return `click ${nodeId} "nerdgram:${path}"${tip}`;
}

/** Replace an existing `click` for the same node, or append one. */
export function insertDiagramLink(source: string, nodeId: string, diagramPath: string, title?: string): string {
  const statement = diagramLinkLine(nodeId, diagramPath, title);
  const pattern = new RegExp(`^(\\s*)click\\s+${nodeId}\\b`, "i");
  const lines = source.split("\n");
  let replaced = false;
  const next = lines.map((line) => {
    if (replaced) return line;
    const match = pattern.exec(line);
    if (!match) return line;
    replaced = true;
    return `${match[1] ?? ""}${statement}`;
  });
  if (replaced) return next.join("\n");
  const base = source.replace(/\s*$/, "");
  return `${base}\n  ${statement}\n`;
}

export type ClickableNode = {
  id: string;
  dataId: string | null;
  href: string | null;
  tag: string;
  parent: ClickableNode | null;
};

function idMatchesNode(elementId: string, nodeId: string): boolean {
  if (!elementId || !nodeId) return false;
  if (elementId === nodeId) return true;
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|-)${escaped}-\\d+$`).test(elementId);
}

/**
 * Click URL for the SVG node under the pointer. Mermaid's node id is matched
 * from `data-id` or from an element id such as `flowchart-Atlanta-0`. The
 * longest node id wins so `Site` does not steal a click on `Core-Site`.
 */
export function clickTargetFromNode(source: string, node: ClickableNode | null): string | null {
  const links = extractClickLinks(source).filter((link) => clickTargetKind(link.target) !== "none");
  if (links.length === 0 || !node) return null;
  const byNode = new Map<string, string>();
  for (const link of links) byNode.set(link.nodeId, link.target);
  let current: ClickableNode | null = node;
  let depth = 0;
  while (current && depth < 24) {
    if (current.tag === "a" && current.href) {
      const href = current.href;
      const match = links.find((link) => link.target === href);
      if (match) return match.target;
      if (clickTargetKind(href) === "diagram" || clickTargetKind(href) === "external" || clickTargetKind(href) === "unsafe") {
        return href;
      }
    }
    if (current.dataId && byNode.has(current.dataId)) return byNode.get(current.dataId) ?? null;
    let best: string | null = null;
    for (const nodeId of byNode.keys()) {
      if (!idMatchesNode(current.id, nodeId)) continue;
      if (!best || nodeId.length > best.length) best = nodeId;
    }
    if (best) return byNode.get(best) ?? null;
    current = current.parent;
    depth += 1;
  }
  return null;
}
