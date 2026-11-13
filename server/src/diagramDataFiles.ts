import fs from "node:fs/promises";
import path from "node:path";
import { extensionForFormat } from "./dataFiles.js";
import {
  assertDataPath,
  dataFail,
  DATA_LIMITS,
  diffModels,
  importDiagramData,
  isSafeDataPath,
  readDataSource,
  readGeneratedModel,
  renderNewDiagram,
  renderRefresh,
  type DataFormat,
  type GraphDiff,
  type ImportInput,
  type ImportResult,
  type RowIssue,
} from "./diagramData.js";
import * as store from "./fsStore.js";
import { resolveSafePath } from "./paths.js";
import { atomicWriteText, httpFail, normalizeRelative, pathExists, resolveAvailablePath } from "./storage.js";

export type CreateGeneratedInput = ImportInput & {
  path: string;
  /** Defaults to true. The data file is written next to the diagram. */
  storeData?: boolean;
  dataName?: string;
};

export type RefreshGeneratedInput = {
  path: string;
  /** Current editor text. When omitted, the diagram is read from disk. */
  diagramText?: string;
  /** Replacement data. When omitted, the file named in the front matter is read. */
  text?: string;
  edgesText?: string;
  /** Write `text` back to the stored data file. The diagram itself is not saved here. */
  writeData?: boolean;
};

export type RefreshGeneratedResult = {
  path: string;
  dataPath: string;
  mermaid: string;
  diff: GraphDiff;
  warnings: RowIssue[];
  counts: ImportResult["counts"];
};

export async function readDataFile(relativePath: string): Promise<string> {
  const normalized = assertDataPath(relativePath);
  const abs = resolveSafePath(normalized);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw dataFail(404, "The data file is not in the workspace.", "not_found");
    throw err;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw dataFail(400, "The data file is not a regular file.", "invalid");
  }
  if (stat.size > DATA_LIMITS.maxChars) throw dataFail(400, "The data file is larger than 512 KB.", "invalid");
  const text = await fs.readFile(abs, "utf8");
  if (text.includes("\0") || text.length > DATA_LIMITS.maxChars) {
    throw dataFail(400, "The data file is not usable text.", "invalid");
  }
  return text;
}

export async function writeDataFile(relativePath: string, text: string): Promise<string> {
  const normalized = assertDataPath(relativePath);
  if (typeof text !== "string" || text.includes("\0")) throw dataFail(400, "The data file is not text.", "invalid");
  if (text.length > DATA_LIMITS.maxChars) throw dataFail(400, "The data file is larger than 512 KB.", "invalid");
  const abs = resolveSafePath(normalized);
  let stat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    stat = await fs.lstat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
  if (stat?.isSymbolicLink()) throw dataFail(400, "Refusing to write through a symlink.", "invalid");
  if (stat && !stat.isFile()) throw dataFail(400, "A folder is already at that data path.", "invalid");
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await atomicWriteText(abs, text);
  return normalized;
}

export function importInputFromBody(body: Record<string, unknown>): ImportInput {
  if (typeof body.text !== "string") throw dataFail(400, "text must be a string.", "invalid");
  const input: ImportInput = { text: body.text };
  if (body.format != null) {
    if (typeof body.format !== "string") throw dataFail(400, "format must be a string.", "invalid");
    input.format = body.format;
  }
  if (body.shape != null) {
    if (typeof body.shape !== "string") throw dataFail(400, "shape must be a string.", "invalid");
    input.shape = body.shape;
  }
  if (body.mapping != null) input.mapping = body.mapping;
  if (body.edgesText != null) {
    if (typeof body.edgesText !== "string") throw dataFail(400, "edgesText must be a string.", "invalid");
    input.edgesText = body.edgesText;
  }
  if (body.edgesFormat != null) {
    if (typeof body.edgesFormat !== "string") throw dataFail(400, "edgesFormat must be a string.", "invalid");
    input.edgesFormat = body.edgesFormat;
  }
  if (body.edgesMapping != null) input.edgesMapping = body.edgesMapping;
  if (body.direction != null) {
    if (typeof body.direction !== "string") throw dataFail(400, "direction must be a string.", "invalid");
    input.direction = body.direction;
  }
  if (body.grouping != null) {
    if (typeof body.grouping !== "boolean") throw dataFail(400, "grouping must be a boolean.", "invalid");
    input.grouping = body.grouping;
  }
  if (body.title != null) {
    if (typeof body.title !== "string") throw dataFail(400, "title must be a string.", "invalid");
    input.title = body.title;
  }
  if (body.description != null) {
    if (typeof body.description !== "string") throw dataFail(400, "description must be a string.", "invalid");
    input.description = body.description;
  }
  if (body.sourceFile != null) {
    if (typeof body.sourceFile !== "string") throw dataFail(400, "sourceFile must be a string.", "invalid");
    input.sourceFile = body.sourceFile;
  }
  if (body.edgesFile != null) {
    if (typeof body.edgesFile !== "string") throw dataFail(400, "edgesFile must be a string.", "invalid");
    input.edgesFile = body.edgesFile;
  }
  if (body.localDevice != null) {
    if (typeof body.localDevice !== "string") throw dataFail(400, "localDevice must be a string.", "invalid");
    input.localDevice = body.localDevice;
  }
  if (body.groupBy != null) {
    if (typeof body.groupBy !== "string") throw dataFail(400, "groupBy must be a string.", "invalid");
    input.groupBy = body.groupBy;
  }
  return input;
}

export async function createGeneratedDiagram(input: CreateGeneratedInput): Promise<{
  path: string;
  dataPath: string;
  edgesPath: string;
  mermaid: string;
  counts: ImportResult["counts"];
  warnings: RowIssue[];
}> {
  const diagramPath = assertDiagramPath(input.path);
  if (await pathExists(resolveSafePath(diagramPath))) {
    throw httpFail(409, "A diagram already exists at that path. Choose a different name.", "exists", {
      path: diagramPath,
    });
  }
  const preview = importDiagramData(input);
  if (preview.errors.length > 0) {
    throw dataFail(400, "Fix the rows listed before creating the diagram.", "invalid", { errors: preview.errors });
  }

  let dataPath = "";
  let edgesPath = "";
  if (input.storeData !== false) {
    const desired = input.dataName ? assertDataPath(input.dataName) : siblingDataPath(diagramPath, preview.format, "data");
    dataPath = await freeDataPath(desired);
    await writeDataFile(dataPath, input.text);
    if (input.edgesText?.trim() && (preview.shape === "graph" || preview.shape === "nodes")) {
      const edgesFormat = preview.source.edgesFormat ?? (detectEdgesFormat(input.edgesText) || "csv");
      edgesPath = await freeDataPath(siblingDataPath(diagramPath, edgesFormat, "edges"));
      await writeDataFile(edgesPath, input.edgesText);
    }
  }

  const source = {
    ...preview.source,
    file: dataPath || preview.source.file,
    edgesFile: edgesPath || preview.source.edgesFile,
  };
  if (!edgesPath) delete source.edgesFile;
  const mermaid = renderNewDiagram({
    model: preview.model,
    source,
    title: clipPlain(input.title) || titleFromPath(diagramPath),
    description: clipPlain(input.description) || (dataPath ? `Generated from ${dataPath}` : undefined),
  });
  const written = await store.writeFile(diagramPath, mermaid);
  return {
    path: written.path,
    dataPath,
    edgesPath,
    mermaid,
    counts: preview.counts,
    warnings: preview.warnings,
  };
}

export async function refreshGeneratedDiagram(input: RefreshGeneratedInput): Promise<RefreshGeneratedResult> {
  const diagramPath = assertDiagramPath(input.path);
  const current =
    input.diagramText != null ? requireDiagramText(input.diagramText) : (await store.readFile(diagramPath)).content;
  const config = readDataSource(current);
  if (!config) throw dataFail(400, "This diagram has no data source in its front matter.", "invalid");

  const text = input.text != null ? requireDiagramText(input.text) : await readDataFile(config.file);
  let edgesText = input.edgesText;
  if (edgesText == null && config.edgesFile) edgesText = await readDataFile(config.edgesFile);

  const imported = importDiagramData({
    text,
    format: config.format,
    shape: config.shape,
    mapping: config.mapping,
    edgesText,
    edgesFormat: config.edgesFormat,
    edgesMapping: config.edgesMapping,
    direction: config.direction,
    grouping: config.grouping,
    sourceFile: config.file,
    edgesFile: config.edgesFile,
    localDevice: config.localDevice,
    groupBy: config.groupBy,
  });
  if (imported.errors.length > 0) {
    throw dataFail(400, "Fix the rows listed before refreshing.", "invalid", { errors: imported.errors });
  }

  const before = readGeneratedModel(current) ?? { nodes: [], edges: [] };
  const diff = diffModels(before, imported.model);
  const mermaid = renderRefresh(current, imported.model, {
    ...imported.source,
    file: config.file,
    edgesFile: config.edgesFile,
    direction: config.direction,
    grouping: config.grouping,
    shape: config.shape,
    format: config.format,
    mapping: config.mapping,
    edgesMapping: config.edgesMapping,
    edgesFormat: config.edgesFormat,
    groupBy: config.groupBy,
    localDevice: config.localDevice,
  });
  if (input.writeData) {
    await writeDataFile(config.file, text);
    if (config.edgesFile && edgesText != null && input.edgesText != null) {
      await writeDataFile(config.edgesFile, edgesText);
    }
  }
  return {
    path: diagramPath,
    dataPath: config.file,
    mermaid,
    diff,
    warnings: imported.warnings,
    counts: imported.counts,
  };
}

function requireDiagramText(value: string): string {
  if (typeof value !== "string") throw dataFail(400, "Diagram text must be a string.", "invalid");
  if (value.includes("\0")) throw dataFail(400, "Diagram text is not valid.", "invalid");
  if (value.length > 1_000_000) throw dataFail(400, "Diagram text is too large.", "invalid");
  return value;
}

function assertDiagramPath(relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.includes("\0")) {
    throw dataFail(400, "That diagram path is not allowed.", "invalid");
  }
  const normalized = normalizeRelative(relativePath);
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => part.length === 0 || part === "." || part === ".." || part.startsWith("."))) {
    throw dataFail(400, "That diagram path is not allowed.", "invalid");
  }
  if (!normalized.toLowerCase().endsWith(".mmd")) throw dataFail(400, "Diagrams are .mmd files.", "invalid");
  return normalized;
}

function siblingDataPath(diagramPath: string, format: DataFormat, role: "data" | "edges"): string {
  const stem = diagramPath.replace(/\.mmd$/i, "");
  const ext = extensionForFormat(format);
  return role === "edges" ? `${stem}.edges.${ext}` : `${stem}.${ext}`;
}

async function freeDataPath(desired: string): Promise<string> {
  const normalized = assertDataPath(desired);
  return resolveAvailablePath(normalized, async (candidate) => {
    if (!isSafeDataPath(candidate)) return true;
    return pathExists(resolveSafePath(candidate));
  });
}

function clipPlain(value: string | undefined): string {
  if (!value) return "";
  return [...value]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 200);
}

function titleFromPath(diagramPath: string): string {
  const base = diagramPath.split("/").pop() ?? diagramPath;
  return base.replace(/\.mmd$/i, "") || "Diagram";
}

function detectEdgesFormat(text: string): DataFormat | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "csv";
}
