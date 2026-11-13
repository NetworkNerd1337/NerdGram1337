import {
  EDGE_FIELDS,
  SHAPE_FIELDS,
  suggestMapping,
  type ColumnMapping,
  type DataFormat,
  type DataShape,
  type FieldSpec,
  type FlowDirection,
  type GroupBy,
  type RowIssue,
} from "../../../server/src/diagramData.ts";
import { ensureMmd, joinPath } from "./paths";

export type WizardStep = "input" | "map" | "preview";

export type WizardFormat = "auto" | DataFormat;

export type WizardInspection = {
  format: DataFormat;
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
  format: WizardFormat;
  shape: "auto" | DataShape;
  mapping: ColumnMapping;
  edgesMapping: ColumnMapping;
  direction: FlowDirection;
  grouping: boolean;
  groupBy: GroupBy;
  localDevice: string;
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
  detectedFormat: DataFormat | "";
  fatal: string | null;
};

export type WizardAction =
  | { type: "text"; text: string; fileName?: string }
  | { type: "edges"; text: string; fileName?: string }
  | { type: "format"; format: WizardState["format"] }
  | { type: "localDevice"; localDevice: string }
  | { type: "groupBy"; groupBy: GroupBy }
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
    groupBy: "platform",
    localDevice: "",
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
    detectedFormat: "",
    fatal: null,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "text": {
      const stem = stemFromFile(action.fileName);
      const untouched = state.diagramName === "Untitled" || state.diagramName === stemFromFile(state.fileName);
      const guessed = state.format === "auto" ? formatFromName(action.fileName) : null;
      return {
        ...state,
        text: action.text,
        fileName: action.fileName ?? state.fileName,
        format: guessed ?? state.format,
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
    case "localDevice":
      return { ...state, localDevice: action.localDevice, fatal: null };
    case "groupBy":
      return { ...state, groupBy: action.groupBy, fatal: null };
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
        detectedFormat: action.result.format,
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
  groupBy: GroupBy;
  localDevice?: string;
  title: string;
  sourceFile: string;
} {
  return {
    text: state.text,
    format: state.format,
    shape: isNeighborSource(state) ? "links" : state.shape,
    mapping: state.mapping,
    edgesText: isNeighborSource(state) || !state.edgesText.trim() ? undefined : state.edgesText,
    edgesMapping: state.edgesMapping,
    direction: state.direction,
    grouping: state.grouping,
    groupBy: state.groupBy,
    localDevice: state.localDevice.trim() || undefined,
    title: state.title.trim() || state.diagramName.trim() || "Diagram",
    sourceFile: dataFilePath(state),
  };
}

export function isNeighborSource(state: WizardState): boolean {
  if (state.format === "cdp" || state.format === "lldp") return true;
  if (state.format === "auto") return state.detectedFormat === "cdp" || state.detectedFormat === "lldp";
  return false;
}

export function diagramFilePath(state: WizardState): string {
  return joinPath(state.folder.trim(), ensureMmd(state.diagramName));
}

export function dataFilePath(state: WizardState): string {
  const selected = state.format === "auto" ? state.detectedFormat : state.format;
  const ext =
    selected === "json" || selected === "cdp" || selected === "lldp"
      ? selected
      : state.fileName.toLowerCase().endsWith(".json")
        ? "json"
        : "csv";
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
  return base.replace(/\.(csv|json|txt|cdp|lldp)$/i, "").trim();
}

function formatFromName(fileName: string | undefined): WizardFormat | null {
  const lower = fileName?.toLowerCase() ?? "";
  if (lower.endsWith(".cdp")) return "cdp";
  if (lower.endsWith(".lldp")) return "lldp";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  return null;
}
