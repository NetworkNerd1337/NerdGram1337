import { parseDocument } from "yaml";
import { diagramTargetExists, isDiagramLink, parseClickLine, resolveDiagramTarget } from "./diagramLinks.js";
import {
  diagramConfigKey,
  ELK_NODE_PLACEMENTS,
  FLOWCHART_CURVES,
  matchFrontMatter,
  MERMAID_LAYOUTS,
  MERMAID_LOOKS,
  MERMAID_THEMES,
  parseDiagram,
} from "./frontMatter.js";

/**
 * Diagram checks shared by the editor and `POST /api/lint`.
 *
 * The rules are plain text analysis so a future `nerdgram lint` command can
 * run them without a browser. The editor prefers Mermaid's parser for syntax
 * errors and, when the diagram database is available, confirms these warnings
 * against that database. Flowcharts are checked first, then sequence diagrams,
 * then state diagrams.
 */

export const LINT_RULES = [
  {
    id: "duplicate-id",
    label: "Duplicate ids",
    description: "The same id is defined again with a different label.",
  },
  {
    id: "unconnected-node",
    label: "Unconnected nodes",
    description: "A flowchart node is defined but never used in a connection.",
  },
  {
    id: "unlabeled-endpoint",
    label: "Unlabeled endpoints",
    description: "A connection names a node that was never given a label, which is usually a typo.",
  },
  {
    id: "unused-class",
    label: "Unused classes",
    description: "A classDef is never applied with class or :::",
  },
  {
    id: "undefined-class",
    label: "Undefined classes",
    description: "A class or ::: name has no classDef.",
  },
  {
    id: "front-matter",
    label: "Front matter",
    description: "The YAML header is invalid, or a theme, look, layout, curve, or tag is not one Mermaid accepts.",
  },
  {
    id: "broken-click",
    label: "Broken diagram links",
    description:
      "A click link points at a workspace diagram (nerdgram:, diagram:, or a relative .mmd path) that is not in the workspace.",
  },
] as const;

export type LintRuleId = (typeof LINT_RULES)[number]["id"];

export const LINT_RULE_IDS: readonly LintRuleId[] = LINT_RULES.map((rule) => rule.id);

export type LintEdit = {
  from: number;
  to: number;
  insert: string;
};

export type LintFixId = "rename-duplicate" | "remove-classdef" | "create-class" | "jump-to-definition";

export type LintFix = {
  id: LintFixId;
  title: string;
  edits: LintEdit[];
  /** Set for "Jump to definition". The edits list is empty, so the text stays the same. */
  jump?: { from: number; to: number };
};

export type LintDiagnostic = {
  ruleId: LintRuleId;
  severity: "error" | "warning";
  message: string;
  from: number;
  to: number;
  line: number;
  column: number;
  /** Node id or class name this diagnostic is about, when it has one. */
  subject?: string;
  fixes: LintFix[];
};

export type LintOptions = {
  /** Omitted rules stay on. A rule set to false is skipped. */
  rules?: Partial<Record<LintRuleId, boolean>>;
  /**
   * Workspace diagram paths. When omitted, click links are not checked,
   * because there is no list to resolve them against.
   */
  diagramPaths?: readonly string[];
  /**
   * Diagram the source belongs to. Relative click paths resolve against its
   * folder. Omitted means the workspace root, which is how a path such as
   * `./Examples/Sequence.mmd` is checked.
   */
  sourcePath?: string;
};

export type AstFacts = {
  kind: "flowchart" | "sequence" | "state" | "other";
  nodes: { id: string; label: string | null }[];
  edges: { from: string; to: string }[];
};

const ID = "[A-Za-z_][\\w-]*";
const SIMPLE_ARROWS = ["<-->", "o--o", "x--x", "<--", "-->", "---", "-.->", "-.-", "==>", "===", "--o", "--x", "~~~"];

type Span = {
  from: number;
  to: number;
  line: number;
  column: number;
};

type NodeHit = Span & {
  id: string;
  /** Null when the id was only named, with no shape. Empty string when the shape has no text. */
  label: string | null;
  defined: boolean;
};

type ClassDefHit = Span & {
  name: string;
  statementFrom: number;
  statementTo: number;
};

type ClassUseHit = Span & {
  name: string;
  lineStart: number;
};

type Model = {
  kind: "flowchart" | "sequence" | "state" | "other";
  nodes: NodeHit[];
  edges: { fromId: string; toId: string; fromSpan: NodeHit; toSpan: NodeHit }[];
  classDefs: ClassDefHit[];
  classUses: ClassUseHit[];
  clicks: (Span & { target: string })[];
};

export function normalizeLintRules(value: unknown): Record<LintRuleId, boolean> {
  const out = Object.fromEntries(LINT_RULE_IDS.map((id) => [id, true])) as Record<LintRuleId, boolean>;
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const id of LINT_RULE_IDS) {
    if (typeof record[id] === "boolean") out[id] = record[id];
  }
  return out;
}

export function applyEdits(source: string, edits: readonly LintEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.from - a.from || b.to - a.to);
  let next = source;
  for (const edit of ordered) {
    const from = Math.max(0, Math.min(edit.from, next.length));
    const to = Math.max(from, Math.min(edit.to, next.length));
    next = next.slice(0, from) + edit.insert + next.slice(to);
  }
  return next;
}

/** Lint one diagram. Parse errors from Mermaid are added by the editor, not here. */
export function lintDiagram(source: string, options: LintOptions = {}): LintDiagnostic[] {
  const enabled = normalizeLintRules(options.rules);
  const diagnostics: LintDiagnostic[] = [];
  if (enabled["front-matter"]) diagnostics.push(...lintFrontMatter(source));

  const model = scanDiagram(source);
  if (enabled["duplicate-id"]) diagnostics.push(...duplicateIds(model));
  if (enabled["unconnected-node"] && model.kind === "flowchart") diagnostics.push(...unconnectedNodes(model));
  if (enabled["unlabeled-endpoint"]) diagnostics.push(...unlabeledEndpoints(model));
  if (enabled["unused-class"]) diagnostics.push(...unusedClasses(model));
  if (enabled["undefined-class"]) diagnostics.push(...undefinedClasses(source, model));
  if (enabled["broken-click"] && options.diagramPaths) {
    diagnostics.push(...brokenClicks(model, options.diagramPaths, options.sourcePath ?? ""));
  }

  diagnostics.sort((a, b) => a.from - b.from || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  return diagnostics;
}

/**
 * Drop text warnings the Mermaid database contradicts, and add flowchart
 * nodes the database sees that the text scan missed. `facts` comes from
 * Mermaid's diagram database when that database is available.
 */
export function mergeAstFacts(
  source: string,
  diagnostics: readonly LintDiagnostic[],
  facts: AstFacts,
  options: LintOptions = {},
): LintDiagnostic[] {
  if (facts.nodes.length === 0 && facts.edges.length === 0) return [...diagnostics];
  const enabled = normalizeLintRules(options.rules);
  const connected = new Set<string>();
  for (const edge of facts.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const labels = new Map<string, string | null>();
  for (const node of facts.nodes) labels.set(node.id, node.label);

  const kept = diagnostics.filter((diagnostic) => {
    if (diagnostic.ruleId === "unconnected-node" && diagnostic.subject && connected.has(diagnostic.subject)) {
      return false;
    }
    if (diagnostic.ruleId === "unlabeled-endpoint" && diagnostic.subject) {
      const label = labels.get(diagnostic.subject);
      if (label && label.trim()) return false;
    }
    return true;
  });

  if (facts.kind !== "flowchart" || !enabled["unconnected-node"]) return kept;
  const edgeCount = facts.edges.length;
  const ids = [...labels.keys()];
  if (edgeCount === 0 && ids.length < 2) return kept;
  const already = new Set(kept.filter((item) => item.ruleId === "unconnected-node").map((item) => item.subject));
  const added: LintDiagnostic[] = [];
  for (const id of ids) {
    if (connected.has(id) || already.has(id)) continue;
    const at = locateId(source, id);
    if (!at) continue;
    added.push(unconnectedDiagnostic(id, at));
  }
  return [...kept, ...added].sort((a, b) => a.from - b.from || a.ruleId.localeCompare(b.ruleId));
}

export function locateId(source: string, id: string): Span | null {
  const pattern = new RegExp(`(^|[^A-Za-z0-9_-])(${escapeRegExp(id)})(?=$|[^A-Za-z0-9_-])`, "g");
  const match = pattern.exec(source);
  if (!match || match[2] == null || match.index == null) return null;
  const from = match.index + (match[1]?.length ?? 0);
  return pointSpan(source, from, from + id.length);
}

function scanDiagram(source: string): Model {
  const parsed = parseDiagram(source);
  const start = bodyStart(source);
  const kind = diagramKind(parsed.body);
  const model: Model = { kind, nodes: [], edges: [], classDefs: [], classUses: [], clicks: [] };
  eachLine(source, start, start + parsed.body.length, (line, lineStart, lineNo) => {
    if (!line.trim() || line.trimStart().startsWith("%%")) return;
    if (readClassDef(line, lineStart, lineNo, source, model)) return;
    if (readClassStatement(line, lineStart, lineNo, model)) return;
    if (readClick(line, lineStart, lineNo, model)) return;
    collectInlineClasses(line, lineStart, lineNo, model);
    if (kind === "flowchart") scanFlowchartLine(line, lineStart, lineNo, model);
    else if (kind === "sequence") scanSequenceLine(line, lineStart, lineNo, model);
    else if (kind === "state") scanStateLine(line, lineStart, lineNo, model);
  });
  return model;
}

function diagramKind(body: string): Model["kind"] {
  const key = diagramConfigKey(body);
  if (key === "flowchart") return "flowchart";
  if (key === "sequence") return "sequence";
  if (key === "state") return "state";
  return "other";
}

function duplicateIds(model: Model): LintDiagnostic[] {
  const byId = new Map<string, NodeHit[]>();
  for (const node of model.nodes) {
    if (!node.defined || node.label == null) continue;
    const list = byId.get(node.id) ?? [];
    list.push(node);
    byId.set(node.id, list);
  }
  const used = new Set(model.nodes.map((node) => node.id));
  const diagnostics: LintDiagnostic[] = [];
  for (const [id, hits] of byId) {
    const first = hits[0];
    if (!first) continue;
    const firstLabel = first.label?.trim() ?? "";
    for (const hit of hits.slice(1)) {
      const label = hit.label?.trim() ?? "";
      if (label === firstLabel) continue;
      const nextId = freshId(id, used);
      used.add(nextId);
      diagnostics.push({
        ruleId: "duplicate-id",
        severity: "warning",
        subject: id,
        message: `Node "${id}" is defined again with a different label ("${label || "empty"}"). The first label is "${firstLabel || "empty"}".`,
        from: hit.from,
        to: hit.to,
        line: hit.line,
        column: hit.column,
        fixes: [
          {
            id: "rename-duplicate",
            title: `Rename to ${nextId}`,
            edits: [{ from: hit.from, to: hit.to, insert: nextId }],
          },
          {
            id: "jump-to-definition",
            title: "Jump to definition",
            edits: [],
            jump: { from: first.from, to: first.to },
          },
        ],
      });
    }
  }
  return diagnostics;
}

function unconnectedNodes(model: Model): LintDiagnostic[] {
  const linked = new Set<string>();
  for (const edge of model.edges) {
    linked.add(edge.fromId);
    linked.add(edge.toId);
  }
  const defined = new Map<string, NodeHit>();
  for (const node of model.nodes) {
    if (node.defined && !defined.has(node.id)) defined.set(node.id, node);
  }
  if (model.edges.length === 0 && defined.size < 2) return [];
  const diagnostics: LintDiagnostic[] = [];
  for (const [id, node] of defined) {
    if (linked.has(id)) continue;
    diagnostics.push(unconnectedDiagnostic(id, node));
  }
  return diagnostics;
}

function unconnectedDiagnostic(id: string, at: Span): LintDiagnostic {
  return {
    ruleId: "unconnected-node",
    severity: "warning",
    subject: id,
    message: `Node "${id}" is defined but never connected to another node.`,
    from: at.from,
    to: at.to,
    line: at.line,
    column: at.column,
    fixes: [],
  };
}

function unlabeledEndpoints(model: Model): LintDiagnostic[] {
  const labels = new Map<string, string | null>();
  for (const node of model.nodes) {
    if (!node.defined || node.label == null) continue;
    const text = node.label.trim();
    if (!text) continue;
    if (!labels.has(node.id)) labels.set(node.id, text);
  }
  if (labels.size === 0 && model.kind === "flowchart") return [];
  if (model.kind === "sequence" || model.kind === "state") {
    const declared = model.nodes.some((node) => node.defined);
    if (!declared) return [];
  }
  const candidates: NodeHit[] = [];
  const seen = new Set<string>();
  for (const edge of model.edges) {
    for (const endpoint of [edge.fromSpan, edge.toSpan]) {
      if (labels.has(endpoint.id) || seen.has(endpoint.id)) continue;
      if (model.kind !== "flowchart" && model.nodes.some((node) => node.defined && node.id === endpoint.id)) continue;
      seen.add(endpoint.id);
      candidates.push(endpoint);
    }
  }
  // A flowchart that mostly names nodes by id (`A --> B`) is not a pile of typos.
  // Adding one labeled box must not flag every implicit endpoint.
  if (model.kind === "flowchart") {
    const labeledEndpoints = new Set<string>();
    for (const edge of model.edges) {
      if (labels.has(edge.fromId)) labeledEndpoints.add(edge.fromId);
      if (labels.has(edge.toId)) labeledEndpoints.add(edge.toId);
    }
    if (candidates.length > labeledEndpoints.size) return [];
  }
  return candidates.map((endpoint) => ({
    ruleId: "unlabeled-endpoint" as const,
    severity: "warning" as const,
    subject: endpoint.id,
    message: `This connection uses "${endpoint.id}", which has no label. That is often a typo.`,
    from: endpoint.from,
    to: endpoint.to,
    line: endpoint.line,
    column: endpoint.column,
    fixes: [],
  }));
}

function unusedClasses(model: Model): LintDiagnostic[] {
  const used = new Set(model.classUses.map((use) => use.name));
  const diagnostics: LintDiagnostic[] = [];
  const reported = new Set<string>();
  for (const def of model.classDefs) {
    if (def.name === "default" || used.has(def.name) || reported.has(`${def.from}:${def.name}`)) continue;
    reported.add(`${def.from}:${def.name}`);
    const siblings = model.classDefs.filter(
      (item) => item.statementFrom === def.statementFrom && item.statementTo === def.statementTo,
    );
    const allUnused = siblings.every((item) => item.name === "default" || !used.has(item.name));
    const edits: LintEdit[] = allUnused
      ? [{ from: def.statementFrom, to: def.statementTo, insert: "" }]
      : [{ from: def.from, to: def.to, insert: "" }];
    diagnostics.push({
      ruleId: "unused-class",
      severity: "warning",
      subject: def.name,
      message: `Class "${def.name}" is defined but never used.`,
      from: def.from,
      to: def.to,
      line: def.line,
      column: def.column,
      fixes: [{ id: "remove-classdef", title: "Remove unused class", edits }],
    });
  }
  return diagnostics;
}

function undefinedClasses(source: string, model: Model): LintDiagnostic[] {
  const defined = new Set(model.classDefs.map((def) => def.name));
  const diagnostics: LintDiagnostic[] = [];
  const seen = new Set<string>();
  for (const use of model.classUses) {
    if (defined.has(use.name) || seen.has(`${use.from}:${use.name}`)) continue;
    seen.add(`${use.from}:${use.name}`);
    const indent = lineIndent(source, use.lineStart);
    diagnostics.push({
      ruleId: "undefined-class",
      severity: "warning",
      subject: use.name,
      message: `Class "${use.name}" is used here but has no classDef.`,
      from: use.from,
      to: use.to,
      line: use.line,
      column: use.column,
      fixes: [
        {
          id: "create-class",
          title: `Create class ${use.name}`,
          edits: [
            {
              from: use.lineStart,
              to: use.lineStart,
              insert: `${indent}classDef ${use.name} fill:#f9f,stroke:#333\n`,
            },
          ],
        },
      ],
    });
  }
  return diagnostics;
}

function brokenClicks(model: Model, paths: readonly string[], sourcePath: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  for (const click of model.clicks) {
    if (diagramTargetExists(click.target, paths, sourcePath)) continue;
    const resolved = resolveDiagramTarget(click.target, sourcePath);
    const message =
      resolved.ok === false && resolved.reason === "escape"
        ? `The click link "${click.target}" leaves the workspace and does not match a diagram.`
        : `The click link "${click.target}" does not match a diagram in this workspace.`;
    diagnostics.push({
      ruleId: "broken-click",
      severity: "warning",
      subject: click.target,
      message,
      from: click.from,
      to: click.to,
      line: click.line,
      column: click.column,
      fixes: [],
    });
  }
  return diagnostics;
}

function lintFrontMatter(source: string): LintDiagnostic[] {
  const parsed = parseDiagram(source);
  const diagnostics: LintDiagnostic[] = [];
  if (parsed.malformed) {
    const line = parsed.errorLine ?? 1;
    const span = lineSpan(source, line);
    const detail = parsed.error ? ` ${parsed.error}` : "";
    diagnostics.push({
      ruleId: "front-matter",
      severity: "error",
      message: `The YAML header could not be parsed.${detail}`,
      ...span,
      fixes: [],
    });
  }
  if (parsed.initError) {
    const at = indexOfToken(source, "%%{init") ?? indexOfToken(source, "%%{initialize") ?? lineSpan(source, 1);
    diagnostics.push({
      ruleId: "front-matter",
      severity: "warning",
      message: `The %%{init}%% directive could not be read. ${parsed.initError}`,
      ...at,
      fixes: [],
    });
  }
  if (parsed.malformed || !parsed.hasFrontMatter) return diagnostics;

  const headerEnd = bodyStart(source);
  const header = source.slice(0, headerEnd);
  const known = new Set<string>(MERMAID_THEMES);
  if (parsed.theme && !known.has(parsed.theme)) {
    diagnostics.push(fieldWarning(header, "theme", parsed.theme, `Theme "${parsed.theme}" is not a Mermaid theme.`));
  }
  if (parsed.look && !MERMAID_LOOKS.includes(parsed.look as (typeof MERMAID_LOOKS)[number])) {
    diagnostics.push(fieldWarning(header, "look", parsed.look, `Look "${parsed.look}" is not classic, handDrawn, or neo.`));
  }
  if (parsed.layout && !MERMAID_LAYOUTS.includes(parsed.layout as (typeof MERMAID_LAYOUTS)[number])) {
    diagnostics.push(fieldWarning(header, "layout", parsed.layout, `Layout "${parsed.layout}" is not dagre or elk.`));
  }
  if (parsed.flowchartCurve && !FLOWCHART_CURVES.includes(parsed.flowchartCurve as (typeof FLOWCHART_CURVES)[number])) {
    diagnostics.push(
      fieldWarning(header, "curve", parsed.flowchartCurve, `Curve "${parsed.flowchartCurve}" is not a Mermaid flowchart curve.`),
    );
  }
  const placement = parsed.elk.nodePlacementStrategy;
  if (typeof placement === "string" && !ELK_NODE_PLACEMENTS.includes(placement as (typeof ELK_NODE_PLACEMENTS)[number])) {
    diagnostics.push(
      fieldWarning(
        header,
        "nodePlacementStrategy",
        placement,
        `ELK node placement "${placement}" is not one of the supported strategies.`,
      ),
    );
  }

  const match = matchFrontMatter(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  if (!match) return diagnostics;
  const doc = parseDocument(match.body, { schema: "core", prettyErrors: false });
  if (doc.errors.length > 0) return diagnostics;
  const raw = doc.toJS();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return diagnostics;
  const data = raw as Record<string, unknown>;
  if (data.title != null && (typeof data.title === "object" || Array.isArray(data.title))) {
    diagnostics.push(fieldWarning(header, "title", "", "The title has to be text."));
  }
  const nerdgram = data.nerdgram;
  if (nerdgram && typeof nerdgram === "object" && !Array.isArray(nerdgram)) {
    const block = nerdgram as Record<string, unknown>;
    if ("tags" in block && !Array.isArray(block.tags)) {
      diagnostics.push(fieldWarning(header, "tags", "", "Tags have to be a list of names."));
    }
    if (block.description != null && typeof block.description === "object") {
      diagnostics.push(fieldWarning(header, "description", "", "The description has to be text."));
    }
  }
  return diagnostics;
}

function fieldWarning(header: string, key: string, value: string, message: string): LintDiagnostic {
  const found = findField(header, key, value) ?? lineSpan(header, 1);
  return {
    ruleId: "front-matter",
    severity: "warning",
    message,
    ...found,
    fixes: [],
  };
}

function findField(header: string, key: string, value: string): Span | null {
  let start = 0;
  let lineNo = 1;
  for (const line of header.split(/\n/)) {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`);
    if (pattern.test(text) && (value === "" || text.includes(value))) {
      const valueAt = value ? text.indexOf(value) : text.indexOf(":") + 1;
      const from = start + Math.max(0, valueAt);
      const to = value ? from + value.length : start + text.length;
      return pointSpan(header, from, Math.max(to, from + 1));
    }
    start += line.length + 1;
    lineNo += 1;
    if (lineNo > 10_000) break;
  }
  return null;
}

function readClassDef(line: string, lineStart: number, lineNo: number, source: string, model: Model): boolean {
  const match = new RegExp(`^(\\s*)classDef\\s+(${ID}(?:\\s*,\\s*${ID})*)\\b`, "i").exec(line);
  if (!match || match[1] == null || match[2] == null) return false;
  const names = match[2].split(/\s*,\s*/);
  const statement = lineStatementSpan(source, lineStart, line.length);
  let cursor = match[1].length + "classDef".length;
  for (const name of names) {
    const at = line.indexOf(name, cursor);
    if (at < 0) continue;
    const from = lineStart + at;
    model.classDefs.push({
      name,
      from,
      to: from + name.length,
      line: lineNo,
      column: at + 1,
      statementFrom: statement.from,
      statementTo: statement.to,
    });
    cursor = at + name.length;
  }
  return true;
}

function readClassStatement(line: string, lineStart: number, lineNo: number, model: Model): boolean {
  const match = new RegExp(`^\\s*class\\s+${ID}(?:\\s*,\\s*${ID})*\\s+(${ID})\\s*;?\\s*$`, "i").exec(line);
  if (!match || match[1] == null) return false;
  const name = match[1];
  const at = line.lastIndexOf(name);
  if (at < 0) return false;
  const from = lineStart + at;
  model.classUses.push({
    name,
    from,
    to: from + name.length,
    line: lineNo,
    column: at + 1,
    lineStart,
  });
  return true;
}

function readClick(line: string, lineStart: number, lineNo: number, model: Model): boolean {
  if (!/^\s*click\b/i.test(line)) return false;
  const click = parseClickLine(line, lineStart, lineNo);
  const target = click?.target.trim() ?? "";
  if (click && target && isDiagramLink(target)) {
    model.clicks.push({
      target,
      from: click.from,
      to: click.to,
      line: click.line,
      column: click.column,
    });
  }
  return true;
}

function collectInlineClasses(line: string, lineStart: number, lineNo: number, model: Model): void {
  const pattern = /:::([A-Za-z_][\w-]*)/g;
  for (const match of line.matchAll(pattern)) {
    const name = match[1];
    if (!name || match.index == null) continue;
    const from = lineStart + match.index + 3;
    model.classUses.push({
      name,
      from,
      to: from + name.length,
      line: lineNo,
      column: match.index + 4,
      lineStart,
    });
  }
}

function scanFlowchartLine(line: string, lineStart: number, lineNo: number, model: Model): void {
  const trimmed = line.trim();
  if (/^(?:flowchart(?:-elk)?|graph|direction|style|linkStyle|subgraph|end)\b/i.test(trimmed)) return;
  for (const statement of splitStatements(line)) {
    const absolute = lineStart + statement.offset;
    const pieces = splitArrows(statement.text);
    if (pieces.length === 1 && pieces[0] && !pieces[0].arrow) {
      for (const node of readNodes(pieces[0].text, absolute + pieces[0].offset, lineNo, true)) model.nodes.push(node);
      continue;
    }
    const groups = pieces.map((piece) => readNodes(piece.text, absolute + piece.offset, lineNo, false));
    for (const group of groups) model.nodes.push(...group);
    for (let index = 0; index < groups.length - 1; index += 1) {
      const left = groups[index] ?? [];
      const right = groups[index + 1] ?? [];
      for (const from of left) {
        for (const to of right) {
          model.edges.push({ fromId: from.id, toId: to.id, fromSpan: from, toSpan: to });
        }
      }
    }
  }
}

function scanSequenceLine(line: string, lineStart: number, lineNo: number, model: Model): void {
  const declared = new RegExp(`^\\s*(?:participant|actor)\\s+(${ID})(?:\\s+as\\s+(.+?))?\\s*$`, "i").exec(line);
  if (declared && declared[1]) {
    const id = declared[1];
    const at = line.indexOf(id);
    const from = lineStart + Math.max(0, at);
    const alias = declared[2]?.trim();
    model.nodes.push({
      id,
      label: alias && alias.length > 0 ? alias : id,
      defined: true,
      from,
      to: from + id.length,
      line: lineNo,
      column: Math.max(1, at + 1),
    });
    return;
  }
  const message = new RegExp(`^\\s*(${ID})\\s*-{1,2}(?:>>|[>x)])[+-]?\\s*(${ID})\\s*:`).exec(line);
  if (!message || !message[1] || !message[2]) return;
  const fromNode = sequenceEndpoint(line, lineStart, lineNo, message[1]);
  const toNode = sequenceEndpoint(line, lineStart, lineNo, message[2], message[1]);
  if (!fromNode || !toNode) return;
  model.nodes.push(fromNode, toNode);
  model.edges.push({ fromId: fromNode.id, toId: toNode.id, fromSpan: fromNode, toSpan: toNode });
}

function sequenceEndpoint(line: string, lineStart: number, lineNo: number, id: string, skip?: string): NodeHit | null {
  const fromIndex = skip ? line.indexOf(skip) + skip.length : 0;
  const at = line.indexOf(id, fromIndex);
  if (at < 0) return null;
  const from = lineStart + at;
  return {
    id,
    label: null,
    defined: false,
    from,
    to: from + id.length,
    line: lineNo,
    column: at + 1,
  };
}

function scanStateLine(line: string, lineStart: number, lineNo: number, model: Model): void {
  if (/^\s*stateDiagram(?:-v2)?\b/i.test(line)) return;
  const named = /^\s*state\s+"([^"]*)"\s+as\s+([A-Za-z_][\w-]*)/i.exec(line);
  if (named && named[2]) {
    const id = named[2];
    const at = line.lastIndexOf(id);
    const from = lineStart + at;
    model.nodes.push({
      id,
      label: named[1]?.trim() ?? "",
      defined: true,
      from,
      to: from + id.length,
      line: lineNo,
      column: at + 1,
    });
  } else {
    const bare = /^\s*state\s+([A-Za-z_][\w-]*)\b/i.exec(line);
    if (bare && bare[1]) {
      const id = bare[1];
      const at = line.indexOf(id);
      const from = lineStart + at;
      model.nodes.push({
        id,
        label: id,
        defined: true,
        from,
        to: from + id.length,
        line: lineNo,
        column: at + 1,
      });
    }
  }
  const transition = /^\s*(\[\*\]|[A-Za-z_][\w-]*)\s*-->\s*(\[\*\]|[A-Za-z_][\w-]*)/.exec(line);
  if (!transition || !transition[1] || !transition[2]) return;
  const ends = [transition[1], transition[2]]
    .filter((id) => id !== "[*]")
    .map((id) => stateEndpoint(line, lineStart, lineNo, id))
    .filter((node): node is NodeHit => node != null);
  for (const node of ends) model.nodes.push(node);
  if (ends.length === 2 && ends[0] && ends[1]) {
    model.edges.push({ fromId: ends[0].id, toId: ends[1].id, fromSpan: ends[0], toSpan: ends[1] });
  }
}

function stateEndpoint(line: string, lineStart: number, lineNo: number, id: string): NodeHit | null {
  const at = line.indexOf(id);
  if (at < 0) return null;
  const from = lineStart + at;
  return { id, label: null, defined: false, from, to: from + id.length, line: lineNo, column: at + 1 };
}

type Piece = { text: string; offset: number; arrow: boolean };

function splitStatements(line: string): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quote) {
      if (char === quote && line[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "(" || char === "{") depth += 1;
    else if (char === "]" || char === ")" || char === "}") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      parts.push({ text: line.slice(start, index), offset: start });
      start = index + 1;
    }
  }
  parts.push({ text: line.slice(start), offset: start });
  return parts.filter((part) => part.text.trim().length > 0);
}

function splitArrows(text: string): Piece[] {
  const pieces: Piece[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "(" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === "]" || char === ")" || char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    const length = matchArrow(text, index);
    if (!length) continue;
    pieces.push({ text: text.slice(start, index), offset: start, arrow: false });
    start = index + length;
    index += length - 1;
  }
  pieces.push({ text: text.slice(start), offset: start, arrow: false });
  return pieces;
}

function matchArrow(text: string, index: number): number {
  if (text.startsWith("--", index) && /\s/.test(text[index + 2] ?? "") && !text.startsWith("---", index)) {
    for (let cursor = index + 2; cursor < text.length; cursor += 1) {
      if (text.startsWith("-->", cursor) || text.startsWith("---", cursor)) return cursor + 3 - index;
    }
  }
  for (const arrow of SIMPLE_ARROWS) {
    if (!text.startsWith(arrow, index)) continue;
    let length = arrow.length;
    if (text[index + length] === "|") {
      const close = text.indexOf("|", index + length + 1);
      if (close !== -1) length = close + 1 - index;
    }
    return length;
  }
  return 0;
}

function readNodes(text: string, base: number, lineNo: number, defined: boolean): NodeHit[] {
  const nodes: NodeHit[] = [];
  let depth = 0;
  let quote: string | null = null;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (depth > 0) {
      if (char === "[" || char === "(" || char === "{") depth += 1;
      else if (char === "]" || char === ")" || char === "}") depth -= 1;
      index += 1;
      continue;
    }
    if (/\s/.test(char) || char === "&" || char === ";") {
      index += 1;
      continue;
    }
    const idMatch = new RegExp(`^${ID}`).exec(text.slice(index));
    if (!idMatch) {
      index += 1;
      continue;
    }
    const id = idMatch[0];
    const idFrom = base + index;
    let cursor = index + id.length;
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
    const shape = readShape(text, cursor);
    if (shape) {
      nodes.push({
        id,
        label: cleanLabel(shape.label),
        defined: true,
        from: idFrom,
        to: idFrom + id.length,
        line: lineNo,
        column: index + 1,
      });
      index = shape.end;
      continue;
    }
    nodes.push({
      id,
      label: null,
      defined,
      from: idFrom,
      to: idFrom + id.length,
      line: lineNo,
      column: index + 1,
    });
    index = cursor;
  }
  return nodes;
}

function readShape(text: string, index: number): { label: string; end: number } | null {
  if (text.startsWith("@{", index)) {
    const end = text.indexOf("}", index + 2);
    if (end === -1) return null;
    const inner = text.slice(index + 2, end);
    const labeled = /label\s*:\s*(?:"([^"]*)"|([^,}]+))/.exec(inner);
    return { label: (labeled?.[1] ?? labeled?.[2] ?? "").trim(), end: end + 1 };
  }
  const pairs: [string, string[]][] = [
    ["[[", ["]]"]],
    ["[(", [")]"]],
    ["([", ["])"]],
    ["((", ["))"]],
    ["[/", ["/]", "\\]"]],
    ["[\\", ["\\]", "/]"]],
    ["{{", ["}}"]],
    ["[", ["]"]],
    ["(", [")"]],
    ["{", ["}"]],
    [">", ["]"]],
  ];
  for (const [open, closes] of pairs) {
    if (!text.startsWith(open, index)) continue;
    const found = findCloser(text, index + open.length, open, closes);
    if (!found) return null;
    return { label: text.slice(index + open.length, found), end: found + (closes.find((close) => text.startsWith(close, found))?.length ?? 1) };
  }
  return null;
}

function findCloser(text: string, from: number, open: string, closes: string[]): number | null {
  let depth = 1;
  for (let index = from; index < text.length; index += 1) {
    if (text.startsWith(open, index) && open !== ">") {
      depth += 1;
      index += open.length - 1;
      continue;
    }
    const close = closes.find((item) => text.startsWith(item, index));
    if (!close) continue;
    depth -= 1;
    if (depth === 0) return index;
    index += close.length - 1;
  }
  return null;
}

function cleanLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function freshId(id: string, used: Set<string>): string {
  for (let number = 2; number < 200; number += 1) {
    const next = `${id}${number}`;
    if (!used.has(next)) return next;
  }
  return `${id}_${used.size + 2}`;
}

function lineIndent(source: string, lineStart: number): string {
  const match = /^[ \t]*/.exec(source.slice(lineStart));
  return match?.[0] ?? "";
}

function lineStatementSpan(source: string, lineStart: number, lineLength: number): { from: number; to: number } {
  let to = lineStart + lineLength;
  if (source[to] === "\r") to += 1;
  if (source[to] === "\n") to += 1;
  return { from: lineStart, to };
}

function bodyStart(source: string): number {
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const text = bom ? source.slice(bom) : source;
  const body = parseDiagram(source).body;
  return bom + (text.length - body.length);
}

function eachLine(
  source: string,
  from: number,
  to: number,
  visit: (line: string, start: number, number: number) => void,
): void {
  const end = Math.max(from, Math.min(to, source.length));
  let start = from;
  let number = lineNumberAt(source, from);
  for (let index = from; index <= end; index += 1) {
    if (index !== end && source[index] !== "\n") continue;
    let textEnd = index;
    if (textEnd > start && source[textEnd - 1] === "\r") textEnd -= 1;
    if (textEnd > start || index === end) visit(source.slice(start, textEnd), start, number);
    number += 1;
    start = index + 1;
  }
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

function pointSpan(source: string, from: number, to: number): Span {
  const line = lineNumberAt(source, from);
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  return { from, to: Math.max(to, from + 1), line, column: from - lineStart + 1 };
}

function lineSpan(source: string, line: number): Span {
  let number = 1;
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index !== source.length && source[index] !== "\n") continue;
    if (number === line) {
      let textEnd = index;
      if (textEnd > start && source[textEnd - 1] === "\r") textEnd -= 1;
      const from = start;
      const to = Math.max(textEnd, from + 1);
      return { from, to, line, column: 1 };
    }
    number += 1;
    start = index + 1;
  }
  return { from: 0, to: Math.min(1, source.length), line: 1, column: 1 };
}

function indexOfToken(source: string, token: string): Span | null {
  const from = source.indexOf(token);
  if (from < 0) return null;
  return pointSpan(source, from, from + token.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
