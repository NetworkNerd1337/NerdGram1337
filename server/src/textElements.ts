import { parseDiagram, type DiagramDocument, type DiagramTextElement } from "./frontMatter.js";

/**
 * Visible text in a Mermaid diagram.
 *
 * Indexed: node and edge labels, subgraph titles, titles, notes, sequence
 * participants and messages, class and ER names, and the same kind of
 * readable text in other diagram types. A node id is indexed only when
 * Mermaid draws that id (there is no separate label).
 *
 * Not indexed: diagram-type keywords, directions, style / classDef / click
 * lines, arrow markup, and `%%` comments (they are not drawn).
 * Extraction is line-based. If a line yields nothing, a keyword-stripped
 * fallback keeps a phrase from that line instead of the raw file.
 */

/** Stop reading a single file after this many characters. The rest is not indexed. */
export const MAX_EXTRACT_CHARS = 512 * 1024;

const MAX_ELEMENTS = 800;
const MAX_ELEMENT_CHARS = 400;
const MAX_LINE_CHARS = 4_000;

const SYNTAX = new Set([
  "flowchart",
  "graph",
  "td",
  "lr",
  "tb",
  "rl",
  "bt",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "statediagram-v2",
  "erdiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "gitgraph",
  "quadrantchart",
  "xychart-beta",
  "block-beta",
  "subgraph",
  "end",
  "participant",
  "actor",
  "note",
  "style",
  "classdef",
  "class",
  "click",
  "direction",
  "linkstyle",
  "left",
  "right",
  "over",
  "of",
  "as",
  "and",
  "loop",
  "alt",
  "else",
  "opt",
  "par",
  "critical",
  "break",
  "rect",
  "autonumber",
  "activate",
  "deactivate",
  "title",
  "section",
  "dateformat",
  "axisformat",
  "excludes",
  "includes",
  "todaymarker",
  "showdata",
]);

type Kind = DiagramTextElement["kind"];

type Push = (kind: Kind, text: string, line: number) => void;

type ShapeHit = { id: string; label: string; start: number; end: number };

const OPENERS: { open: string; close: string }[] = [
  { open: "([", close: "])" },
  { open: "[[", close: "]]" },
  { open: "[(", close: ")]" },
  { open: "[/", close: "/]" },
  { open: "[\\", close: "\\]" },
  { open: "((", close: "))" },
  { open: "{{", close: "}}" },
  { open: "[", close: "]" },
  { open: "(", close: ")" },
  { open: "{", close: "}" },
  { open: ">", close: "]" },
];

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const open = trimmed[0];
  const close = trimmed[trimmed.length - 1];
  if ((open === '"' || open === "'" || open === "`") && close === open) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isSyntaxOnly(value: string): boolean {
  return SYNTAX.has(value.trim().toLowerCase());
}

function clip(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_ELEMENT_CHARS) return cleaned;
  return cleaned.slice(0, MAX_ELEMENT_CHARS);
}

function lineOfBody(source: string, doc: DiagramDocument): number {
  if (!doc.hasFrontMatter) return 1;
  const index = source.indexOf(doc.body);
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function detectType(line: string): string | null {
  const match =
    /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|xychart(?:-beta)?|block(?:-beta)?)\b/i.exec(
      line,
    );
  if (!match) return null;
  const word = match[1].toLowerCase();
  if (word === "flowchart" || word === "graph") return "flowchart";
  if (word === "sequencediagram") return "sequence";
  if (word === "classdiagram") return "class";
  if (word.startsWith("statediagram")) return "state";
  if (word === "erdiagram") return "er";
  if (word === "journey") return "journey";
  if (word === "gantt") return "gantt";
  if (word === "pie") return "pie";
  if (word === "mindmap") return "mindmap";
  if (word === "timeline") return "timeline";
  if (word === "gitgraph") return "git";
  if (word === "quadrantchart") return "quadrant";
  if (word.startsWith("xychart")) return "xy";
  if (word.startsWith("block")) return "block";
  return "unknown";
}

function findClose(line: string, from: number, close: string): number {
  let quote: string | null = null;
  for (let i = from; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (line.startsWith(close, i)) return i;
  }
  return -1;
}

function readShapes(line: string): ShapeHit[] {
  const found: ShapeHit[] = [];
  let i = 0;
  while (i < line.length) {
    const idMatch = /^[A-Za-z_][\w-]*/.exec(line.slice(i));
    if (!idMatch || (i > 0 && /[\w-]/.test(line[i - 1] ?? ""))) {
      i += 1;
      continue;
    }
    const id = idMatch[0];
    const cursor = i + id.length;
    const opener = OPENERS.find((item) => line.startsWith(item.open, cursor));
    if (!opener) {
      i += id.length;
      continue;
    }
    const contentStart = cursor + opener.open.length;
    const closeAt = findClose(line, contentStart, opener.close);
    if (closeAt < 0) {
      i += id.length;
      continue;
    }
    found.push({
      id,
      label: unquote(line.slice(contentStart, closeAt)),
      start: i,
      end: closeAt + opener.close.length,
    });
    i = closeAt + opener.close.length;
  }
  return found;
}

function blankSpans(line: string, spans: { start: number; end: number }[]): string {
  const chars = [...line];
  for (const span of spans) {
    for (let i = span.start; i < span.end && i < chars.length; i += 1) chars[i] = " ";
  }
  return chars.join("");
}

function takePipeLabels(line: string, lineNo: number, push: Push): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "|") {
      out += line[i];
      i += 1;
      continue;
    }
    const end = line.indexOf("|", i + 1);
    if (end < 0) {
      out += line.slice(i);
      break;
    }
    push("edge", line.slice(i + 1, end), lineNo);
    out += " ";
    i = end + 1;
  }
  return out;
}

function takeDashLabels(line: string, lineNo: number, push: Push): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const dash = /^(?:--+|==+|\.\-+)/.exec(line.slice(i));
    if (!dash) {
      out += line[i];
      i += 1;
      continue;
    }
    const after = i + dash[0].length;
    const labeled = /^[ \t]+([^>|=\n][^>|=\n]{0,200}?)[ \t]+(?:--+>?|==+>|\.\-+>)/.exec(
      line.slice(after),
    );
    const label = labeled?.[1]?.trim() ?? "";
    if (labeled && label && !/^[-.=<>]+$/.test(label) && !isSyntaxOnly(label)) {
      push("edge", label, lineNo);
      i = after + labeled[0].length;
      out += " ";
      continue;
    }
    out += dash[0];
    i = after;
  }
  return out;
}

function pushBareIds(
  line: string,
  lineNo: number,
  labeled: Set<string>,
  push: Push,
  kind: Kind,
): void {
  const stripped = line.replace(/<?(?:--+|==+|\.\-+|-\.-)(?:>|o|x)?/g, " ");
  for (const token of stripped.split(/[\s&;,]+/)) {
    const id = token.trim();
    if (!/^[A-Za-z_][\w.-]*$/.test(id)) continue;
    if (labeled.has(id) || isSyntaxOnly(id)) continue;
    push(kind, id, lineNo);
  }
}

function subgraphTitle(rest: string): string {
  const trimmed = rest.trim();
  const shaped = /^[A-Za-z_][\w-]*\s*\[([\s\S]*)\]$/.exec(trimmed);
  if (shaped) return unquote(shaped[1] ?? "");
  return unquote(trimmed);
}

function extractFlowLine(line: string, lineNo: number, labeled: Set<string>, push: Push): boolean {
  if (/^\s*end\s*$/i.test(line)) return true;
  if (/^(?:style|classDef|linkStyle|click|direction|interpolate)\b/i.test(line)) return true;
  const sub = /^\s*subgraph\b(.*)$/i.exec(line);
  if (sub) {
    push("subgraph", subgraphTitle(sub[1] ?? ""), lineNo);
    return true;
  }
  if (/^\s*class\b/i.test(line)) return true;

  const shapes = readShapes(line);
  for (const shape of shapes) {
    labeled.add(shape.id);
    push("node", shape.label || shape.id, lineNo);
  }
  let rest = blankSpans(line, shapes);
  rest = takePipeLabels(rest, lineNo, push);
  rest = takeDashLabels(rest, lineNo, push);
  pushBareIds(rest, lineNo, labeled, push, "node");
  return true;
}

function extractSequenceLine(line: string, lineNo: number, push: Push): boolean {
  const trimmed = line.trim();
  const declared = /^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i.exec(trimmed);
  if (declared) {
    const alias = declared[2]?.trim();
    push("participant", alias ? unquote(alias) : (declared[1] ?? ""), lineNo);
    return true;
  }
  if (/^(?:autonumber|activate|deactivate)\b/i.test(trimmed) || /^end\s*$/i.test(trimmed)) return true;
  if (/^rect\b/i.test(trimmed)) return true;
  const note = /^note\b[^:]*:\s*(.+)$/i.exec(trimmed);
  if (note) {
    push("note", note[1] ?? "", lineNo);
    return true;
  }
  const block = /^(?:loop|alt|else|opt|par|critical|break)\b(?:\s+(.+))?$/i.exec(trimmed);
  if (block) {
    if (block[1]?.trim()) push("text", block[1], lineNo);
    return true;
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0) {
    const left = trimmed.slice(0, colon);
    if (/--+|>>|->/.test(left)) {
      push("message", trimmed.slice(colon + 1), lineNo);
      const names = left.split(/<?--+>?|--+>>|->>|-->>|-->|->|-\)|--x|\s+/);
      for (const name of names) {
        const id = name.trim();
        if (!/^[\w.]+$/.test(id) || isSyntaxOnly(id)) continue;
        push("participant", id, lineNo);
      }
      return true;
    }
  }
  return false;
}

function extractClassLine(
  line: string,
  lineNo: number,
  push: Push,
  state: { inBlock: boolean },
): boolean {
  const trimmed = line.trim();
  if (trimmed === "{") {
    state.inBlock = true;
    return true;
  }
  if (trimmed === "}" || trimmed === "}") {
    state.inBlock = false;
    return true;
  }
  const cls = /^class\s+([A-Za-z_][\w]*)(?:\s*\[\s*([^\]]+)\])?/.exec(trimmed);
  if (cls) {
    push("class", unquote((cls[2] || cls[1] || "").trim()), lineNo);
    if (trimmed.includes("{") && !trimmed.includes("}")) state.inBlock = true;
    if (trimmed.includes("}")) state.inBlock = false;
    return true;
  }
  if (state.inBlock) {
    if (trimmed === "}" || trimmed.endsWith("}")) state.inBlock = false;
    const member = trimmed.replace(/^[+\-#~]\s*/, "").replace(/\}\s*$/, "").trim();
    if (member && member !== "}") push("member", member, lineNo);
    return true;
  }
  if (/<\|--|o--|<\|\.\.|--\|>|\*--|o\.\.|--/.test(trimmed)) {
    const label = /:\s*(.+)$/.exec(trimmed);
    const left = label ? trimmed.slice(0, label.index) : trimmed;
    if (label?.[1]) push("text", label[1], lineNo);
    for (const name of left.split(/[^A-Za-z0-9_]+/)) {
      if (/^[A-Za-z_][\w]*$/.test(name) && !isSyntaxOnly(name)) push("class", name, lineNo);
    }
    return true;
  }
  const annotation = /^([A-Za-z_][\w]*)\s*:\s*(.+)$/.exec(trimmed);
  if (annotation) {
    push("class", annotation[1] ?? "", lineNo);
    push("member", annotation[2] ?? "", lineNo);
    return true;
  }
  return false;
}

function extractErLine(
  line: string,
  lineNo: number,
  push: Push,
  state: { inBlock: boolean },
): boolean {
  const trimmed = line.trim();
  if (state.inBlock) {
    if (trimmed === "}" || trimmed.startsWith("}")) {
      state.inBlock = false;
      return true;
    }
    const parts = trimmed.split(/\s+/);
    const name = (parts.length >= 2 ? parts[1] : parts[0]) ?? "";
    const attr = name.replace(/[^\w].*$/, "");
    if (attr && !isSyntaxOnly(attr)) push("attribute", attr, lineNo);
    return true;
  }
  if (trimmed.endsWith("{")) {
    const entity = trimmed.slice(0, -1).trim();
    if (entity) push("entity", entity, lineNo);
    state.inBlock = true;
    return true;
  }
  const rel = /^([A-Za-z_][\w]*)\s+\S+\s+([A-Za-z_][\w]*)\s*:\s*(.+)$/.exec(trimmed);
  if (rel) {
    push("entity", rel[1] ?? "", lineNo);
    push("entity", rel[2] ?? "", lineNo);
    push("text", rel[3] ?? "", lineNo);
    return true;
  }
  return false;
}

function extractStateLine(line: string, lineNo: number, push: Push): boolean {
  const trimmed = line.trim();
  if (/^\[\*\]\s*$/.test(trimmed) || /^direction\b/i.test(trimmed)) return true;
  const named = /^state\s+"([^"]+)"(?:\s+as\s+\S+)?/i.exec(trimmed);
  if (named) {
    push("state", named[1] ?? "", lineNo);
    return true;
  }
  const note = /^note\b[^:]*:\s*(.+)$/i.exec(trimmed);
  if (note) {
    push("note", note[1] ?? "", lineNo);
    return true;
  }
  if (/^state\s+([A-Za-z_][\w]*)\s*\{/.test(trimmed)) {
    const id = /^state\s+([A-Za-z_][\w]*)/.exec(trimmed);
    if (id?.[1]) push("state", id[1], lineNo);
    return true;
  }
  if (trimmed === "}" || trimmed === "--" || trimmed === "end") return true;
  const colon = trimmed.indexOf(":");
  if (colon > 0 && /-->/.test(trimmed.slice(0, colon))) {
    push("edge", trimmed.slice(colon + 1), lineNo);
  } else if (colon > 0) {
    push("text", trimmed.slice(colon + 1), lineNo);
  }
  const without = trimmed.replace(/\[\*\]/g, " ").replace(/-->/g, " ").replace(/:/g, " ");
  let any = false;
  for (const token of without.split(/\s+/)) {
    if (/^[A-Za-z_][\w]*$/.test(token) && !isSyntaxOnly(token)) {
      push("state", token, lineNo);
      any = true;
    }
  }
  return any || colon > 0;
}

function extractGanttLine(line: string, lineNo: number, push: Push): boolean {
  const trimmed = line.trim();
  if (/^(?:dateFormat|axisFormat|excludes|includes|todayMarker)\b/i.test(trimmed)) return true;
  const section = /^section\s+(.+)$/i.exec(trimmed);
  if (section) {
    push("section", section[1] ?? "", lineNo);
    return true;
  }
  const task = /^([^:]+):/.exec(trimmed);
  if (task && !/^(?:title|section)$/i.test((task[1] ?? "").trim())) {
    push("task", task[1] ?? "", lineNo);
    return true;
  }
  return false;
}

function extractPieLine(line: string, lineNo: number, push: Push): boolean {
  const trimmed = line.trim();
  if (/^showData\b/i.test(trimmed) || /^pie\b/i.test(trimmed)) return true;
  const quoted = /^"([^"]+)"\s*:/.exec(trimmed);
  if (quoted) {
    push("slice", quoted[1] ?? "", lineNo);
    return true;
  }
  const plain = /^([^:]+)\s*:\s*\d/.exec(trimmed);
  if (plain) {
    push("slice", plain[1] ?? "", lineNo);
    return true;
  }
  return false;
}

function extractMindmapLine(line: string, lineNo: number, push: Push): boolean {
  const trimmed = line.trim().replace(/::icon\([^)]*\)/g, "").trim();
  if (!trimmed) return true;
  const shapes = readShapes(trimmed);
  if (shapes.length > 0) {
    for (const shape of shapes) push("node", shape.label || shape.id, lineNo);
    return true;
  }
  if (!isSyntaxOnly(trimmed)) push("node", trimmed, lineNo);
  return true;
}

function extractJourneyLine(line: string, lineNo: number, push: Push): boolean {
  const trimmed = line.trim();
  const section = /^section\s+(.+)$/i.exec(trimmed);
  if (section) {
    push("section", section[1] ?? "", lineNo);
    return true;
  }
  const parts = trimmed.split(":");
  if (parts.length >= 2) {
    push("task", parts[0] ?? "", lineNo);
    const actor = parts[parts.length - 1]?.trim() ?? "";
    if (actor && !/^\d+(\.\d+)?$/.test(actor)) push("text", actor, lineNo);
    return true;
  }
  return false;
}

function extractTimelineLine(line: string, lineNo: number, push: Push): boolean {
  const trimmed = line.trim();
  const section = /^section\s+(.+)$/i.exec(trimmed);
  if (section) {
    push("section", section[1] ?? "", lineNo);
    return true;
  }
  const parts = trimmed.split(":");
  if (parts.length >= 2) {
    push("text", parts[0] ?? "", lineNo);
    push("text", parts.slice(1).join(":"), lineNo);
    return true;
  }
  if (!isSyntaxOnly(trimmed)) push("text", trimmed, lineNo);
  return true;
}

function extractQuadrantLine(line: string, lineNo: number, push: Push): boolean {
  const trimmed = line.trim();
  const axis = /^(?:x-axis|y-axis)\s+(.+)$/i.exec(trimmed);
  if (axis) {
    for (const part of (axis[1] ?? "").split("-->")) push("text", part, lineNo);
    return true;
  }
  const point = /^([^:[\]]+):\s*\[/.exec(trimmed);
  if (point) {
    push("text", point[1] ?? "", lineNo);
    return true;
  }
  return false;
}

function extractBlockLine(line: string, lineNo: number, labeled: Set<string>, push: Push): boolean {
  if (/^(?:columns|block-beta)\b/i.test(line.trim())) return true;
  return extractFlowLine(line, lineNo, labeled, push);
}

function extractFallback(line: string, lineNo: number, push: Push): void {
  const stripped = line
    .replace(/<[^>\n]{0,80}>/g, " ")
    .replace(/<?(?:--+|==+|\.\-+)(?:>|o|x)?/g, " ")
    .replace(/[|;{}()[\]"]/g, " ");
  const words = stripped
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !isSyntaxOnly(word) && !/^[%#@]/.test(word));
  if (words.length === 0) return;
  push("text", words.join(" "), lineNo);
}

/**
 * Human-readable text elements in document order.
 * `parsed` can be passed when the caller already ran `parseDiagram`.
 */
export function extractTextElements(
  source: string,
  parsed: DiagramDocument = parseDiagram(source),
): DiagramTextElement[] {
  const limited =
    parsed.body.length > MAX_EXTRACT_CHARS ? parsed.body.slice(0, MAX_EXTRACT_CHARS) : parsed.body;
  const startLine = lineOfBody(source, parsed);
  const lines = limited.split(/\r?\n/);
  const elements: DiagramTextElement[] = [];
  const seen = new Set<string>();
  const labeled = new Set<string>();
  const block = { inBlock: false };

  const push: Push = (kind, text, line) => {
    if (elements.length >= MAX_ELEMENTS) return;
    const value = clip(text);
    if (!value) return;
    const key = `${kind}|${line}|${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    elements.push({ kind, text: value, line });
  };

  let type = "unknown";
  let inAccDescr = false;
  let accDescr: string[] = [];
  let accDescrLine = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (elements.length >= MAX_ELEMENTS) break;
    const lineNo = startLine + index;
    const raw = (lines[index] ?? "").slice(0, MAX_LINE_CHARS);
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;

    if (inAccDescr) {
      if (trimmed === "}") {
        push("accDescr", accDescr.join(" "), accDescrLine);
        inAccDescr = false;
        accDescr = [];
      } else {
        accDescr.push(trimmed.replace(/}\s*$/, ""));
        if (trimmed.endsWith("}")) {
          push("accDescr", accDescr.join(" "), accDescrLine);
          inAccDescr = false;
          accDescr = [];
        }
      }
      continue;
    }

    const accTitle = /^\s*accTitle\s*:\s*(.*)$/i.exec(raw);
    if (accTitle) {
      push("accTitle", accTitle[1] ?? "", lineNo);
      continue;
    }
    const accDescrOne = /^\s*accDescr\s*:\s*(.*)$/i.exec(raw);
    if (accDescrOne) {
      push("accDescr", accDescrOne[1] ?? "", lineNo);
      continue;
    }
    if (/^\s*accDescr\s*\{/i.test(raw)) {
      inAccDescr = true;
      accDescrLine = lineNo;
      const rest = raw.replace(/^\s*accDescr\s*\{/i, "").trim();
      if (rest && rest !== "}") accDescr.push(rest.replace(/}\s*$/, ""));
      if (raw.includes("}")) {
        push("accDescr", accDescr.join(" "), lineNo);
        inAccDescr = false;
        accDescr = [];
      }
      continue;
    }

    if (/^\s*title\s+\S/i.test(trimmed) && !trimmed.includes("-->")) {
      const title = /^\s*title\s+(.+)$/i.exec(trimmed);
      if (title) push("title", unquote(title[1] ?? ""), lineNo);
      continue;
    }

    if (type === "unknown") {
      const detected = detectType(trimmed);
      if (detected) {
        type = detected;
        const pieTitle = /^\s*pie(?:\s+showData)?\s+title\s+(.+)$/i.exec(trimmed);
        if (pieTitle) push("title", unquote(pieTitle[1] ?? ""), lineNo);
        continue;
      }
    }

    let handled = false;
    if (type === "flowchart" || type === "block") {
      handled = type === "block"
        ? extractBlockLine(trimmed, lineNo, labeled, push)
        : extractFlowLine(trimmed, lineNo, labeled, push);
    } else if (type === "sequence") handled = extractSequenceLine(trimmed, lineNo, push);
    else if (type === "class") handled = extractClassLine(trimmed, lineNo, push, block);
    else if (type === "er") handled = extractErLine(trimmed, lineNo, push, block);
    else if (type === "state") handled = extractStateLine(trimmed, lineNo, push);
    else if (type === "gantt") handled = extractGanttLine(trimmed, lineNo, push);
    else if (type === "pie") handled = extractPieLine(trimmed, lineNo, push);
    else if (type === "mindmap") handled = extractMindmapLine(trimmed, lineNo, push);
    else if (type === "journey") handled = extractJourneyLine(trimmed, lineNo, push);
    else if (type === "timeline") handled = extractTimelineLine(trimmed, lineNo, push);
    else if (type === "quadrant" || type === "xy") handled = extractQuadrantLine(trimmed, lineNo, push);

    if (!handled) extractFallback(trimmed, lineNo, push);
  }

  return elements;
}
