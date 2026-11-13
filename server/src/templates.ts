import fs from "node:fs/promises";
import path from "node:path";
import { diagramConfigKey, parseDiagram } from "./frontMatter.js";
import { writeFile } from "./fsStore.js";
import { REPO_ROOT, resolveSafePath, toRelativePath } from "./paths.js";
import {
  httpFail,
  normalizeRelative,
  pathExists,
  resolveAvailablePath,
} from "./storage.js";

/**
 * Bundled diagram templates.
 *
 * Files live in `templates/` at the repo root, next to `reference/`, not in
 * the data directory. The dashboard, trash, search index, and a data-directory
 * mirror (#14) do not see them. User diagrams created from a template are
 * normal `.mmd` files under `NERDGRAM_DATA_DIR` and follow those features.
 *
 * There is no user-saved template store in this version. A container image
 * (#12) should copy this directory in and leave it read-only. The data volume
 * stays separate.
 *
 * Adding a template is dropping a `.mmd` file in this directory. The file
 * name is the id: lowercase letters, digits, and hyphens, then `.mmd`.
 * Subfolders and hidden names are ignored. The header is Mermaid front matter.
 * Title and `config.theme` are native. Description, tags, and category live
 * under `nerdgram`, which `parseDiagram` already reads.
 *
 * `GET` only reads this directory. Creating a diagram copies the bytes through
 * `writeFile`, which uses `evaluateWrite` (no overwrite) and
 * `resolveAvailablePath`. The target folder is checked with `resolveSafePath`,
 * so `.meta` and other dot paths are refused.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;
const FILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}\.mmd$/;

/** Shipped templates stay in this order. Any file dropped in later sorts by title. */
const PREFERRED_ORDER = [
  "network-topology",
  "home-lab",
  "firewall-policy",
  "rack-elevation",
  "flowchart-starter",
  "sequence-starter",
];

const TYPE_LABELS: Record<string, string> = {
  flowchart: "Flowchart",
  sequence: "Sequence",
  class: "Class",
  state: "State",
  er: "ER",
  gantt: "Gantt",
  journey: "Journey",
  pie: "Pie",
  mindmap: "Mindmap",
  timeline: "Timeline",
  gitGraph: "Git graph",
  c4: "C4",
  quadrantChart: "Quadrant",
  requirement: "Requirement",
  xyChart: "XY chart",
  block: "Block",
  sankey: "Sankey",
  packet: "Packet",
  kanban: "Kanban",
  architecture: "Architecture",
};

export type TemplateRecord = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  theme: string | null;
  diagramType: string;
  cacheKey: string;
  malformed: boolean;
  error: string | null;
  source: string;
};

export type CreatedFromTemplate = {
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  templateId: string;
};

export function getTemplatesRoot(): string {
  return path.join(REPO_ROOT, "templates");
}

export function diagramTypeLabel(body: string): string {
  const key = diagramConfigKey(body);
  if (!key) return "Diagram";
  return TYPE_LABELS[key] ?? "Diagram";
}

function assertId(id: string): string {
  const trimmed = id.trim();
  if (!ID_PATTERN.test(trimmed)) {
    throw httpFail(400, "Invalid template id", "invalid");
  }
  return trimmed;
}

function safeDataPath(relativePath: string): string {
  try {
    return resolveSafePath(relativePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid path";
    throw httpFail(400, message, "invalid");
  }
}

function isHttpError(err: unknown): err is Error & { status: number } {
  return err instanceof Error && typeof (err as { status?: unknown }).status === "number";
}

function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object" || !("status" in err)) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function errorCode(err: unknown): string {
  if (!err || typeof err !== "object" || !("code" in err)) return "";
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

async function resolveTemplatesRoot(root: string): Promise<string> {
  let stat;
  try {
    stat = await fs.stat(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Template not found", "not_found");
    throw err;
  }
  if (!stat.isDirectory()) throw httpFail(404, "Template not found", "not_found");
  return fs.realpath(root);
}

/**
 * Read one template file and refuse a path that realpath resolves outside
 * `root`. The id is a single safe segment, so the lexical path cannot climb.
 */
async function readTemplateFile(root: string, id: string): Promise<string> {
  const safeId = assertId(id);
  const rootReal = await resolveTemplatesRoot(root);
  const absolute = path.resolve(rootReal, `${safeId}.mmd`);
  const lexical = path.relative(rootReal, absolute);
  if (lexical.startsWith("..") || path.isAbsolute(lexical)) {
    throw httpFail(400, "Invalid template id", "invalid");
  }
  let fileReal: string;
  try {
    fileReal = await fs.realpath(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Template not found", "not_found");
    throw err;
  }
  const fromRoot = path.relative(rootReal, fileReal);
  const parts = fromRoot.split(/[/\\]/).filter((part) => part.length > 0);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot) || parts.length !== 1 || parts[0] !== `${safeId}.mmd`) {
    throw httpFail(400, "Invalid template id", "invalid");
  }
  const stat = await fs.stat(fileReal);
  if (!stat.isFile()) throw httpFail(404, "Template not found", "not_found");
  return fs.readFile(fileReal, "utf8");
}

function toRecord(id: string, source: string): TemplateRecord {
  const parsed = parseDiagram(source);
  const title = parsed.title?.trim() || id;
  return {
    id,
    title,
    description: parsed.description,
    tags: parsed.tags,
    category: parsed.category,
    theme: parsed.theme,
    diagramType: diagramTypeLabel(parsed.body),
    cacheKey: parsed.cacheKey,
    malformed: parsed.malformed,
    error: parsed.error,
    source,
  };
}

function sortTemplates(records: TemplateRecord[]): TemplateRecord[] {
  const rank = new Map(PREFERRED_ORDER.map((id, index) => [id, index]));
  return [...records].sort((a, b) => {
    const left = rank.get(a.id) ?? 1000;
    const right = rank.get(b.id) ?? 1000;
    if (left !== right) return left - right;
    const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    if (byTitle !== 0) return byTitle;
    return a.id.localeCompare(b.id);
  });
}

export async function listTemplates(root = getTemplatesRoot()): Promise<TemplateRecord[]> {
  let rootReal: string;
  try {
    rootReal = await resolveTemplatesRoot(root);
  } catch (err) {
    if (errorStatus(err) === 404) return [];
    throw err;
  }
  const names = await fs.readdir(rootReal);
  const records: TemplateRecord[] = [];
  for (const name of names) {
    if (!FILE_PATTERN.test(name)) continue;
    const id = name.slice(0, -".mmd".length);
    try {
      const source = await readTemplateFile(rootReal, id);
      records.push(toRecord(id, source));
    } catch (err) {
      if (isHttpError(err) && err.status === 400) continue;
      throw err;
    }
  }
  return sortTemplates(records);
}

export async function readTemplate(id: string, root = getTemplatesRoot()): Promise<TemplateRecord> {
  const source = await readTemplateFile(root, id);
  return toRecord(assertId(id), source);
}

function fileNameFrom(requested: string): string {
  if (/[\\/\0]/.test(requested)) {
    throw httpFail(400, "Diagram name cannot include a path", "invalid");
  }
  if (requested.startsWith(".")) {
    throw httpFail(400, "Invalid path", "invalid");
  }
  const fileName = requested.toLowerCase().endsWith(".mmd") ? requested : `${requested}.mmd`;
  const stem = fileName.slice(0, -".mmd".length).trim();
  if (!stem || stem.startsWith(".")) {
    throw httpFail(400, "Invalid path", "invalid");
  }
  if (fileName.length > 120) {
    throw httpFail(400, "Diagram name is too long", "invalid");
  }
  return fileName;
}

async function assertExistingFolder(folder: unknown): Promise<string> {
  if (folder == null || folder === "") return "";
  if (typeof folder !== "string") throw httpFail(400, "folder must be a string", "invalid");
  const normalized = normalizeRelative(folder);
  if (normalized === "" || normalized === ".") return "";
  const absolute = safeDataPath(normalized);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) throw httpFail(400, "That folder does not exist", "invalid");
  } catch (err) {
    if (isHttpError(err)) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(400, "That folder does not exist", "invalid");
    throw err;
  }
  return toRelativePath(absolute);
}

/**
 * Copy a bundled template into the data directory.
 * An existing file at the chosen name is kept. The new file uses the next
 * free suffix (`Name 2.mmd`, `Name 3.mmd`). A race that loses the check is
 * retried. `writeFile` still refuses to overwrite when no baseline is sent.
 */
export async function createDiagramFromTemplate(
  id: string,
  input: { name?: unknown; folder?: unknown },
  root = getTemplatesRoot(),
): Promise<CreatedFromTemplate> {
  if (input.name != null && typeof input.name !== "string") {
    throw httpFail(400, "name must be a string", "invalid");
  }
  const template = await readTemplate(id, root);
  const folder = await assertExistingFolder(input.folder);
  const requested = typeof input.name === "string" ? input.name.trim() : "";
  const fileName = fileNameFrom(requested || template.title || template.id);
  const desired = folder ? `${folder}/${fileName}` : fileName;
  safeDataPath(desired);

  let candidate = desired;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    candidate = await resolveAvailablePath(candidate, (item) => pathExists(safeDataPath(item)));
    try {
      const written = await writeFile(candidate, template.source);
      return {
        path: written.path,
        mtimeMs: written.mtimeMs,
        size: written.size,
        hash: written.hash,
        templateId: template.id,
      };
    } catch (err) {
      if (errorCode(err) !== "exists") throw err;
    }
  }
  throw httpFail(409, "No free path is available", "collision", { path: desired });
}
