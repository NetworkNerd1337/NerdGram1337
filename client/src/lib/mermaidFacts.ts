import type { AstFacts } from "../../../server/src/diagramLint.ts";

/**
 * Read the node and edge lists Mermaid keeps after a successful parse.
 * Flowchart, sequence, and state diagrams expose those lists on the diagram
 * database. Other diagram types, and a database this version doesn't
 * recognize, return null so the text rules stand on their own.
 */
export function readAstFacts(diagram: unknown): AstFacts | null {
  if (!diagram || typeof diagram !== "object" || !("db" in diagram)) return null;
  const db = (diagram as { db?: unknown }).db;
  if (!db || typeof db !== "object") return null;
  const kind = diagramKind(diagram);
  if (kind === "flowchart") return flowchartFacts(db);
  if (kind === "sequence") return sequenceFacts(db);
  if (kind === "state") return stateFacts(db);
  return null;
}

function diagramKind(diagram: object): AstFacts["kind"] {
  const type = "type" in diagram && typeof diagram.type === "string" ? diagram.type.toLowerCase() : "";
  if (type.includes("flowchart") || type === "graph") return "flowchart";
  if (type.includes("sequence")) return "sequence";
  if (type.includes("state")) return "state";
  return "other";
}

function flowchartFacts(db: object): AstFacts | null {
  const vertices = call(db, "getVertices");
  const edges = call(db, "getEdges");
  const nodes = mapValues(vertices).flatMap((value) => {
    if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") return [];
    const text = "text" in value && typeof value.text === "string" ? value.text : null;
    return [{ id: value.id, label: text && text !== value.id ? text : null }];
  });
  const links = listValues(edges).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const start = "start" in value && typeof value.start === "string" ? value.start : null;
    const end = "end" in value && typeof value.end === "string" ? value.end : null;
    if (!start || !end) return [];
    return [{ from: start, to: end }];
  });
  if (nodes.length === 0 && links.length === 0) return null;
  return { kind: "flowchart", nodes, edges: links };
}

function sequenceFacts(db: object): AstFacts | null {
  const actors = mapValues(call(db, "getActors"));
  const messages = listValues(call(db, "getMessages"));
  const nodes = actors.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const id = stringField(value, "name") ?? stringField(value, "id");
    if (!id) return [];
    const description = value && typeof value === "object" && "description" in value ? value.description : null;
    const alias =
      description && typeof description === "object" && "text" in description && typeof description.text === "string"
        ? description.text
        : null;
    return [{ id, label: alias && alias !== id ? alias : id }];
  });
  const edges = messages.flatMap((value) => {
    const from = stringField(value, "from");
    const to = stringField(value, "to");
    if (!from || !to) return [];
    return [{ from, to }];
  });
  if (nodes.length === 0 && edges.length === 0) return null;
  return { kind: "sequence", nodes, edges };
}

function stateFacts(db: object): AstFacts | null {
  const states = mapValues(call(db, "getStates"));
  const relations = listValues(call(db, "getRelations"));
  const nodes = states.flatMap((value) => {
    const id = stringField(value, "id");
    if (!id || id === "[*]") return [];
    const descriptions = value && typeof value === "object" && "descriptions" in value ? value.descriptions : null;
    const label = Array.isArray(descriptions) && typeof descriptions[0] === "string" ? descriptions[0] : null;
    return [{ id, label }];
  });
  const edges = relations.flatMap((value) => {
    const from = stringField(value, "id1");
    const to = stringField(value, "id2");
    if (!from || !to || from === "[*]" || to === "[*]") return [];
    return [{ from, to }];
  });
  if (nodes.length === 0 && edges.length === 0) return null;
  return { kind: "state", nodes, edges };
}

function call(db: object, name: string): unknown {
  const fn = (db as Record<string, unknown>)[name];
  if (typeof fn !== "function") return null;
  return fn.call(db);
}

function mapValues(value: unknown): unknown[] {
  if (!value) return [];
  if (value instanceof Map) return [...value.values()];
  if (typeof value === "object" && !Array.isArray(value)) return Object.values(value);
  return [];
}

function listValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  return [];
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || !(key in value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : null;
}
