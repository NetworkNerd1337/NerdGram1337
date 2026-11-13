import {
  EDGE_FIELDS,
  SHAPE_FIELDS,
  suggestMapping,
  type ColumnMapping,
  type DataShape,
  type FieldSpec,
  type FlowDirection,
  type RowIssue,
} from "../../../server/src/diagramData.ts";
import { ensureMmd, joinPath } from "./paths";

export type WizardStep = "input" | "map" | "preview";

export type WizardInspection = {
  format: "csv" | "json";
  shape: DataShape;
  headers: string[];
  edgesHeaders: string[];
  mapping: ColumnMapping;
  edgesMapping: ColumnMapping;
  errors: RowIssue[];
  warnings: RowIssue[];
  mermaid: string;
  counts: { nodes: number; edges: number; groups: number };
  direction: FlowDirection;
  grouping: boolean;
};

export type WizardState = {
  step: WizardStep;
  text: string;
  fileName: string;
  edgesText: string;
  edgesFileName: string;
  format: "auto" | "csv" | "json";
  shape: "auto" | DataShape;
  mapping: ColumnMapping;
  edgesMapping: ColumnMapping;
  direction: FlowDirection;
  grouping: boolean;
  diagramName: string;
  folder: string;
  title: string;
  headers: string[];
  edgesHeaders: string[];
  errors: RowIssue[];
  warnings: RowIssue[];
  mermaid: string;
  counts: { nodes: number; edges: number; groups: number };
  detectedShape: DataShape | "";
  fatal: string | null;
};

export type WizardAction =
  | { type: "text"; text: string; fileName?: string }
  | { type: "edges"; text: string; fileName?: string }
  | { type: "format"; format: WizardState["format"] }
  | { type: "shape"; shape: WizardState["shape"] }
  | { type: "mapping"; field: string; column: string }
  | { type: "edgesMapping"; field: string; column: string }
  | { type: "direction"; direction: FlowDirection }
  | { type: "grouping"; grouping: boolean }
  | { type: "meta"; diagramName?: string; folder?: string; title?: string }
  | { type: "result"; result: WizardInspection; step: "map" | "preview" }
  | { type: "fatal"; message: string }
  | { type: "back" };

export function initialWizardState(folder = ""): WizardState {
  return {
    step: "input",
    text: "",
    fileName: "",
    edgesText: "",
    edgesFileName: "",
    format: "auto",
    shape: "auto",
    mapping: {},
    edgesMapping: {},
    direction: "LR",
    grouping: true,
    diagramName: "Untitled",
    folder,
    title: "",
    headers: [],
    edgesHeaders: [],
    errors: [],
    warnings: [],
    mermaid: "",
    counts: { nodes: 0, edges: 0, groups: 0 },
    detectedShape: "",
    fatal: null,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "text": {
      const stem = stemFromFile(action.fileName);
      const untouched = state.diagramName === "Untitled" || state.diagramName === stemFromFile(state.fileName);
      return {
        ...state,
        text: action.text,
        fileName: action.fileName ?? state.fileName,
        diagramName: action.fileName && untouched && stem ? stem : state.diagramName,
        title: state.title || stem || state.title,
        fatal: null,
      };
    }
    case "edges":
      return {
        ...state,
        edgesText: action.text,
        edgesFileName: action.fileName ?? state.edgesFileName,
        fatal: null,
      };
    case "format":
      return { ...state, format: action.format, fatal: null };
    case "shape":
      return {
        ...state,
        shape: action.shape,
        mapping: remap(state.headers, action.shape, state.detectedShape),
        fatal: null,
      };
    case "mapping":
      return { ...state, mapping: setColumn(state.mapping, action.field, action.column), fatal: null };
    case "edgesMapping":
      return { ...state, edgesMapping: setColumn(state.edgesMapping, action.field, action.column), fatal: null };
    case "direction":
      return { ...state, direction: action.direction, fatal: null };
    case "grouping":
      return { ...state, grouping: action.grouping, fatal: null };
    case "meta":
      return {
        ...state,
        diagramName: action.diagramName ?? state.diagramName,
        folder: action.folder ?? state.folder,
        title: action.title ?? state.title,
      };
    case "result":
      return {
        ...state,
        step: action.step,
        headers: action.result.headers,
        edgesHeaders: action.result.edgesHeaders,
        mapping: action.result.mapping,
        edgesMapping: action.result.edgesMapping,
        errors: action.result.errors,
        warnings: action.result.warnings,
        mermaid: action.result.mermaid,
        counts: action.result.counts,
        detectedShape: action.result.shape,
        direction: action.result.direction,
        grouping: action.result.grouping,
        shape: state.shape === "auto" ? action.result.shape : state.shape,
        fatal: null,
      };
    case "fatal":
      return { ...state, fatal: action.message };
    case "back":
      if (state.step === "preview") return { ...state, step: "map", fatal: null };
      if (state.step === "map") return { ...state, step: "input", fatal: null };
      return state;
    default:
      return state;
  }
}

export function canInspect(state: WizardState): boolean {
  return state.text.trim().length > 0;
}

export function canCreate(state: WizardState): boolean {
  return state.step === "preview" && state.errors.length === 0 && state.mermaid.trim().length > 0 && state.diagramName.trim().length > 0;
}

export function activeShape(state: WizardState): DataShape {
  if (state.shape !== "auto") return state.shape;
  return state.detectedShape || "links";
}

export function fieldsFor(state: WizardState): readonly FieldSpec[] {
  const shape = activeShape(state);
  if (shape === "graph") return SHAPE_FIELDS.nodes;
  return SHAPE_FIELDS[shape];
}

export function showEdgeFields(state: WizardState): boolean {
  const shape = activeShape(state);
  return shape === "graph" || shape === "nodes" || state.edgesText.trim().length > 0;
}

export function edgeFields(): readonly FieldSpec[] {
  return EDGE_FIELDS;
}

export function previewRequest(state: WizardState): {
  text: string;
  format: string;
  shape: string;
  mapping: ColumnMapping;
  edgesText?: string;
  edgesMapping: ColumnMapping;
  direction: FlowDirection;
  grouping: boolean;
  title: string;
  sourceFile: string;
} {
  return {
    text: state.text,
    format: state.format,
    shape: state.shape,
    mapping: state.mapping,
    edgesText: state.edgesText.trim() ? state.edgesText : undefined,
    edgesMapping: state.edgesMapping,
    direction: state.direction,
    grouping: state.grouping,
    title: state.title.trim() || state.diagramName.trim() || "Diagram",
    sourceFile: dataFilePath(state),
  };
}

export function diagramFilePath(state: WizardState): string {
  return joinPath(state.folder.trim(), ensureMmd(state.diagramName));
}

export function dataFilePath(state: WizardState): string {
  const ext = state.format === "json" || state.fileName.toLowerCase().endsWith(".json") ? "json" : "csv";
  const stem = (state.diagramName.trim() || "data").replace(/\.mmd$/i, "");
  return joinPath(state.folder.trim(), `${stem}.${ext}`);
}

function remap(headers: readonly string[], shape: WizardState["shape"], detected: DataShape | ""): ColumnMapping {
  const chosen = shape === "auto" ? detected || "links" : shape;
  if (chosen === "edges") return suggestMapping(headers, "edges");
  const mapping = suggestMapping(headers, chosen === "graph" ? "nodes" : chosen);
  return mapping;
}

function setColumn(mapping: ColumnMapping, field: string, column: string): ColumnMapping {
  const next: ColumnMapping = { ...mapping };
  if (!column) delete next[field as keyof ColumnMapping];
  else next[field as keyof ColumnMapping] = column;
  return next;
}

function stemFromFile(fileName: string | undefined): string {
  if (!fileName) return "";
  const base = fileName.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.(csv|json|txt)$/i, "").trim();
}
