import { Document, isMap, parseDocument } from "yaml";
import { clickTargetKind, resolveDiagramTarget } from "./diagramLinks.js";
import { matchFrontMatter, type FrontMatterMatch } from "./frontMatter.js";

/**
 * File-based diagram import.
 *
 * A source (CSV or JSON) is normalized into nodes and edges, then rendered as
 * native Mermaid. NetBox and pasted LLDP/CDP output are the same pipeline and
 * are rejected until that follow-up is built. Generated lines sit between
 * `%% nerdgram:generated` markers so a refresh can replace them and leave
 * hand edits outside the markers alone.
 */

export const GENERATED_START = "%% nerdgram:generated";
export const GENERATED_END = "%% nerdgram:generated end";

export const DEFERRED_SOURCES = ["netbox", "lldp", "cdp"] as const;

export const DATA_LIMITS = {
  maxChars: 512 * 1024,
  maxRows: 5_000,
  maxNodes: 2_000,
  maxEdges: 5_000,
  maxColumns: 40,
  maxLabelChars: 240,
  maxCellChars: 2_000,
  maxTitleChars: 200,
} as const;

export const DATA_FIELDS = [
  "localDevice",
  "localPort",
  "remoteDevice",
  "remotePort",
  "localGroup",
  "remoteGroup",
  "localType",
  "remoteType",
  "localClass",
  "remoteClass",
  "localDiagram",
  "remoteDiagram",
  "id",
  "label",
  "group",
  "type",
  "styleClass",
  "diagram",
  "source",
  "target",
] as const;

export type DataField = (typeof DATA_FIELDS)[number];
export type ColumnMapping = Partial<Record<DataField, string>>;
export type DataFormat = "csv" | "json";
export type DataShape = "links" | "nodes" | "edges" | "graph";
export type FlowDirection = "TD" | "TB" | "LR" | "RL" | "BT";

export type RowIssue = {
  row: number;
  message: string;
};

export type GraphNode = {
  id: string;
  label: string;
  group: string;
  className: string;
  /** Workspace path of a child diagram, without the nerdgram: prefix. */
  diagram: string;
};

export type GraphEdge = {
  source: string;
  target: string;
  label: string;
};

export type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type DataSourceConfig = {
  file: string;
  format: DataFormat;
  shape: DataShape;
  mapping: ColumnMapping;
  edgesFile?: string;
  edgesFormat?: DataFormat;
  edgesMapping?: ColumnMapping;
  direction: FlowDirection;
  grouping: boolean;
  diagramType: "flowchart";
};

export type ImportInput = {
  text: string;
  format?: string;
  shape?: string;
  mapping?: unknown;
  edgesText?: string;
  edgesFormat?: string;
  edgesMapping?: unknown;
  direction?: string;
  grouping?: boolean;
  title?: string;
  description?: string;
  sourceFile?: string;
  edgesFile?: string;
};

export type ImportResult = {
  format: DataFormat;
  shape: DataShape;
  headers: string[];
  edgesHeaders: string[];
  mapping: ColumnMapping;
  edgesMapping: ColumnMapping;
  errors: RowIssue[];
  warnings: RowIssue[];
  model: GraphModel;
  mermaid: string;
  counts: { nodes: number; edges: number; groups: number };
  direction: FlowDirection;
  grouping: boolean;
  source: DataSourceConfig;
};

export type GraphDiff = {
  nodes: {
    added: { id: string; label: string }[];
    removed: { id: string; label: string }[];
    changed: { id: string; label: string; before: string; after: string; fields: string[] }[];
  };
  edges: {
    added: { source: string; target: string; label: string }[];
    removed: { source: string; target: string; label: string }[];
    changed: { source: string; target: string; before: string; after: string }[];
  };
};

export type FieldSpec = {
  field: DataField;
  label: string;
  required: boolean;
};

const DIRECTIONS = new Set<FlowDirection>(["TD", "TB", "LR", "RL", "BT"]);
const SHAPES = new Set<DataShape>(["links", "nodes", "edges", "graph"]);
const RESERVED_IDS = new Set([
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "class",
  "classdef",
  "click",
  "style",
  "linkstyle",
  "direction",
  "default",
]);

const PALETTE = [
  "fill:#d7ebf4,stroke:#2f6f8f,color:#1c2420",
  "fill:#f8e6d8,stroke:#a86432,color:#1c2420",
  "fill:#e5f2e9,stroke:#2f6b4f,color:#1c2420",
  "fill:#f3e8f8,stroke:#6b4c9a,color:#1c2420",
  "fill:#fff6d8,stroke:#8a6a12,color:#1c2420",
  "fill:#fdecec,stroke:#b43838,color:#1c2420",
];

const ALIASES: Record<DataField, readonly string[]> = {
  localDevice: ["localdevice", "sourcedevice", "devicea", "fromdevice", "adevice", "localhost", "hostname"],
  localPort: ["localport", "sourceport", "srcport", "lport", "porta", "fromport"],
  remoteDevice: ["remotedevice", "neighbor", "neighbour", "destination", "destdevice", "todevice", "bdevice", "peer"],
  remotePort: ["remoteport", "destport", "dstport", "rport", "portb", "toport", "neighborport"],
  localGroup: ["localgroup", "sourcegroup", "groupa", "group"],
  remoteGroup: ["remotegroup", "destgroup", "groupb"],
  localType: ["localtype", "sourcetype", "typea", "localrole"],
  remoteType: ["remotetype", "desttype", "typeb", "remoterole"],
  localClass: ["localclass", "localstyle", "stylea"],
  remoteClass: ["remoteclass", "remotestyle", "styleb"],
  localDiagram: ["localdiagram", "childdiagram", "sitediagram", "diagram", "child", "href"],
  remoteDiagram: ["remotediagram", "neighbordiagram", "diagramremote"],
  id: ["id", "nodeid", "node", "name", "key"],
  label: ["label", "title", "displayname", "text"],
  group: ["group", "zone", "location", "subgraph", "site", "area"],
  type: ["type", "role", "kind", "devicetype"],
  styleClass: ["styleclass", "class", "style", "classdef"],
  diagram: ["diagram", "child", "childdiagram", "sitediagram", "link", "href"],
  source: ["source", "from", "src", "a"],
  target: ["target", "to", "dst", "dest", "destination", "b"],
};

export const SHAPE_FIELDS: Record<DataShape, readonly FieldSpec[]> = {
  links: [
    { field: "localDevice", label: "Local device", required: true },
    { field: "localPort", label: "Local port", required: false },
    { field: "remoteDevice", label: "Remote device", required: true },
    { field: "remotePort", label: "Remote port", required: false },
    { field: "localGroup", label: "Local group", required: false },
    { field: "remoteGroup", label: "Remote group", required: false },
    { field: "localType", label: "Local type", required: false },
    { field: "remoteType", label: "Remote type", required: false },
    { field: "localClass", label: "Local style class", required: false },
    { field: "remoteClass", label: "Remote style class", required: false },
    { field: "localDiagram", label: "Local child diagram", required: false },
    { field: "remoteDiagram", label: "Remote child diagram", required: false },
  ],
  nodes: [
    { field: "id", label: "Id", required: true },
    { field: "label", label: "Label", required: false },
    { field: "group", label: "Group", required: false },
    { field: "type", label: "Type", required: false },
    { field: "styleClass", label: "Style class", required: false },
    { field: "diagram", label: "Child diagram", required: false },
  ],
  edges: [
    { field: "source", label: "Source", required: true },
    { field: "target", label: "Target", required: true },
    { field: "label", label: "Label", required: false },
  ],
  graph: [
    { field: "id", label: "Id", required: true },
    { field: "label", label: "Label", required: false },
    { field: "group", label: "Group", required: false },
    { field: "type", label: "Type", required: false },
    { field: "styleClass", label: "Style class", required: false },
    { field: "diagram", label: "Child diagram", required: false },
  ],
};

export const EDGE_FIELDS: readonly FieldSpec[] = SHAPE_FIELDS.edges;

type Table = {
  headers: string[];
  rows: { row: number; cells: string[] }[];
};

type DraftNode = {
  key: string;
  label: string;
  group: string;
  typeName: string;
  styleClass: string;
  diagram: string;
};

export function dataFail(
  status: number,
  message: string,
  code: string,
  details?: Record<string, unknown>,
): Error {
  return Object.assign(new Error(message), { status, code, details });
}

export function isDeferredSource(format: string): boolean {
  return (DEFERRED_SOURCES as readonly string[]).includes(format.trim().toLowerCase());
}

export function suggestMapping(headers: readonly string[], shape: DataShape): ColumnMapping {
  const fields = shape === "graph" ? SHAPE_FIELDS.nodes : SHAPE_FIELDS[shape];
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  for (const spec of fields) {
    const header = headers.find((item) => !used.has(item) && aliasMatch(spec.field, item));
    if (!header) continue;
    used.add(header);
    mapping[spec.field] = header;
  }
  return mapping;
}

export function suggestEdgeMapping(headers: readonly string[]): ColumnMapping {
  return suggestMapping(headers, "edges");
}

/** Parse, normalize, and render. Row problems are returned. Fatal input throws. */
export function importDiagramData(input: ImportInput): ImportResult {
  const text = requireText(input.text, "Data");
  const requestedFormat = typeof input.format === "string" ? input.format.trim().toLowerCase() : "auto";
  if (isDeferredSource(requestedFormat)) {
    throw dataFail(
      400,
      "NetBox and LLDP/CDP import are not in this version. Use a CSV or JSON file.",
      "deferred",
    );
  }
  const format = requestedFormat === "" || requestedFormat === "auto" ? detectFormat(text) : requestedFormat;
  if (format !== "csv" && format !== "json") {
    throw dataFail(400, "Use a CSV or JSON file.", "invalid");
  }

  const primary = format === "csv" ? tableFromCsv(text) : tableFromJson(text);
  const shape = resolveShape(input.shape, primary.shapeHint, primary.headers, Boolean(input.edgesText));
  const direction = resolveDirection(input.direction, shape);
  const grouping = input.grouping !== false;

  let edgesTable: Table | null = null;
  let edgesFormat: DataFormat | undefined;
  if (typeof input.edgesText === "string" && input.edgesText.trim()) {
    const edgesText = requireText(input.edgesText, "Edges");
    const requestedEdges = typeof input.edgesFormat === "string" ? input.edgesFormat.trim().toLowerCase() : "auto";
    if (isDeferredSource(requestedEdges)) {
      throw dataFail(400, "NetBox and LLDP/CDP import are not in this version. Use a CSV or JSON file.", "deferred");
    }
    edgesFormat = requestedEdges === "" || requestedEdges === "auto" ? detectFormat(edgesText) : (requestedEdges as DataFormat);
    if (edgesFormat !== "csv" && edgesFormat !== "json") {
      throw dataFail(400, "The edges file has to be CSV or JSON.", "invalid");
    }
    const parsedEdges = edgesFormat === "csv" ? tableFromCsv(edgesText) : tableFromJson(edgesText);
    edgesTable = parsedEdges.edges ?? { headers: parsedEdges.headers, rows: parsedEdges.rows };
  }

  if (shape === "graph" && !primary.embeddedEdges && !edgesTable) {
    throw dataFail(400, "A node list needs an edges file, or use a links table.", "invalid");
  }
  if (shape !== "graph" && shape !== "nodes") edgesTable = null;

  const headers = primary.headers;
  const mapping = mergeMapping(suggestMapping(headers, shape === "edges" ? "edges" : shape === "graph" ? "nodes" : shape), input.mapping);
  const edgesHeaders = edgesTable?.headers ?? primary.edges?.headers ?? [];
  const edgesMapping = mergeMapping(suggestEdgeMapping(edgesHeaders), input.edgesMapping);
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  if (shape === "links" || shape === "edges") {
    validateMapping(shape === "edges" ? SHAPE_FIELDS.edges : SHAPE_FIELDS.links, mapping, headers, errors);
  } else {
    validateMapping(SHAPE_FIELDS.nodes, mapping, headers, errors);
  }
  if (edgesTable) validateMapping(SHAPE_FIELDS.edges, edgesMapping, edgesTable.headers, errors, "Edges");
  else if (primary.edges) validateMapping(SHAPE_FIELDS.edges, edgesMapping, primary.edges.headers, errors, "Edges");

  const model =
    errors.length > 0
      ? { nodes: [], edges: [] }
      : buildModel(shape, primary, mapping, edgesTable, edgesMapping, errors, warnings);

  if (errors.length === 0 && model.nodes.length === 0 && model.edges.length === 0) {
    errors.push({ row: 0, message: "No nodes or links were found." });
  }

  const sourceFile = cleanStoredName(input.sourceFile) || defaultSourceName(format);
  const edgesFile = edgesTable ? cleanStoredName(input.edgesFile) || defaultEdgesName(edgesFormat || "csv") : primary.edges ? cleanStoredName(input.edgesFile) : undefined;
  const source: DataSourceConfig = {
    file: sourceFile,
    format,
    shape,
    mapping,
    direction,
    grouping,
    diagramType: "flowchart",
  };
  if (edgesFile) source.edgesFile = edgesFile;
  if (edgesFormat) source.edgesFormat = edgesFormat;
  if (Object.keys(edgesMapping).length > 0 && (edgesTable || primary.edges)) source.edgesMapping = edgesMapping;

  const mermaid =
    errors.length === 0
      ? renderNewDiagram({
          model,
          source,
          title: clipTitle(input.title),
          description: clipTitle(input.description) || (source.file ? `Generated from ${source.file}` : undefined),
        })
      : "";

  return {
    format,
    shape,
    headers,
    edgesHeaders,
    mapping,
    edgesMapping,
    errors,
    warnings,
    model: errors.length === 0 ? model : { nodes: [], edges: [] },
    mermaid,
    counts: countModel(errors.length === 0 ? model : { nodes: [], edges: [] }),
    direction,
    grouping,
    source,
  };
}

export function renderNewDiagram(options: {
  model: GraphModel;
  source: DataSourceConfig;
  title?: string;
  description?: string;
}): string {
  const doc = new Document({});
  if (options.title) doc.set("title", options.title);
  if (options.description) doc.setIn(["nerdgram", "description"], options.description);
  doc.setIn(["nerdgram", "source"], sourceToPlain(options.source));
  const block = wrapGenerated(generateBody(options.model, options.source));
  return fence(doc, `\n${block}`);
}

export function renderRefresh(existing: string, model: GraphModel, source: DataSourceConfig): string {
  const loaded = loadYaml(existing);
  if ("error" in loaded) {
    throw dataFail(400, `Refresh left the file alone. ${loaded.error}`, "invalid");
  }
  loaded.doc.setIn(["nerdgram", "source"], sourceToPlain(source));
  const recomposed = fence(loaded.doc, loaded.body, loaded.bom);
  return spliceGenerated(recomposed, wrapGenerated(generateBody(model, source)));
}

export function generateBody(model: GraphModel, options: { direction: FlowDirection; grouping: boolean }): string {
  const lines: string[] = [`flowchart ${options.direction}`];
  const grouped = new Map<string, GraphNode[]>();
  const loose: GraphNode[] = [];
  for (const node of model.nodes) {
    if (options.grouping && node.group) {
      const list = grouped.get(node.group) ?? [];
      list.push(node);
      grouped.set(node.group, list);
    } else {
      loose.push(node);
    }
  }
  const used = new Set(model.nodes.map((node) => node.id.toLowerCase()));
  const groups = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [group, members] of groups) {
    const id = freshId(`g_${sanitizeId(group) || "group"}`, used);
    lines.push(`  subgraph ${id}["${escapeLabel(group)}"]`);
    for (const node of members) lines.push(`    ${node.id}["${escapeLabel(node.label)}"]`);
    lines.push("  end");
  }
  for (const node of loose) lines.push(`  ${node.id}["${escapeLabel(node.label)}"]`);
  for (const edge of model.edges) {
    if (edge.label) lines.push(`  ${edge.source} -->|"${escapeLabel(edge.label)}"| ${edge.target}`);
    else lines.push(`  ${edge.source} --> ${edge.target}`);
  }
  const byClass = new Map<string, string[]>();
  for (const node of model.nodes) {
    if (!node.className) continue;
    const list = byClass.get(node.className) ?? [];
    list.push(node.id);
    byClass.set(node.className, list);
  }
  for (const name of [...byClass.keys()].sort()) lines.push(`  classDef ${name} ${paletteFor(name)}`);
  for (const name of [...byClass.keys()].sort()) {
    const ids = byClass.get(name) ?? [];
    for (let index = 0; index < ids.length; index += 12) {
      lines.push(`  class ${ids.slice(index, index + 12).join(",")} ${name}`);
    }
  }
  for (const node of [...model.nodes].filter((item) => item.diagram).sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`  click ${node.id} "nerdgram:${node.diagram}" "${clickTooltip(node.label)}"`);
  }
  return lines.join("\n");
}

export function wrapGenerated(body: string): string {
  return `${GENERATED_START}\n${body}\n${GENERATED_END}\n`;
}

export function spliceGenerated(source: string, block: string): string {
  const start = findExactLine(source, GENERATED_START);
  if (!start) {
    throw dataFail(
      400,
      "This diagram has no %% nerdgram:generated markers, so refresh cannot tell generated lines from hand edits.",
      "invalid",
    );
  }
  const end = findExactLine(source, GENERATED_END, start.end);
  if (!end) {
    throw dataFail(400, "The generated block is missing its %% nerdgram:generated end marker.", "invalid");
  }
  const head = source.slice(0, start.start).replace(/[ \t]+$/u, "");
  const tail = source.slice(end.end);
  const normalized = block.endsWith("\n") ? block : `${block}\n`;
  const prefix = head.length === 0 || head.endsWith("\n") ? head : `${head}\n`;
  return `${prefix}${normalized}${tail}`;
}

export function extractGenerated(source: string): string | null {
  const start = findExactLine(source, GENERATED_START);
  if (!start) return null;
  const end = findExactLine(source, GENERATED_END, start.end);
  if (!end) return null;
  return source.slice(start.end, end.start).replace(/\s+$/u, "");
}

export function readGeneratedModel(source: string): GraphModel | null {
  const inner = extractGenerated(source);
  if (inner == null) return null;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let group = "";
  const classes = new Map<string, string>();
  const diagrams = new Map<string, string>();
  for (const line of inner.split(/\n/)) {
    const text = line.replace(/\r$/, "");
    const subgraph = /^\s*subgraph\s+([A-Za-z_][\w-]*)\["(.*)"\]\s*$/.exec(text);
    if (subgraph) {
      group = unescapeLabel(subgraph[2] ?? "");
      continue;
    }
    if (/^\s*end\s*$/.test(text)) {
      group = "";
      continue;
    }
    const defined = /^\s*([A-Za-z_][\w-]*)\["(.*)"\]\s*$/.exec(text);
    if (defined?.[1]) {
      nodes.set(defined[1], {
        id: defined[1],
        label: unescapeLabel(defined[2] ?? ""),
        group,
        className: "",
        diagram: "",
      });
      continue;
    }
    const labeled = /^\s*([A-Za-z_][\w-]*)\s+-->\|"(.*)"\|\s+([A-Za-z_][\w-]*)\s*$/.exec(text);
    if (labeled?.[1] && labeled[3]) {
      edges.push({ source: labeled[1], target: labeled[3], label: unescapeLabel(labeled[2] ?? "") });
      continue;
    }
    const plain = /^\s*([A-Za-z_][\w-]*)\s+-->\s+([A-Za-z_][\w-]*)\s*$/.exec(text);
    if (plain?.[1] && plain[2]) {
      edges.push({ source: plain[1], target: plain[2], label: "" });
      continue;
    }
    const classLine = /^\s*class\s+(.+?)\s+([A-Za-z_][\w-]*)\s*$/.exec(text);
    if (classLine?.[1] && classLine[2] && !text.includes("[")) {
      for (const id of classLine[1].split(",")) {
        const trimmed = id.trim();
        if (trimmed) classes.set(trimmed, classLine[2]);
      }
      continue;
    }
    const click = /^\s*click\s+([A-Za-z_][\w-]*)\s+"nerdgram:([^"]+)"/.exec(text);
    if (click?.[1] && click[2]) diagrams.set(click[1], click[2]);
  }
  for (const [id, className] of classes) {
    const node = nodes.get(id);
    if (node) node.className = className;
  }
  for (const [id, diagram] of diagrams) {
    const node = nodes.get(id);
    if (node) node.diagram = diagram;
  }
  for (const edge of edges) {
    if (!nodes.has(edge.source)) {
      nodes.set(edge.source, { id: edge.source, label: edge.source, group: "", className: "", diagram: "" });
    }
    if (!nodes.has(edge.target)) {
      nodes.set(edge.target, { id: edge.target, label: edge.target, group: "", className: "", diagram: "" });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

export function readDataSource(source: string): DataSourceConfig | null {
  try {
    const loaded = loadYaml(source);
    if ("error" in loaded) return null;
    const raw = loaded.doc.toJS();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const nerdgram = (raw as { nerdgram?: unknown }).nerdgram;
    if (!nerdgram || typeof nerdgram !== "object" || Array.isArray(nerdgram)) return null;
    const block = (nerdgram as { source?: unknown }).source;
    if (!block || typeof block !== "object" || Array.isArray(block)) return null;
    return configFromPlain(block as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function diffModels(before: GraphModel, after: GraphModel): GraphDiff {
  const previous = new Map(before.nodes.map((node) => [node.id, node]));
  const next = new Map(after.nodes.map((node) => [node.id, node]));
  const nodes: GraphDiff["nodes"] = { added: [], removed: [], changed: [] };
  for (const node of after.nodes) {
    const old = previous.get(node.id);
    if (!old) {
      nodes.added.push({ id: node.id, label: node.label });
      continue;
    }
    const fields: string[] = [];
    if (old.label !== node.label) fields.push("label");
    if (old.group !== node.group) fields.push("group");
    if (old.className !== node.className) fields.push("class");
    if (old.diagram !== node.diagram) fields.push("diagram");
    if (fields.length > 0) {
      nodes.changed.push({
        id: node.id,
        label: node.label,
        before: describeNode(old),
        after: describeNode(node),
        fields,
      });
    }
  }
  for (const node of before.nodes) {
    if (!next.has(node.id)) nodes.removed.push({ id: node.id, label: node.label });
  }

  const edges: GraphDiff["edges"] = { added: [], removed: [], changed: [] };
  const beforeGroups = groupEdges(before.edges);
  const afterGroups = groupEdges(after.edges);
  const keys = new Set([...beforeGroups.keys(), ...afterGroups.keys()]);
  for (const key of keys) {
    const left = [...(beforeGroups.get(key) ?? [])];
    const right = [...(afterGroups.get(key) ?? [])];
    const still: GraphEdge[] = [];
    for (const edge of right) {
      const match = left.findIndex((item) => item.label === edge.label);
      if (match >= 0) {
        left.splice(match, 1);
        still.push(edge);
      }
    }
    const pending = right.filter((edge) => !still.includes(edge));
    while (left.length > 0 && pending.length > 0) {
      const oldEdge = left.shift();
      const newEdge = pending.shift();
      if (!oldEdge || !newEdge) break;
      edges.changed.push({
        source: newEdge.source,
        target: newEdge.target,
        before: oldEdge.label,
        after: newEdge.label,
      });
    }
    for (const edge of pending) edges.added.push({ ...edge });
    for (const edge of left) edges.removed.push({ ...edge });
  }
  return { nodes, edges };
}

export function emptyDiff(): GraphDiff {
  return { nodes: { added: [], removed: [], changed: [] }, edges: { added: [], removed: [], changed: [] } };
}

export function diffIsEmpty(diff: GraphDiff): boolean {
  return (
    diff.nodes.added.length === 0 &&
    diff.nodes.removed.length === 0 &&
    diff.nodes.changed.length === 0 &&
    diff.edges.added.length === 0 &&
    diff.edges.removed.length === 0 &&
    diff.edges.changed.length === 0
  );
}

/** Mermaid id fragment. Empty when the name has no usable characters. */
export function sanitizeId(raw: string): string {
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 72);
}

/**
 * Text placed inside a Mermaid quoted label. Quotes, newlines, and shape
 * characters are turned into Mermaid entities so a cell cannot close the
 * label or start a new directive.
 */
export function escapeLabel(raw: string): string {
  const clipped = [...neutralizeSchemes(raw.normalize("NFKC"))].slice(0, DATA_LIMITS.maxLabelChars).join("");
  let out = "";
  for (const char of clipped) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 10 || code === 13) {
      if (!out.endsWith("<br/>")) out += "<br/>";
      continue;
    }
    if (code < 32 || code === 127) continue;
    out += LABEL_ENTITIES[char] ?? char;
  }
  return out;
}

export function unescapeLabel(raw: string): string {
  return raw
    .replaceAll("<br/>", "\n")
    .replaceAll("#quot;", '"')
    .replaceAll("#lt;", "<")
    .replaceAll("#gt;", ">")
    .replaceAll("#amp;", "&")
    .replaceAll("#35;", "#")
    .replaceAll("#91;", "[")
    .replaceAll("#93;", "]")
    .replaceAll("#123;", "{")
    .replaceAll("#125;", "}")
    .replaceAll("#124;", "|")
    .replaceAll("#92;", "\\")
    .replaceAll("#96;", "`");
}

export function isSafeDataPath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0")) return false;
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return false;
  const parts = normalized.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === ".." || part.startsWith("."))) return false;
  const lower = normalized.toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".json");
}

export function assertDataPath(relativePath: string): string {
  if (!isSafeDataPath(relativePath)) {
    throw dataFail(400, "Data files have to be a .csv or .json path inside the workspace.", "invalid");
  }
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** A label must not survive as a `javascript:` click target even if the quotes were misread. */
function neutralizeSchemes(value: string): string {
  return value.replace(/javascript\s*:/gi, "javascript ").replace(/vbscript\s*:/gi, "vbscript ").replace(/data\s*:/gi, "data ");
}

const LABEL_ENTITIES: Record<string, string> = {
  "#": "#35;",
  '"': "#quot;",
  "<": "#lt;",
  ">": "#gt;",
  "&": "#amp;",
  "[": "#91;",
  "]": "#93;",
  "{": "#123;",
  "}": "#125;",
  "|": "#124;",
  "\\": "#92;",
  "`": "#96;",
};

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") throw dataFail(400, `${label} must be text.`, "invalid");
  if (value.includes("\0")) throw dataFail(400, `${label} is not a text file.`, "invalid");
  if (value.length > DATA_LIMITS.maxChars) {
    throw dataFail(400, `${label} is larger than 512 KB.`, "invalid");
  }
  if (!value.trim()) throw dataFail(400, `Paste or upload a CSV or JSON ${label.toLowerCase()} file.`, "invalid");
  return value.replace(/^\uFEFF/, "");
}

function detectFormat(text: string): DataFormat {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "csv";
}

function resolveDirection(value: string | undefined, shape: DataShape): FlowDirection {
  if (value == null || value.trim() === "") return shape === "links" ? "LR" : "TD";
  const upper = value.trim().toUpperCase();
  if (!DIRECTIONS.has(upper as FlowDirection)) {
    throw dataFail(400, "Direction must be TD, TB, LR, RL, or BT.", "invalid");
  }
  return upper as FlowDirection;
}

function resolveShape(requested: string | undefined, hint: DataShape, headers: string[], hasEdgesFile: boolean): DataShape {
  const raw = requested?.trim().toLowerCase() ?? "";
  if (raw && raw !== "auto") {
    if (!SHAPES.has(raw as DataShape)) throw dataFail(400, "Diagram data must be links, nodes, edges, or a graph.", "invalid");
    return raw as DataShape;
  }
  if (hasEdgesFile && (hint === "nodes" || hint === "graph")) return "graph";
  if (hint === "graph" || hint === "links" || hint === "edges" || hint === "nodes") return hint;
  if (scoreHeaders(headers, "links") >= 2) return "links";
  if (scoreHeaders(headers, "edges") >= 2) return "edges";
  return "nodes";
}

function scoreHeaders(headers: string[], shape: DataShape): number {
  return Object.keys(suggestMapping(headers, shape)).length;
}

function tableFromCsv(text: string): {
  headers: string[];
  rows: { row: number; cells: string[] }[];
  shapeHint: DataShape;
  edges?: Table;
  embeddedEdges: boolean;
} {
  const table = parseCsv(text);
  return { ...table, shapeHint: inferShape(table.headers), embeddedEdges: false };
}

function tableFromJson(text: string): {
  headers: string[];
  rows: { row: number; cells: string[] }[];
  shapeHint: DataShape;
  edges?: Table;
  embeddedEdges: boolean;
} {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw dataFail(400, "This is not valid JSON.", "invalid");
  }
  if (Array.isArray(value)) {
    const table = objectsToTable(value, "Row");
    return { ...table, shapeHint: inferShape(table.headers), embeddedEdges: false };
  }
  if (!isRecord(value)) throw dataFail(400, "JSON data must be an object or an array of rows.", "invalid");
  if (Array.isArray(value.links)) {
    const table = objectsToTable(value.links, "Row");
    return { ...table, shapeHint: "links", embeddedEdges: false };
  }
  if (Array.isArray(value.nodes) || Array.isArray(value.edges)) {
    const nodes = objectsToTable(Array.isArray(value.nodes) ? value.nodes : [], "Nodes");
    const edges = Array.isArray(value.edges) ? objectsToTable(value.edges, "Edges") : undefined;
    const shapeHint: DataShape = edges && edges.rows.length > 0 ? "graph" : "nodes";
    return {
      headers: nodes.headers,
      rows: nodes.rows,
      shapeHint,
      edges,
      embeddedEdges: Boolean(edges && edges.rows.length > 0),
    };
  }
  const table = objectsToTable([value], "Row");
  return { ...table, shapeHint: inferShape(table.headers), embeddedEdges: false };
}

function inferShape(headers: string[]): DataShape {
  const links = scoreHeaders(headers, "links");
  const edges = scoreHeaders(headers, "edges");
  const nodes = scoreHeaders(headers, "nodes");
  if (links >= 2 && links >= edges && links >= nodes) return "links";
  if (edges >= 2 && edges > nodes) return "edges";
  return "nodes";
}

function objectsToTable(value: unknown[], section: string): Table {
  if (value.length > DATA_LIMITS.maxRows) {
    throw dataFail(400, `${section} has more than ${DATA_LIMITS.maxRows} rows.`, "invalid");
  }
  const headers: string[] = [];
  const rows: Table["rows"] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item)) {
      throw dataFail(400, `${section} row ${index + 1} must be an object.`, "invalid");
    }
    for (const key of Object.keys(item)) {
      if (!headers.includes(key)) headers.push(key);
    }
    rows.push({
      row: index + 1,
      cells: headers.map((header) => scalarCell(item[header])),
    });
  }
  if (headers.length > DATA_LIMITS.maxColumns) {
    throw dataFail(400, `${section} has more than ${DATA_LIMITS.maxColumns} columns.`, "invalid");
  }
  // Cells were captured before later keys were known. Rebuild so every row lines up.
  const aligned = value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return { row: index + 1, cells: headers.map((header) => scalarCell(record[header])) };
  });
  return { headers, rows: aligned.length > 0 ? aligned : rows };
}

function scalarCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return clipCell(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function clipCell(value: string): string {
  const flat = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (flat.length > DATA_LIMITS.maxCellChars) return flat.slice(0, DATA_LIMITS.maxCellChars);
  return flat;
}

function parseCsv(text: string): Table {
  const records: { row: number; cells: string[] }[] = [];
  let cell = "";
  let cells: string[] = [];
  let row = 1;
  let startRow = 1;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
        if (char === "\n") row += 1;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      cells.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      cells.push(cell);
      records.push({ row: startRow, cells });
      cell = "";
      cells = [];
      row += 1;
      startRow = row;
      continue;
    }
    cell += char;
  }
  if (quoted) throw dataFail(400, "A quoted CSV field was never closed.", "invalid");
  if (cell.length > 0 || cells.length > 0) {
    cells.push(cell);
    records.push({ row: startRow, cells });
  }
  const useful = records.filter((record) => record.cells.some((item) => item.trim() !== ""));
  if (useful.length === 0) throw dataFail(400, "The CSV needs a header row.", "invalid");
  const headers = (useful[0]?.cells ?? []).map((item) => item.trim());
  if (headers.every((item) => item === "")) throw dataFail(400, "The CSV header row is empty.", "invalid");
  if (headers.length > DATA_LIMITS.maxColumns) {
    throw dataFail(400, `A CSV can have at most ${DATA_LIMITS.maxColumns} columns.`, "invalid");
  }
  const seen = new Set<string>();
  for (const header of headers) {
    if (!header) throw dataFail(400, "Every CSV column needs a name.", "invalid");
    const key = header.toLowerCase();
    if (seen.has(key)) throw dataFail(400, `The column "${clipMessage(header)}" is repeated.`, "invalid");
    seen.add(key);
  }
  const rows = useful.slice(1).map((record) => ({
    row: record.row,
    cells: headers.map((_, index) => clipCell(record.cells[index] ?? "")),
  }));
  if (rows.length > DATA_LIMITS.maxRows) {
    throw dataFail(400, `A file can have at most ${DATA_LIMITS.maxRows} data rows.`, "invalid");
  }
  return { headers, rows };
}

function mergeMapping(suggested: ColumnMapping, override: unknown): ColumnMapping {
  const mapping: ColumnMapping = { ...suggested };
  if (override == null) return mapping;
  if (!isRecord(override)) throw dataFail(400, "Column mapping must be an object.", "invalid");
  for (const field of DATA_FIELDS) {
    if (!(field in override)) continue;
    const value = override[field];
    if (value == null || value === "") {
      delete mapping[field];
      continue;
    }
    if (typeof value !== "string") throw dataFail(400, `Mapping for ${field} must be a column name.`, "invalid");
    mapping[field] = value;
  }
  return mapping;
}

function validateMapping(
  specs: readonly FieldSpec[],
  mapping: ColumnMapping,
  headers: readonly string[],
  errors: RowIssue[],
  section?: string,
): void {
  for (const spec of specs) {
    const column = mapping[spec.field];
    if (!column) {
      if (spec.required) errors.push({ row: 1, message: prefixIssue(section, 1, `${spec.label} has no column.`) });
      continue;
    }
    if (!headers.includes(column)) {
      errors.push({
        row: 1,
        message: prefixIssue(section, 1, `${spec.label} is mapped to "${clipMessage(column)}", which is not a column.`),
      });
    }
  }
}

function buildModel(
  shape: DataShape,
  primary: { headers: string[]; rows: { row: number; cells: string[] }[]; edges?: Table },
  mapping: ColumnMapping,
  edgesTable: Table | null,
  edgesMapping: ColumnMapping,
  errors: RowIssue[],
  warnings: RowIssue[],
): GraphModel {
  const drafts: DraftNode[] = [];
  const byKey = new Map<string, DraftNode>();
  const edgeDrafts: { sourceKey: string; targetKey: string; label: string }[] = [];

  const touch = (
    key: string,
    patch: Partial<DraftNode>,
    row: number,
    section: string | undefined,
  ) => {
    const name = key.trim();
    if (!name) return;
    const existing = byKey.get(name);
    if (!existing) {
      const created: DraftNode = {
        key: name,
        label: patch.label?.trim() || name,
        group: patch.group?.trim() || "",
        typeName: patch.typeName?.trim() || "",
        styleClass: patch.styleClass?.trim() || "",
        diagram: "",
      };
      const diagram = acceptDiagram(patch.diagram ?? "", row, section, errors);
      if (diagram == null) return;
      created.diagram = diagram;
      byKey.set(name, created);
      drafts.push(created);
      return;
    }
    fill(existing, "label", patch.label, row, section, warnings, "label");
    fill(existing, "group", patch.group, row, section, warnings, "group");
    fill(existing, "typeName", patch.typeName, row, section, warnings, "type");
    fill(existing, "styleClass", patch.styleClass, row, section, warnings, "style class");
    if (patch.diagram?.trim() && !existing.diagram) {
      const diagram = acceptDiagram(patch.diagram, row, section, errors);
      if (diagram) existing.diagram = diagram;
    }
  };

  if (shape === "links") {
    for (const record of primary.rows) {
      const local = cell(primary.headers, record.cells, mapping.localDevice);
      const remote = cell(primary.headers, record.cells, mapping.remoteDevice);
      if (!local || !remote) {
        errors.push({
          row: record.row,
          message: `Row ${record.row}: ${!local ? "local device" : "remote device"} is empty.`,
        });
        continue;
      }
      touch(
        local,
        {
          label: local,
          group: cell(primary.headers, record.cells, mapping.localGroup) || cell(primary.headers, record.cells, mapping.group),
          typeName: cell(primary.headers, record.cells, mapping.localType),
          styleClass: cell(primary.headers, record.cells, mapping.localClass),
          diagram: cell(primary.headers, record.cells, mapping.localDiagram),
        },
        record.row,
        undefined,
      );
      touch(
        remote,
        {
          label: remote,
          group: cell(primary.headers, record.cells, mapping.remoteGroup),
          typeName: cell(primary.headers, record.cells, mapping.remoteType),
          styleClass: cell(primary.headers, record.cells, mapping.remoteClass),
          diagram: cell(primary.headers, record.cells, mapping.remoteDiagram),
        },
        record.row,
        undefined,
      );
      edgeDrafts.push({
        sourceKey: local,
        targetKey: remote,
        label: portLabel(
          cell(primary.headers, record.cells, mapping.localPort),
          cell(primary.headers, record.cells, mapping.remotePort),
        ),
      });
    }
  } else if (shape === "edges") {
    appendEdges(primary, mapping, edgeDrafts, errors, undefined);
  } else {
    const nodeSection = shape === "graph" ? "Nodes" : undefined;
    for (const record of primary.rows) {
      const id = cell(primary.headers, record.cells, mapping.id);
      if (!id) {
        errors.push({ row: record.row, message: prefixIssue(nodeSection, record.row, "id is empty.") });
        continue;
      }
      touch(
        id,
        {
          label: cell(primary.headers, record.cells, mapping.label) || id,
          group: cell(primary.headers, record.cells, mapping.group),
          typeName: cell(primary.headers, record.cells, mapping.type),
          styleClass: cell(primary.headers, record.cells, mapping.styleClass),
          diagram: cell(primary.headers, record.cells, mapping.diagram),
        },
        record.row,
        nodeSection,
      );
    }
    if (shape === "graph" && primary.edges && !edgesTable) {
      appendEdges(primary.edges, edgesMapping, edgeDrafts, errors, "Edges");
    }
  }
  if (edgesTable && (shape === "graph" || shape === "nodes")) {
    appendEdges(edgesTable, edgesMapping, edgeDrafts, errors, "Edges");
  }

  if (errors.length > 0) return { nodes: [], edges: [] };
  for (const edge of edgeDrafts) {
    if (!byKey.has(edge.sourceKey)) touch(edge.sourceKey, { label: edge.sourceKey }, 0, undefined);
    if (!byKey.has(edge.targetKey)) touch(edge.targetKey, { label: edge.targetKey }, 0, undefined);
  }
  if (errors.length > 0) return { nodes: [], edges: [] };
  if (drafts.length > DATA_LIMITS.maxNodes || edgeDrafts.length > DATA_LIMITS.maxEdges) {
    throw dataFail(
      400,
      `A diagram can have at most ${DATA_LIMITS.maxNodes} nodes and ${DATA_LIMITS.maxEdges} edges.`,
      "invalid",
    );
  }
  const ids = assignIds(drafts);
  const nodes = drafts.map((draft) => ({
    id: ids.get(draft.key) ?? "n",
    label: draft.label,
    group: draft.group,
    className: classNameFor(draft),
    diagram: draft.diagram,
  }));
  const seenEdges = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const edge of edgeDrafts) {
    const source = ids.get(edge.sourceKey);
    const target = ids.get(edge.targetKey);
    if (!source || !target) continue;
    const key = `${source}\0${target}\0${edge.label}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ source, target, label: edge.label });
  }
  return { nodes, edges };
}

function appendEdges(
  table: Table,
  mapping: ColumnMapping,
  edges: { sourceKey: string; targetKey: string; label: string }[],
  errors: RowIssue[],
  section: string | undefined,
): void {
  for (const record of table.rows) {
    const source = cell(table.headers, record.cells, mapping.source);
    const target = cell(table.headers, record.cells, mapping.target);
    if (!source || !target) {
      errors.push({
        row: record.row,
        message: prefixIssue(section, record.row, `${!source ? "source" : "target"} is empty.`),
      });
      continue;
    }
    edges.push({ sourceKey: source, targetKey: target, label: cell(table.headers, record.cells, mapping.label) });
  }
}

function fill(
  node: DraftNode,
  key: "label" | "group" | "typeName" | "styleClass",
  value: string | undefined,
  row: number,
  section: string | undefined,
  warnings: RowIssue[],
  name: string,
): void {
  const next = value?.trim() ?? "";
  if (!next) return;
  const current = node[key];
  if (!current) {
    node[key] = next;
    return;
  }
  if (current !== next) {
    warnings.push({
      row,
      message: prefixIssue(section, row, `"${clipMessage(node.key)}" already has ${name} "${clipMessage(current)}". Kept the first.`),
    });
  }
}

function acceptDiagram(raw: string, row: number, section: string | undefined, errors: RowIssue[]): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/[\u0000-\u001f"\\?#]/.test(trimmed)) {
    errors.push({
      row,
      message: prefixIssue(section, row, `child diagram "${clipMessage(trimmed)}" is not a workspace .mmd path.`),
    });
    return null;
  }
  const candidate = /^(nerdgram|diagram):/i.test(trimmed) ? trimmed : trimmed;
  if (clickTargetKind(candidate) === "unsafe" || clickTargetKind(candidate) === "external") {
    errors.push({
      row,
      message: prefixIssue(section, row, `child diagram "${clipMessage(trimmed)}" is not a workspace .mmd path.`),
    });
    return null;
  }
  const resolved = resolveDiagramTarget(candidate, "");
  if (!resolved.ok) {
    errors.push({
      row,
      message: prefixIssue(section, row, `child diagram "${clipMessage(trimmed)}" is not a workspace .mmd path.`),
    });
    return null;
  }
  return resolved.path;
}

function assignIds(drafts: readonly DraftNode[]): Map<string, string> {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const draft of drafts) {
    let base = sanitizeId(draft.key);
    if (!base || !/^[A-Za-z_]/.test(base)) base = `n_${base || "node"}`.replace(/^n_$/, "n");
    if (RESERVED_IDS.has(base.toLowerCase())) base = `n_${base}`;
    base = base.slice(0, 64);
    let id = base;
    let n = 2;
    while (used.has(id.toLowerCase())) {
      id = `${base.slice(0, 56)}_${n}`;
      n += 1;
    }
    used.add(id.toLowerCase());
    ids.set(draft.key, id);
  }
  return ids;
}

function classNameFor(draft: DraftNode): string {
  const raw = draft.styleClass.trim() || draft.typeName.trim();
  if (!raw) return "";
  let name = sanitizeId(raw);
  if (!name || !/^[A-Za-z_]/.test(name)) name = `c_${name || "class"}`.replace(/^c_$/, "c");
  if (RESERVED_IDS.has(name.toLowerCase())) name = `c_${name}`;
  return name.slice(0, 64);
}

function cell(headers: readonly string[], cells: readonly string[], column: string | undefined): string {
  if (!column) return "";
  const index = headers.indexOf(column);
  if (index < 0) return "";
  return (cells[index] ?? "").trim();
}

function portLabel(local: string, remote: string): string {
  if (local && remote) return `${local} – ${remote}`;
  return local || remote;
}

function aliasMatch(field: DataField, header: string): boolean {
  const key = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return ALIASES[field].includes(key);
}

function prefixIssue(section: string | undefined, row: number, message: string): string {
  if (!section) return `Row ${row}: ${message}`;
  return `${section} row ${row}: ${message}`;
}

function clipMessage(value: string): string {
  const flat = value.replace(/[\u0000-\u001f]/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function clipTitle(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const cleaned = [...value.normalize("NFKC")]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  if (!cleaned) return undefined;
  return [...cleaned].slice(0, DATA_LIMITS.maxTitleChars).join("");
}

function paletteFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 33 + name.charCodeAt(index)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0] ?? "";
}

function freshId(base: string, used: Set<string>): string {
  let id = sanitizeId(base) || "g_group";
  if (!/^[A-Za-z_]/.test(id) || RESERVED_IDS.has(id.toLowerCase())) id = `g_${id}`;
  id = id.slice(0, 64);
  let next = id;
  let n = 2;
  while (used.has(next.toLowerCase())) {
    next = `${id.slice(0, 56)}_${n}`;
    n += 1;
  }
  used.add(next.toLowerCase());
  return next;
}

function clickTooltip(label: string): string {
  const clean = label.replace(/["\r\n\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const clipped = [...clean].slice(0, 60).join("");
  return clipped ? `Open ${clipped}` : "Open diagram";
}

function countModel(model: GraphModel): { nodes: number; edges: number; groups: number } {
  return {
    nodes: model.nodes.length,
    edges: model.edges.length,
    groups: new Set(model.nodes.map((node) => node.group).filter(Boolean)).size,
  };
}

function describeNode(node: GraphNode): string {
  const bits = [node.label];
  if (node.group) bits.push(node.group);
  if (node.className) bits.push(node.className);
  if (node.diagram) bits.push(node.diagram);
  return bits.join(" · ");
}

function groupEdges(edges: readonly GraphEdge[]): Map<string, GraphEdge[]> {
  const map = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const key = `${edge.source}\0${edge.target}`;
    const list = map.get(key) ?? [];
    list.push(edge);
    map.set(key, list);
  }
  return map;
}

function sourceToPlain(source: DataSourceConfig): Record<string, unknown> {
  const plain: Record<string, unknown> = {
    file: source.file,
    format: source.format,
    shape: source.shape,
    mapping: source.mapping,
    direction: source.direction,
    grouping: source.grouping,
    diagramType: "flowchart",
  };
  if (source.edgesFile) plain.edgesFile = source.edgesFile;
  if (source.edgesFormat) plain.edgesFormat = source.edgesFormat;
  if (source.edgesMapping && Object.keys(source.edgesMapping).length > 0) plain.edgesMapping = source.edgesMapping;
  return plain;
}

function configFromPlain(block: Record<string, unknown>): DataSourceConfig | null {
  const file = typeof block.file === "string" ? block.file : "";
  if (!isSafeDataPath(file)) return null;
  if (block.format !== "csv" && block.format !== "json") return null;
  if (typeof block.shape !== "string" || !SHAPES.has(block.shape as DataShape)) return null;
  const direction = typeof block.direction === "string" ? block.direction.toUpperCase() : "TD";
  if (!DIRECTIONS.has(direction as FlowDirection)) return null;
  const mapping = mappingFromPlain(block.mapping);
  if (!mapping) return null;
  const config: DataSourceConfig = {
    file,
    format: block.format,
    shape: block.shape as DataShape,
    mapping,
    direction: direction as FlowDirection,
    grouping: block.grouping !== false,
    diagramType: "flowchart",
  };
  if (typeof block.edgesFile === "string" && block.edgesFile) {
    if (!isSafeDataPath(block.edgesFile)) return null;
    config.edgesFile = block.edgesFile;
  }
  if (block.edgesFormat === "csv" || block.edgesFormat === "json") config.edgesFormat = block.edgesFormat;
  const edgesMapping = mappingFromPlain(block.edgesMapping);
  if (block.edgesMapping != null && !edgesMapping) return null;
  if (edgesMapping && Object.keys(edgesMapping).length > 0) config.edgesMapping = edgesMapping;
  return config;
}

function mappingFromPlain(value: unknown): ColumnMapping | null {
  if (value == null) return {};
  if (!isRecord(value)) return null;
  const mapping: ColumnMapping = {};
  for (const field of DATA_FIELDS) {
    const column = value[field];
    if (column == null || column === "") continue;
    if (typeof column !== "string") return null;
    mapping[field] = column;
  }
  return mapping;
}

function cleanStoredName(value: string | undefined): string {
  if (!value || !isSafeDataPath(value)) return "";
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function defaultSourceName(format: DataFormat): string {
  return format === "json" ? "data.json" : "data.csv";
}

function defaultEdgesName(format: DataFormat): string {
  return format === "json" ? "edges.json" : "edges.csv";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function yamlText(match: FrontMatterMatch): string {
  const normalized = match.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!match.indent) return normalized;
  return normalized
    .split("\n")
    .map((line) => (line.startsWith(match.indent) ? line.slice(match.indent.length) : line))
    .join("\n");
}

function loadYaml(source: string): { doc: Document; body: string; bom: string } | { error: string } {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = bom ? source.slice(1) : source;
  const match = matchFrontMatter(text);
  if (!match) return { doc: new Document({}), body: text, bom };
  const doc = parseDocument(yamlText(match), { schema: "core", prettyErrors: false });
  if (doc.errors.length > 0) return { error: "The YAML header could not be parsed." };
  if (!isMap(doc.contents)) return { error: "Front matter must be a YAML mapping." };
  return { doc, body: text.slice(match.length), bom };
}

function fence(doc: Document, body: string, bom = ""): string {
  if (!isMap(doc.contents) || doc.contents.items.length === 0) return bom + body.replace(/^\n/, "");
  let yaml = doc.toString({ lineWidth: 0 });
  if (!yaml.endsWith("\n")) yaml += "\n";
  const rest = body.startsWith("\n") ? body.slice(1) : body;
  return `${bom}---\n${yaml}---\n${rest}`;
}

function findExactLine(
  source: string,
  exact: string,
  from = 0,
): { start: number; end: number } | null {
  let index = from;
  while (index <= source.length) {
    const newline = source.indexOf("\n", index);
    const end = newline === -1 ? source.length : newline + 1;
    const line = source.slice(index, newline === -1 ? source.length : newline).replace(/\r$/, "");
    if (line.trim() === exact) return { start: index, end };
    if (newline === -1) break;
    index = end;
  }
  return null;
}
