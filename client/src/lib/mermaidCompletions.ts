import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";

const DIAGRAM_TYPES: Completion[] = [
  { label: "flowchart", type: "keyword", detail: "Flowchart diagram" },
  { label: "sequenceDiagram", type: "keyword", detail: "Sequence diagram" },
  { label: "classDiagram", type: "keyword", detail: "Class diagram" },
  { label: "stateDiagram-v2", type: "keyword", detail: "State diagram" },
  { label: "erDiagram", type: "keyword", detail: "Entity relationship" },
  { label: "gantt", type: "keyword", detail: "Gantt chart" },
  { label: "pie", type: "keyword", detail: "Pie chart" },
  { label: "mindmap", type: "keyword", detail: "Mind map" },
  { label: "timeline", type: "keyword", detail: "Timeline" },
  { label: "journey", type: "keyword", detail: "User journey" },
  { label: "gitGraph", type: "keyword", detail: "Git graph" },
  { label: "C4Context", type: "keyword", detail: "C4 context" },
  { label: "quadrantChart", type: "keyword", detail: "Quadrant chart" },
  { label: "requirementDiagram", type: "keyword", detail: "Requirement diagram" },
  { label: "sankey-beta", type: "keyword", detail: "Sankey" },
  { label: "xychart-beta", type: "keyword", detail: "XY chart" },
  { label: "block-beta", type: "keyword", detail: "Block diagram" },
  { label: "architecture-beta", type: "keyword", detail: "Architecture" },
  { label: "kanban", type: "keyword", detail: "Kanban" },
  { label: "packet-beta", type: "keyword", detail: "Packet" },
];

const DIRECTIONS: Completion[] = ["LR", "TD", "TB", "RL", "BT"].map((label) => ({
  label,
  type: "constant",
  detail: "Flowchart direction",
}));

const KEYWORDS: Completion[] = [
  { label: "subgraph", type: "keyword" },
  { label: "end", type: "keyword" },
  { label: "participant", type: "keyword" },
  { label: "actor", type: "keyword" },
  { label: "Note", type: "keyword" },
  { label: "note", type: "keyword" },
  { label: "loop", type: "keyword" },
  { label: "alt", type: "keyword" },
  { label: "else", type: "keyword" },
  { label: "opt", type: "keyword" },
  { label: "par", type: "keyword" },
  { label: "and", type: "keyword" },
  { label: "rect", type: "keyword" },
  { label: "activate", type: "keyword" },
  { label: "deactivate", type: "keyword" },
  { label: "class", type: "keyword" },
  { label: "classDef", type: "keyword" },
  { label: "style", type: "keyword" },
  { label: "linkStyle", type: "keyword" },
  { label: "click", type: "keyword" },
  { label: "direction", type: "keyword" },
  { label: "title", type: "keyword" },
  { label: "section", type: "keyword" },
  { label: "dateFormat", type: "keyword" },
  { label: "state", type: "keyword" },
  { label: "[*]", type: "keyword", detail: "State start/end" },
];

const ARROWS: Completion[] = [
  { label: "-->", type: "operator", detail: "Arrow" },
  { label: "---", type: "operator", detail: "Link" },
  { label: "-.->", type: "operator", detail: "Dotted arrow" },
  { label: "==>", type: "operator", detail: "Thick arrow" },
  { label: "->>", type: "operator", detail: "Sequence solid" },
  { label: "-->>", type: "operator", detail: "Sequence open" },
  { label: "--)", type: "operator", detail: "Sequence async" },
  { label: "-)", type: "operator", detail: "Sequence async open" },
  { label: "->", type: "operator", detail: "Short arrow" },
];

const SNIPPETS: Completion[] = [
  snippetCompletion(
    "flowchart ${LR}\n  ${A}[${Start}] --> ${B}[${End}]\n",
    {
      label: "snippet: flowchart",
      type: "text",
      detail: "Basic flowchart",
    },
  ),
  snippetCompletion(
    "subgraph ${id} [${Title}]\n  ${A} --> ${B}\nend\n",
    {
      label: "snippet: subgraph",
      type: "text",
      detail: "Subgraph block",
    },
  ),
  snippetCompletion(
    "sequenceDiagram\n  participant ${A}\n  participant ${B}\n  ${A}->>${B}: ${Hello}\n",
    {
      label: "snippet: sequence",
      type: "text",
      detail: "Sequence participants",
    },
  ),
  snippetCompletion(
    "classDiagram\n  class ${ClassName} {\n    +${field}\n    +${method}()\n  }\n",
    {
      label: "snippet: class",
      type: "text",
      detail: "Class with members",
    },
  ),
  snippetCompletion(
    "stateDiagram-v2\n  [*] --> ${State1}\n  ${State1} --> ${State2}\n  ${State2} --> [*]\n",
    {
      label: "snippet: state",
      type: "text",
      detail: "State diagram",
    },
  ),
  snippetCompletion(
    "---\ntitle: ${title}\nconfig:\n  theme: ${forest}\n---\nflowchart ${LR}\n  ${A}[${Start}] --> ${B}[${End}]\n",
    {
      label: "snippet: front matter",
      type: "text",
      detail: "Title and theme header",
    },
  ),
];

const STATIC: Completion[] = [
  ...DIAGRAM_TYPES,
  ...DIRECTIONS,
  ...KEYWORDS,
  ...ARROWS,
  ...SNIPPETS,
];

/** Collect likely node / participant IDs already present in the document. */
export function extractNodeIds(doc: string): string[] {
  const ids = new Set<string>();
  const lines = doc.split(/\r?\n/);
  let inFrontMatter = false;
  let sawDiagram = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!sawDiagram && trimmed === "---") {
      inFrontMatter = !inFrontMatter;
      if (!inFrontMatter) sawDiagram = false;
      continue;
    }
    if (inFrontMatter) continue;
    if (!trimmed || trimmed.startsWith("%%")) continue;
    sawDiagram = true;

    // participant / actor Foo or participant Foo as Alias
    const participant = trimmed.match(
      /^(?:participant|actor)\s+([A-Za-z_][\w-]*)/i,
    );
    if (participant?.[1]) ids.add(participant[1]);

    // Node forms: Id[...], Id(...), Id((...)), Id{...}, Id>
    const nodeShapes = trimmed.matchAll(
      /\b([A-Za-z_][\w-]*)\s*(?=[\[\(\{>@])/g,
    );
    for (const m of nodeShapes) {
      if (m[1] && !isReserved(m[1])) ids.add(m[1]);
    }

    // Bare IDs around arrows: A --> B
    const arrowParts = trimmed.split(
      /\s*(?:-->|---|-\.->|==>|->>|-->>|--\)|-\)|->)\s*/,
    );
    for (const part of arrowParts) {
      const id = part
        .replace(/[[({].*$/, "")
        .replace(/^[^A-Za-z_]+/, "")
        .match(/^([A-Za-z_][\w-]*)/);
      if (id?.[1] && !isReserved(id[1])) ids.add(id[1]);
    }
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
}

function isReserved(word: string): boolean {
  const lower = word.toLowerCase();
  return (
    lower === "flowchart" ||
    lower === "graph" ||
    lower === "subgraph" ||
    lower === "end" ||
    lower === "participant" ||
    lower === "actor" ||
    lower === "sequenceDiagram".toLowerCase() ||
    lower === "classDiagram".toLowerCase() ||
    lower === "statediagram" ||
    lower === "statediagram-v2" ||
    lower === "erdiagram" ||
    lower === "direction" ||
    lower === "style" ||
    lower === "classdef" ||
    lower === "click" ||
    lower === "note" ||
    ["lr", "td", "tb", "rl", "bt"].includes(lower)
  );
}

export function mermaidCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_0-9${}>.=*-]+/);
  if (!word && !context.explicit) return null;
  if (word && word.from === word.to && !context.explicit) return null;

  const doc = context.state.doc.toString();
  const nodeIds = extractNodeIds(doc).map(
    (label): Completion => ({
      label,
      type: "variable",
      detail: "Node / participant in this diagram",
      boost: 5,
    }),
  );

  const options = [...STATIC, ...nodeIds];
  return {
    from: word ? word.from : context.pos,
    options,
    validFor: /^[A-Za-z_0-9${}>.=*-]*$/,
  };
}
