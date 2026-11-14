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
 * The rules are plain text analysis so `nerdgram lint` can run them without
 * a browser. Syntax errors are added by `lintDiagramSource`, which asks
 * Mermaid's parser. When the diagram database is available, the editor
 * confirms flowchart, sequence, and state warnings against that database.
 * Class, ER, Gantt, mindmap, and timeline diagrams are checked from the
 * same text, which is the structure those diagrams give a line scanner.
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
  {
    id: "duplicate-class",
    label: "Duplicate classes",
    description: "The same class name is defined again with a different label.",
  },
  {
    id: "undeclared-class",
    label: "Undeclared classes",
    description:
      "A class diagram relationship names a class that was never declared. A diagram that only uses relationships is left alone.",
  },
  {
    id: "duplicate-attribute",
    label: "Duplicate attributes",
    description: "An entity lists the same attribute more than once.",
  },
  {
    id: "undeclared-entity",
    label: "Undeclared entities",
    description:
      "An ER relationship names an entity that was never declared. A diagram that only uses relationships is left alone.",
  },
  {
    id: "missing-dependency",
    label: "Missing task ids",
    description: "A Gantt task depends on an id that no task defines.",
  },
  {
    id: "invalid-date",
    label: "Invalid dates",
    description: "A Gantt date does not match the diagram dateFormat, or is not a real calendar date.",
  },
  {
    id: "duplicate-sibling",
    label: "Duplicate siblings",
    description: "A mindmap repeats a label under the same parent, or a timeline repeats an event in one period.",
  },
  {
    id: "empty-node",
    label: "Empty nodes",
    description: "A mindmap node or a timeline event has no text.",
  },
] as const;

export type LintRuleId = (typeof LINT_RULES)[number]["id"];

export const LINT_RULE_IDS: readonly LintRuleId[] = LINT_RULES.map((rule) => rule.id);

export type LintEdit = {
  from: number;
  to: number;
  insert: string;
};

export type LintFixId =
  | "rename-duplicate"
  | "remove-classdef"
  | "create-class"
  | "jump-to-definition"
  | "repair-links"
  | "declare-class"
  | "declare-entity"
  | "remove-attribute"
  | "remove-node";

export type LintFix = {
  id: LintFixId;
  title: string;
  edits: LintEdit[];
  /** Set for "Jump to definition". The edits list is empty, so the text stays the same. */
  jump?: { from: number; to: number };
};

export type LintDiagnostic = {
  /** `"parse"` is a Mermaid syntax error. It is not a switch in Diagram checks. */
  ruleId: LintRuleId | "parse";
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

type DiagramKind = "flowchart" | "sequence" | "state" | "class" | "er" | "gantt" | "mindmap" | "timeline" | "other";

type Model = {
  kind: DiagramKind;
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

/** Lint one diagram. Mermaid syntax errors are added by `lintDiagramSource`. */
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
  if (model.kind === "class" && (enabled["duplicate-class"] || enabled["undeclared-class"])) {
    const classDiagram = scanClassDiagram(source);
    if (enabled["duplicate-class"]) diagnostics.push(...duplicateClasses(classDiagram));
    if (enabled["undeclared-class"]) diagnostics.push(...undeclaredClasses(classDiagram));
  }
  if (model.kind === "er" && (enabled["duplicate-attribute"] || enabled["undeclared-entity"])) {
    const erDiagram = scanErDiagram(source);
    if (enabled["duplicate-attribute"]) diagnostics.push(...duplicateAttributes(erDiagram));
    if (enabled["undeclared-entity"]) diagnostics.push(...undeclaredEntities(erDiagram));
  }
  if (model.kind === "gantt" && (enabled["missing-dependency"] || enabled["invalid-date"])) {
    const gantt = scanGantt(source);
    if (enabled["missing-dependency"]) diagnostics.push(...gantt.dependencies);
    if (enabled["invalid-date"]) diagnostics.push(...gantt.dates);
  }
  if ((model.kind === "mindmap" || model.kind === "timeline") && (enabled["duplicate-sibling"] || enabled["empty-node"])) {
    const outline = model.kind === "mindmap" ? scanMindmap(source) : scanTimeline(source);
    if (enabled["duplicate-sibling"]) diagnostics.push(...outline.duplicates);
    if (enabled["empty-node"]) diagnostics.push(...outline.empties);
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

function diagramKind(body: string): DiagramKind {
  const key = diagramConfigKey(body);
  if (key === "flowchart") return "flowchart";
  if (key === "sequence") return "sequence";
  if (key === "state") return "state";
  if (key === "class") return "class";
  if (key === "er") return "er";
  if (key === "gantt") return "gantt";
  if (key === "mindmap") return "mindmap";
  if (key === "timeline") return "timeline";
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
    const fixes: LintFix[] = [];
    if (resolved.ok) {
      fixes.push({ id: "repair-links", title: "Repair links", edits: [] });
    }
    diagnostics.push({
      ruleId: "broken-click",
      severity: "warning",
      subject: click.target,
      message,
      from: click.from,
      to: click.to,
      line: click.line,
      column: click.column,
      fixes,
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
  const declared = /^\s*(?:participant|actor)\s+(\S+?)(?:\s+as\s+(.+?))?\s*$/i.exec(line);
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
  // The name is non-greedy so `-->>` keeps its hyphens instead of lending one to the id.
  const message = /^\s*(\S+?)\s*(--?(?:>>|[>x)]))[+-]?\s*(\S+?)\s*:/.exec(line);
  if (!message || !message[1] || !message[3]) return;
  const fromNode = sequenceEndpoint(line, lineStart, lineNo, message[1]);
  const toNode = sequenceEndpoint(line, lineStart, lineNo, message[3], message[1]);
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

type ClassDecl = Span & { id: string; label: string | null };

type ClassUse = Span & { id: string; lineStart: number; indent: string };

type ClassDiagramScan = { decls: ClassDecl[]; declared: string[]; uses: ClassUse[] };

type ClassToken = { id: string; from: number; to: number; next: number };

const CLASS_ARROWS = [
  "<|--|>",
  "--|>",
  "<|--",
  "<|..",
  "*--",
  "--*",
  "o--",
  "--o",
  "<-->",
  "-->",
  "<--",
  "..|>",
  "<|..",
  "..>",
  "<..",
  "--",
  "..",
];

const CLASS_SKIP = new Set([
  "classdiagram",
  "direction",
  "note",
  "style",
  "cssclass",
  "classdef",
  "click",
  "link",
  "callback",
  "acctitle",
  "accdescr",
]);

function scanClassDiagram(source: string): ClassDiagramScan {
  const decls: ClassDecl[] = [];
  const declared: string[] = [];
  const uses: ClassUse[] = [];
  let depth = 0;
  walkBody(source, (line, lineStart) => {
    const word = firstWord(line);
    if (word === "namespace") return;
    if (depth === 0 && !CLASS_SKIP.has(word)) {
      if (word === "class") {
        const decl = readClassDeclaration(source, line, lineStart);
        if (decl) {
          decls.push(decl);
          declared.push(decl.id);
        }
      } else {
        const arrow = findClassArrow(line);
        if (arrow) {
          const left = lastClassToken(line.slice(0, arrow.index));
          const rightAt = arrow.index + arrow.length;
          const right = firstClassToken(line.slice(rightAt));
          if (left) uses.push(classUse(source, lineStart, left));
          if (right) {
            uses.push(classUse(source, lineStart, { id: right.id, from: right.from + rightAt, to: right.to + rightAt }));
          }
        } else {
          const member = readClassMember(line);
          if (member) declared.push(member.id);
        }
      }
    }
    depth = Math.max(0, depth + netBraces(line));
  });
  return { decls, declared, uses };
}

function duplicateClasses(scan: ClassDiagramScan): LintDiagnostic[] {
  const groups = new Map<string, ClassDecl[]>();
  const used = new Set<string>(scan.declared);
  for (const use of scan.uses) used.add(use.id);
  for (const decl of scan.decls) {
    used.add(decl.id);
    const list = groups.get(decl.id) ?? [];
    list.push(decl);
    groups.set(decl.id, list);
  }
  const diagnostics: LintDiagnostic[] = [];
  for (const [id, decls] of groups) {
    let explicit: string | null = null;
    let sawUnlabeled = false;
    let origin: ClassDecl | null = null;
    for (const decl of decls) {
      if (!origin) origin = decl;
      if (decl.label == null) {
        sawUnlabeled = true;
        continue;
      }
      if (explicit == null) {
        if (sawUnlabeled && decl.label !== id && origin) {
          diagnostics.push(duplicateClassDiagnostic(id, decl, id, origin, used));
        }
        explicit = decl.label;
        if (!sawUnlabeled) origin = decl;
        continue;
      }
      if (decl.label !== explicit && origin) diagnostics.push(duplicateClassDiagnostic(id, decl, explicit, origin, used));
    }
  }
  return diagnostics;
}

function duplicateClassDiagnostic(
  id: string,
  decl: ClassDecl,
  firstLabel: string,
  origin: ClassDecl,
  used: Set<string>,
): LintDiagnostic {
  const nextId = freshId(id, used);
  used.add(nextId);
  return {
    ruleId: "duplicate-class",
    severity: "warning",
    subject: id,
    message: `Class "${id}" is defined again with a different label ("${decl.label || "empty"}"). The first label is "${firstLabel || "empty"}".`,
    from: decl.from,
    to: decl.to,
    line: decl.line,
    column: decl.column,
    fixes: [
      {
        id: "rename-duplicate",
        title: `Rename to ${formatClassId(nextId)}`,
        edits: [{ from: decl.from, to: decl.to, insert: formatClassId(nextId) }],
      },
      {
        id: "jump-to-definition",
        title: "Jump to definition",
        edits: [],
        jump: { from: origin.from, to: origin.to },
      },
    ],
  };
}

function undeclaredClasses(scan: ClassDiagramScan): LintDiagnostic[] {
  const declared = new Set(scan.declared);
  if (declared.size === 0) return [];
  const diagnostics: LintDiagnostic[] = [];
  const seen = new Set<string>();
  for (const use of scan.uses) {
    if (!use.id || declared.has(use.id) || seen.has(use.id)) continue;
    seen.add(use.id);
    diagnostics.push({
      ruleId: "undeclared-class",
      severity: "warning",
      subject: use.id,
      message: `This relationship uses "${use.id}", which was never declared. That is often a typo.`,
      from: use.from,
      to: use.to,
      line: use.line,
      column: use.column,
      fixes: [
        {
          id: "declare-class",
          title: `Declare class ${use.id}`,
          edits: [{ from: use.lineStart, to: use.lineStart, insert: `${use.indent}class ${formatClassId(use.id)}\n` }],
        },
      ],
    });
  }
  return diagnostics;
}

type ErSide = { id: string; from: number; to: number };

type ErEntity = Span & { id: string; lineStart: number; indent: string };

type ErAttribute = Span & { entity: string; name: string; statementFrom: number; statementTo: number };

type ErDiagramScan = { entities: ErEntity[]; attributes: ErAttribute[]; uses: ErEntity[] };

const ER_SKIP = new Set(["erdiagram", "direction", "style", "classdef", "click", "acctitle", "accdescr", "title"]);

function scanErDiagram(source: string): ErDiagramScan {
  const entities: ErEntity[] = [];
  const attributes: ErAttribute[] = [];
  const uses: ErEntity[] = [];
  let current: string | null = null;
  walkBody(source, (line, lineStart) => {
    if (current) {
      if (line.trim() === "}") {
        current = null;
        return;
      }
      const attribute = readAttribute(line);
      if (attribute) {
        const statement = lineStatementSpan(source, lineStart, line.length);
        attributes.push({
          ...pointSpan(source, lineStart + attribute.from, lineStart + attribute.to),
          entity: current,
          name: attribute.name,
          statementFrom: statement.from,
          statementTo: statement.to,
        });
      }
      return;
    }
    if (ER_SKIP.has(firstWord(line))) return;
    const relation = readErRelationship(line);
    if (relation) {
      for (const side of [relation.left, relation.right]) {
        uses.push({
          ...pointSpan(source, lineStart + side.from, lineStart + side.to),
          id: side.id,
          lineStart,
          indent: lineIndent(source, lineStart),
        });
      }
      return;
    }
    const entity = readBareEntity(line);
    if (!entity) return;
    entities.push({
      ...pointSpan(source, lineStart + entity.from, lineStart + entity.to),
      id: entity.id,
      lineStart,
      indent: lineIndent(source, lineStart),
    });
    if (entity.opensBlock) current = entity.id;
  });
  return { entities, attributes, uses };
}

function duplicateAttributes(scan: ErDiagramScan): LintDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: LintDiagnostic[] = [];
  for (const attribute of scan.attributes) {
    const key = `${attribute.entity}\0${attribute.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    diagnostics.push({
      ruleId: "duplicate-attribute",
      severity: "warning",
      subject: attribute.name,
      message: `Attribute "${attribute.name}" is listed again on "${attribute.entity}".`,
      from: attribute.from,
      to: attribute.to,
      line: attribute.line,
      column: attribute.column,
      fixes: [
        {
          id: "remove-attribute",
          title: "Remove duplicate attribute",
          edits: [{ from: attribute.statementFrom, to: attribute.statementTo, insert: "" }],
        },
      ],
    });
  }
  return diagnostics;
}

function undeclaredEntities(scan: ErDiagramScan): LintDiagnostic[] {
  if (scan.entities.length === 0) return [];
  const declared = new Set(scan.entities.map((entity) => entity.id));
  const diagnostics: LintDiagnostic[] = [];
  const seen = new Set<string>();
  for (const use of scan.uses) {
    if (!use.id || declared.has(use.id) || seen.has(use.id)) continue;
    seen.add(use.id);
    diagnostics.push({
      ruleId: "undeclared-entity",
      severity: "warning",
      subject: use.id,
      message: `This relationship uses "${use.id}", which was never declared. That is often a typo.`,
      from: use.from,
      to: use.to,
      line: use.line,
      column: use.column,
      fixes: [
        {
          id: "declare-entity",
          title: `Declare entity ${use.id}`,
          edits: [{ from: use.lineStart, to: use.lineStart, insert: `${use.indent}${formatEntityId(use.id)}\n` }],
        },
      ],
    });
  }
  return diagnostics;
}

type GanttScan = { dependencies: LintDiagnostic[]; dates: LintDiagnostic[] };

const GANTT_TAGS = new Set(["active", "done", "crit", "milestone", "vert"]);
const GANTT_SKIP = new Set([
  "gantt",
  "title",
  "section",
  "axisformat",
  "tickinterval",
  "weekend",
  "weekday",
  "todaymarker",
  "inclusiveenddates",
  "topaxis",
  "acctitle",
  "accdescr",
]);
const WEEKDAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "weekends"]);

function scanGantt(source: string): GanttScan {
  const tasks: { id: string | null; deps: (Span & { id: string })[] }[] = [];
  const checked: (Span & { text: string; verdict: "ok" | "shape" | "calendar"; format: string })[] = [];
  let formatLabel = "YYYY-MM-DD";
  let checker = compileDateFormat(formatLabel);
  const noteDate = (token: Span & { text: string }) => {
    if (!checker) return;
    checked.push({ ...token, verdict: checker(token.text), format: formatLabel });
  };
  walkBody(source, (line, lineStart) => {
    const word = firstWord(line);
    if (word === "dateformat") {
      const format = line.replace(/^\s*dateFormat\s+/i, "").trim();
      formatLabel = format || formatLabel;
      checker = compileDateFormat(format);
      return;
    }
    if (word === "excludes") {
      const prefix = /^\s*excludes\s+/i.exec(line);
      const rest = line.slice(prefix?.[0].length ?? 0);
      for (const token of textTokens(rest)) {
        if (WEEKDAYS.has(token.text.toLowerCase()) || !/\d/.test(token.text)) continue;
        const from = lineStart + (prefix?.[0].length ?? 0) + token.from;
        noteDate({ ...pointSpan(source, from, from + token.text.length), text: token.text });
      }
      return;
    }
    if (GANTT_SKIP.has(word) || !line.includes(":")) return;
    const colon = line.indexOf(":");
    const data = line.slice(colon + 1);
    const parts = data
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    while (parts.length > 0 && GANTT_TAGS.has((parts[0] ?? "").toLowerCase())) parts.shift();
    let id: string | null = null;
    let start = "";
    let end = "";
    if (parts.length >= 3) {
      id = parts[0] ?? null;
      start = parts[1] ?? "";
      end = parts[2] ?? "";
    } else if (parts.length === 2) {
      start = parts[0] ?? "";
      end = parts[1] ?? "";
    } else if (parts.length === 1) {
      end = parts[0] ?? "";
    }
    const deps: (Span & { id: string })[] = [];
    const dates: (Span & { text: string })[] = [];
    let searchFrom = 0;
    const take = (slot: string, role: "start" | "end") => {
      if (!slot) return;
      const at = data.indexOf(slot, searchFrom);
      if (at < 0) return;
      searchFrom = at + slot.length;
      collectGanttSlot(source, lineStart + colon + 1 + at, slot, role, deps, dates);
    };
    take(start, "start");
    take(end, "end");
    for (const date of dates) noteDate(date);
    tasks.push({ id, deps });
  });
  const ids = new Set(tasks.flatMap((task) => (task.id ? [task.id] : [])));
  const dependencies: LintDiagnostic[] = [];
  const seenDeps = new Set<string>();
  for (const task of tasks) {
    for (const dep of task.deps) {
      const key = `${dep.from}:${dep.id}`;
      if (ids.has(dep.id) || seenDeps.has(key)) continue;
      seenDeps.add(key);
      dependencies.push({
        ruleId: "missing-dependency",
        severity: "warning",
        subject: dep.id,
        message: `This task depends on "${dep.id}", which is not a task id in this diagram.`,
        from: dep.from,
        to: dep.to,
        line: dep.line,
        column: dep.column,
        fixes: [],
      });
    }
  }
  const dates: LintDiagnostic[] = [];
  for (const token of checked) {
    if (token.verdict === "ok") continue;
    dates.push({
      ruleId: "invalid-date",
      severity: "warning",
      subject: token.text,
      message:
        token.verdict === "calendar"
          ? `The date "${token.text}" is not a real calendar date.`
          : `The value "${token.text}" does not match ${token.format}.`,
      from: token.from,
      to: token.to,
      line: token.line,
      column: token.column,
      fixes: [],
    });
  }
  return { dependencies, dates };
}

type OutlineNode = { indent: number; label: string; span: Span; statementFrom: number; statementTo: number };

type OutlineScan = { duplicates: LintDiagnostic[]; empties: LintDiagnostic[] };

function scanMindmap(source: string): OutlineScan {
  const nodes: OutlineNode[] = [];
  walkBody(source, (line, lineStart) => {
    if (/^\s*mindmap\b/i.test(line) || /^\s*::/.test(line)) return;
    const lead = line.length - line.trimStart().length;
    const body = line.trim();
    if (!body) return;
    const parsed = mindmapLabel(body);
    const statement = lineStatementSpan(source, lineStart, line.length);
    const label = parsed.label.trim();
    const from = label ? lineStart + lead + parsed.from : lineStart + lead;
    const to = label ? lineStart + lead + parsed.to : lineStart + lead + body.length;
    nodes.push({
      indent: leadingIndent(line),
      label,
      span: pointSpan(source, from, to),
      statementFrom: statement.from,
      statementTo: statement.to,
    });
  });
  const duplicates: LintDiagnostic[] = [];
  const empties: LintDiagnostic[] = [];
  const stack: { indent: number; labels: Set<string> }[] = [{ indent: -1, labels: new Set() }];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? -1) >= node.indent) stack.pop();
    const parent = stack[stack.length - 1];
    const removable = !hasChild(nodes, index);
    const remove = (title: string): LintFix[] =>
      removable
        ? [{ id: "remove-node", title, edits: [{ from: node.statementFrom, to: node.statementTo, insert: "" }] }]
        : [];
    if (!node.label) {
      empties.push({
        ruleId: "empty-node",
        severity: "warning",
        message: "This mindmap node has no text.",
        ...node.span,
        fixes: remove("Remove empty node"),
      });
    } else if (parent?.labels.has(node.label)) {
      duplicates.push({
        ruleId: "duplicate-sibling",
        severity: "warning",
        subject: node.label,
        message: `Mindmap node "${node.label}" is repeated under the same parent.`,
        ...node.span,
        fixes: remove("Remove duplicate"),
      });
    } else {
      parent?.labels.add(node.label);
    }
    stack.push({ indent: node.indent, labels: new Set() });
  }
  return { duplicates, empties };
}

function scanTimeline(source: string): OutlineScan {
  const duplicates: LintDiagnostic[] = [];
  const empties: LintDiagnostic[] = [];
  let events = new Set<string>();
  walkBody(source, (line, lineStart) => {
    const word = firstWord(line);
    if (word === "timeline" || word === "title" || word === "acctitle" || word === "accdescr") return;
    if (word === "section") {
      events = new Set();
      return;
    }
    const pieces = splitTimeline(line);
    if (!pieces) return;
    const statement = lineStatementSpan(source, lineStart, line.length);
    if (pieces.period) events = new Set();
    for (const event of pieces.events) {
      const text = event.text.trim();
      const span = pointSpan(source, lineStart + event.from, lineStart + event.to);
      if (!text) {
        empties.push({
          ruleId: "empty-node",
          severity: "warning",
          message: "This timeline event has no text.",
          ...span,
          fixes: [timelineRemoval(event, lineStart, statement, "Remove empty node")],
        });
        continue;
      }
      if (events.has(text)) {
        duplicates.push({
          ruleId: "duplicate-sibling",
          severity: "warning",
          subject: text,
          message: `Timeline event "${text}" is repeated in this period.`,
          ...span,
          fixes: [timelineRemoval(event, lineStart, statement, "Remove duplicate")],
        });
        continue;
      }
      events.add(text);
    }
  });
  return { duplicates, empties };
}

function walkBody(source: string, visit: (line: string, lineStart: number, lineNo: number) => void): void {
  const start = bodyStart(source);
  const body = parseDiagram(source).body;
  eachLine(source, start, start + body.length, (line, lineStart, lineNo) => {
    if (!line.trim() || line.trimStart().startsWith("%%")) return;
    visit(line, lineStart, lineNo);
  });
}

function firstWord(line: string): string {
  return /^\s*([A-Za-z][\w-]*)/.exec(line)?.[1]?.toLowerCase() ?? "";
}

function readClassDeclaration(source: string, line: string, lineStart: number): ClassDecl | null {
  const match = /^\s*class\s+/i.exec(line);
  if (!match) return null;
  const token = firstClassToken(line.slice(match[0].length));
  if (!token) return null;
  const idFrom = match[0].length + token.from;
  let cursor = match[0].length + token.next;
  const bracket = readBracketLabel(line, cursor);
  const label = bracket ? bracket.label : null;
  return { ...pointSpan(source, lineStart + idFrom, lineStart + idFrom + (token.to - token.from)), id: token.id, label };
}

function readClassMember(line: string): { id: string } | null {
  const colon = findUnquotedColon(line);
  if (colon == null) return null;
  const tokens = classTokens(line.slice(0, colon));
  if (tokens.length !== 1) return null;
  return { id: tokens[0]?.id ?? "" };
}

function findClassArrow(line: string): { index: number; length: number } | null {
  let quote: string | null = null;
  let tick = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (tick) {
      if (char === "`") tick = false;
      continue;
    }
    if (quote) {
      if (char === quote && line[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "`") {
      tick = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    for (const arrow of CLASS_ARROWS) {
      if (line.startsWith(arrow, index)) return { index, length: arrow.length };
    }
  }
  return null;
}

function classTokens(text: string): ClassToken[] {
  const tokens: ClassToken[] = [];
  let index = 0;
  while (index < text.length) {
    const found = firstClassToken(text.slice(index));
    if (!found) break;
    tokens.push({ id: found.id, from: index + found.from, to: index + found.to, next: index + found.next });
    index += found.next > found.from ? found.next : found.to + 1;
    if (found.next <= found.from) break;
  }
  return tokens;
}

function firstClassToken(text: string): ClassToken | null {
  return classTokenAt(text, true);
}

function lastClassToken(text: string): ClassToken | null {
  const tokens = classTokens(text);
  return tokens[tokens.length - 1] ?? null;
}

function classTokenAt(text: string, firstOnly: boolean): ClassToken | null {
  let quote: string | null = null;
  let tick = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (tick) {
      if (char === "`") tick = false;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "`") {
      const end = text.indexOf("`", index + 1);
      if (end < 0) return null;
      const token = { id: text.slice(index + 1, end), from: index, to: end + 1, next: end + 1 };
      if (firstOnly) return token;
      tick = true;
      index = end;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    const match = /^[\p{L}_][\p{L}\p{N}_-]*/u.exec(text.slice(index));
    if (!match) continue;
    const id = match[0];
    let next = index + id.length;
    if (text[next] === "~") next = skipGeneric(text, next);
    return { id, from: index, to: index + id.length, next };
  }
  return null;
}

function skipGeneric(text: string, start: number): number {
  let last = start;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (/[\s[{}\]]/.test(char)) break;
    if (char === "~") last = index;
  }
  return last > start ? last + 1 : start;
}

function readBracketLabel(text: string, index: number): { label: string } | null {
  if (text[index] !== "[") return null;
  if (text[index + 1] === '"') {
    const endQuote = text.indexOf('"', index + 2);
    if (endQuote < 0 || text[endQuote + 1] !== "]") return null;
    return { label: text.slice(index + 2, endQuote) };
  }
  const close = text.indexOf("]", index + 1);
  if (close < 0) return null;
  return { label: text.slice(index + 1, close).trim() };
}

function classUse(source: string, lineStart: number, token: { id: string; from: number; to: number }): ClassUse {
  return {
    ...pointSpan(source, lineStart + token.from, lineStart + token.to),
    id: token.id,
    lineStart,
    indent: lineIndent(source, lineStart),
  };
}

function formatClassId(id: string): string {
  if (/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(id)) return id;
  return `\`${id.replace(/`/g, "")}\``;
}

function formatEntityId(id: string): string {
  if (/^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u.test(id)) return id;
  return `"${id.replace(/"/g, "")}"`;
}

function netBraces(line: string): number {
  let net = 0;
  let quote: string | null = null;
  let tick = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (tick) {
      if (char === "`") tick = false;
      continue;
    }
    if (quote) {
      if (char === quote && line[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "`") {
      tick = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") net += 1;
    else if (char === "}") net -= 1;
  }
  return net;
}

function findUnquotedColon(line: string): number | null {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ":") return index;
  }
  return null;
}

function readErRelationship(line: string): { left: ErSide; right: ErSide } | null {
  const labelAt = findLabelSeparator(line);
  const body = labelAt == null ? line : line.slice(0, labelAt);
  const left = readEntityAt(body, 0);
  const right = readEntityFromEnd(body);
  if (!left || !right || right.from < left.next) return null;
  const middle = body.slice(left.next, right.from);
  if (!/--|\.\.|\sto\s/i.test(middle)) return null;
  return { left, right };
}

function readBareEntity(line: string): (ErSide & { opensBlock: boolean }) | null {
  const token = readEntityAt(line, 0);
  if (!token) return null;
  const rest = line.slice(token.next).trim();
  if (rest === "") return { ...token, opensBlock: false };
  if (rest === "{" || (rest.startsWith("{") && !rest.includes("}"))) return { ...token, opensBlock: true };
  return null;
}

function readEntityAt(text: string, index: number): (ErSide & { next: number }) | null {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
  if (cursor >= text.length) return null;
  let id = "";
  let from = cursor;
  let to = cursor;
  if (text[cursor] === '"') {
    const end = text.indexOf('"', cursor + 1);
    if (end < 0) return null;
    id = text.slice(cursor + 1, end);
    from = cursor + 1;
    to = end;
    cursor = end + 1;
  } else {
    const match = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*/u.exec(text.slice(cursor));
    if (!match) return null;
    id = match[0];
    from = cursor;
    to = cursor + id.length;
    cursor = to;
  }
  let aliasAt = cursor;
  while (aliasAt < text.length && /\s/.test(text[aliasAt] ?? "")) aliasAt += 1;
  if (text[aliasAt] === "[") {
    const close = text.indexOf("]", aliasAt + 1);
    if (close >= 0) cursor = close + 1;
  }
  return { id, from, to, next: cursor };
}

function readEntityFromEnd(text: string): ErSide | null {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1] ?? "")) end -= 1;
  if (end === 0) return null;
  if (text[end - 1] === '"') {
    const start = text.lastIndexOf('"', end - 2);
    if (start < 0) return null;
    return { id: text.slice(start + 1, end - 1), from: start + 1, to: end - 1 };
  }
  let start = end;
  while (start > 0 && /[\p{L}\p{N}_.-]/u.test(text[start - 1] ?? "")) start -= 1;
  if (start === end) return null;
  const id = text.slice(start, end);
  if (!/^[\p{L}\p{N}_]/u.test(id)) return null;
  return { id, from: start, to: end };
}

function findLabelSeparator(line: string): number | null {
  let quote = false;
  for (let index = 0; index < line.length - 2; index += 1) {
    if (line[index] === '"') {
      quote = !quote;
      continue;
    }
    if (!quote && line.startsWith(" : ", index)) return index;
  }
  return null;
}

function readAttribute(line: string): { name: string; from: number; to: number } | null {
  const match = /^\s*([\p{L}][\p{L}\p{N}_[\]().?-]*)\s+\*?([\p{L}\p{N}_][\p{L}\p{N}_.-]*)/u.exec(line);
  const name = match?.[2];
  if (!match || !name) return null;
  const from = match[0].lastIndexOf(name);
  if (from < 0) return null;
  return { name, from, to: from + name.length };
}

function collectGanttSlot(
  source: string,
  base: number,
  slot: string,
  role: "start" | "end",
  deps: (Span & { id: string })[],
  dates: (Span & { text: string })[],
): void {
  const keyword = /^(after|until)\b/i.exec(slot);
  if (keyword?.[0]) {
    let searchFrom = keyword[0].length;
    for (const id of slot.slice(keyword[0].length).trim().split(/\s+/)) {
      if (!id) continue;
      const at = slot.indexOf(id, searchFrom);
      if (at < 0) continue;
      deps.push({ ...pointSpan(source, base + at, base + at + id.length), id });
      searchFrom = at + id.length;
    }
    return;
  }
  if (role === "end" && isDuration(slot)) return;
  dates.push({ ...pointSpan(source, base, base + slot.length), text: slot });
}

function isDuration(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:ms|s|m|h|d|w|M|y)$/.test(value);
}

function compileDateFormat(format: string): ((value: string) => "ok" | "shape" | "calendar") | null {
  const trimmed = format.trim();
  if (trimmed === "x" || trimmed === "X") return (value) => (/^\d+$/.test(value) ? "ok" : "shape");
  if (/MMM|DDD|ddd/.test(trimmed)) return null;
  const tokens = ["YYYY", "SSS", "YY", "MM", "DD", "HH", "mm", "ss"];
  let pattern = "";
  const groups: string[] = [];
  for (let index = 0; index < trimmed.length; ) {
    const token = tokens.find((item) => trimmed.startsWith(item, index));
    if (token) {
      const width = token === "YYYY" ? 4 : token === "SSS" ? 3 : 2;
      pattern += `(\\d{${width}})`;
      groups.push(token);
      index += token.length;
      continue;
    }
    const char = trimmed[index] ?? "";
    if (/[A-Za-z]/.test(char)) return null;
    pattern += escapeRegExp(char);
    index += 1;
  }
  if (groups.length === 0) return null;
  const regex = new RegExp(`^${pattern}$`);
  return (value) => {
    const match = regex.exec(value);
    if (!match) return "shape";
    return calendarOk(groups, match) ? "ok" : "calendar";
  };
}

function calendarOk(groups: string[], match: RegExpExecArray): boolean {
  const read = (token: string): number | null => {
    const index = groups.indexOf(token);
    if (index < 0) return null;
    return Number(match[index + 1]);
  };
  const month = read("MM");
  const day = read("DD");
  const hour = read("HH");
  const minute = read("mm");
  const second = read("ss");
  if (month != null && (month < 1 || month > 12)) return false;
  if (hour != null && hour > 23) return false;
  if (minute != null && minute > 59) return false;
  if (second != null && second > 59) return false;
  if (day == null) return true;
  if (day < 1 || day > 31) return false;
  if (month == null) return true;
  const year = read("YYYY") ?? (read("YY") != null ? 2000 + (read("YY") as number) : null);
  if (year == null && month === 2 && day === 29) return true;
  const days = new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();
  return day <= days;
}

function textTokens(text: string): { text: string; from: number }[] {
  const tokens: { text: string; from: number }[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    if (match.index == null) continue;
    tokens.push({ text: match[0], from: match.index });
  }
  return tokens;
}

function mindmapLabel(body: string): { label: string; from: number; to: number } {
  const id = /^[\p{L}_][\p{L}\p{N}_-]*/u.exec(body);
  const idLength = id?.[0].length ?? 0;
  const rest = body.slice(idLength);
  const pairs: [string, string][] = [
    ["((", "))"],
    ["))", "(("],
    ["{{", "}}"],
    ["[", "]"],
    ["(", ")"],
    [")", "("],
  ];
  for (const [open, close] of pairs) {
    if (!rest.startsWith(open)) continue;
    const end = rest.lastIndexOf(close);
    if (end < open.length) continue;
    return { label: unwrapLabel(rest.slice(open.length, end)), from: idLength + open.length, to: idLength + end };
  }
  return { label: unwrapLabel(body), from: 0, to: body.length };
}

function unwrapLabel(label: string): string {
  let text = label.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  if (text.length >= 2 && text.startsWith("`") && text.endsWith("`")) text = text.slice(1, -1).trim();
  return text;
}

function leadingIndent(line: string): number {
  const raw = /^[ \t]*/.exec(line)?.[0] ?? "";
  return raw.replace(/\t/g, "  ").length;
}

function hasChild(nodes: { indent: number }[], index: number): boolean {
  const node = nodes[index];
  if (!node) return false;
  for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
    const next = nodes[cursor];
    if (!next) continue;
    if (next.indent > node.indent) return true;
    return false;
  }
  return false;
}

type TimelineEvent = { text: string; from: number; to: number; dropFrom: number; dropTo: number; solo: boolean; only: boolean };

function splitTimeline(line: string): { period: { text: string; from: number; to: number } | null; events: TimelineEvent[] } | null {
  const marks: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== ":") continue;
    const before = index > 0 && /\s/.test(line[index - 1] ?? "");
    const after = index + 1 < line.length && /\s/.test(line[index + 1] ?? "");
    if (before || after || index === line.length - 1) marks.push(index);
  }
  if (marks.length === 0) return null;
  const headEnd = marks[0] ?? 0;
  const head = line.slice(0, headEnd).trim();
  const headAt = head ? line.indexOf(head) : 0;
  const period = head ? { text: head, from: headAt, to: headAt + head.length } : null;
  const events: TimelineEvent[] = [];
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index] ?? 0;
    const start = mark + 1;
    const end = index + 1 < marks.length ? (marks[index + 1] ?? line.length) : line.length;
    const raw = line.slice(start, end);
    const text = raw.trim();
    const local = text ? raw.indexOf(text) : 0;
    const from = text ? start + local : mark;
    const to = text ? from + text.length : mark + 1;
    let dropFrom = mark;
    if (dropFrom > 0 && /\s/.test(line[dropFrom - 1] ?? "")) dropFrom -= 1;
    events.push({
      text,
      from,
      to,
      dropFrom,
      dropTo: end,
      solo: period == null && marks.length === 1,
      only: marks.length === 1,
    });
  }
  return { period, events };
}

function timelineRemoval(
  event: TimelineEvent,
  lineStart: number,
  statement: { from: number; to: number },
  title: string,
): LintFix {
  if (event.solo || (event.only && !event.text.trim())) {
    return { id: "remove-node", title, edits: [{ from: statement.from, to: statement.to, insert: "" }] };
  }
  return {
    id: "remove-node",
    title,
    edits: [{ from: lineStart + event.dropFrom, to: lineStart + event.dropTo, insert: "" }],
  };
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
