import fs from "node:fs/promises";
import path from "node:path";
import {
  inboundLinkFiles,
  indexDiagramLinks,
  linksFor,
  planLinkRewrites,
  planRepairRewrites,
  type DiagramLinkEnds,
  type LinkRepairPlan,
  type LinkRepairSuggestion,
} from "./diagramLinks.js";
import {
  forgetDiagramSighting,
  moveDiagramSighting,
  noteDiagramSighting,
  observeDiagramSightings,
  setPendingRepairs,
  type PendingRename,
} from "./diagramSightings.js";
import { rewriteFavoritePaths } from "./favorites.js";
import { diagramMetaFrom, type DiagramMeta } from "./frontMatter.js";
import { readRevision, relocateHistory, snapshotPrevious } from "./history.js";
import { assertUnlocked, assertWriteAllowed, relocateLocks } from "./locks.js";
import {
  ensureDataRoot,
  META_DIR_NAME,
  resolveSafePath,
  toRelativePath,
} from "./paths.js";
import { moveToTrash } from "./trash.js";
import { dropThumbnail, relocateThumbnails } from "./thumbnails.js";
import {
  atomicWriteText,
  evaluateWrite,
  hashContent,
  httpFail,
  normalizeRelative,
  pathExists,
  resolveAvailablePath,
  type DiskState,
  type WriteBaseline,
} from "./storage.js";

export type { TrashItem } from "./trash.js";
export { getFavorites, setFavorites, toggleFavorite } from "./favorites.js";

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  mtimeMs: number;
  size?: number;
  children?: TreeNode[];
};

export type WriteOptions = WriteBaseline & {
  lockToken?: string | null;
};

const DIAGRAM_EXT = ".mmd";

function isDiagramFile(name: string): boolean {
  return name.toLowerCase().endsWith(DIAGRAM_EXT);
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

export async function buildTree(relativePath = ""): Promise<TreeNode[]> {
  ensureDataRoot();
  const abs = resolveSafePath(relativePath || ".");
  const entries = await readDirSafe(abs);
  const nodes: TreeNode[] = [];

  for (const name of entries) {
    if (name === META_DIR_NAME || name.startsWith(".")) continue;
    const childAbs = path.join(abs, name);
    const stat = await fs.stat(childAbs);
    const rel = toRelativePath(childAbs);

    if (stat.isDirectory()) {
      nodes.push({
        name,
        path: rel,
        type: "folder",
        mtimeMs: stat.mtimeMs,
        children: await buildTree(rel),
      });
    } else if (stat.isFile() && isDiagramFile(name)) {
      nodes.push({
        name,
        path: rel,
        type: "file",
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return nodes;
}

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  const files: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "folder") {
      if (node.children) files.push(...flattenFiles(node.children));
    } else {
      files.push(node);
    }
  }
  return files;
}

/** Parsed front matter for every diagram. `.meta` and other dot paths are not walked. */
export async function listDiagramMeta(): Promise<DiagramMeta[]> {
  const files = flattenFiles(await buildTree());
  const diagrams: DiagramMeta[] = [];
  for (const file of files) {
    const content = await readFile(file.path);
    diagrams.push(diagramMetaFrom(content.path, content.content));
  }
  return diagrams;
}

export async function listFolder(relativePath = ""): Promise<{
  path: string;
  folders: TreeNode[];
  files: TreeNode[];
}> {
  const tree = await buildTree(relativePath || ".");
  return {
    path: relativePath || "",
    folders: tree.filter((node) => node.type === "folder"),
    files: tree.filter((node) => node.type === "file"),
  };
}

async function readDisk(abs: string): Promise<DiskState> {
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw httpFail(400, "Not a diagram file", "invalid");
    const content = await fs.readFile(abs, "utf8");
    return {
      exists: true,
      content,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      hash: hashContent(content),
    };
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { exists: false };
    throw err;
  }
}

function requireDiagram(relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!isDiagramFile(normalized)) {
    throw httpFail(400, "Only .mmd diagram files are supported", "invalid");
  }
  return normalized;
}

function isInsideFolder(folderRel: string, candidateRel: string): boolean {
  const folder = normalizeRelative(folderRel);
  const candidate = normalizeRelative(candidateRel);
  return candidate === folder || candidate.startsWith(`${folder}/`);
}

async function relativePathTaken(relativePath: string): Promise<boolean> {
  return pathExists(resolveSafePath(relativePath));
}

export async function readFile(relativePath: string): Promise<{
  path: string;
  name: string;
  content: string;
  mtimeMs: number;
  size: number;
  hash: string;
}> {
  const normalized = requireDiagram(relativePath);
  const abs = resolveSafePath(normalized);
  const disk = await readDisk(abs);
  if (!disk.exists) throw httpFail(404, "Not found", "not_found");
  return {
    path: toRelativePath(abs),
    name: path.basename(abs),
    content: disk.content,
    mtimeMs: disk.mtimeMs,
    size: disk.size,
    hash: disk.hash,
  };
}

export async function writeFile(
  relativePath: string,
  content: string,
  options: WriteOptions = {},
): Promise<{
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  unchanged?: boolean;
  revisionId?: string;
}> {
  const normalized = requireDiagram(relativePath);
  const abs = resolveSafePath(normalized);
  const relative = toRelativePath(abs);
  await assertWriteAllowed(relative, options.lockToken);

  const disk = await readDisk(abs);
  const decision = evaluateWrite(disk, { ...options, content });

  if (decision.action === "reject") {
    if (decision.code === "missing") {
      throw httpFail(409, "This diagram is no longer on disk.", "missing");
    }
    if (decision.code === "exists") {
      throw httpFail(
        409,
        "A diagram already exists at that path. Choose a different name.",
        "exists",
        { path: relative },
      );
    }
    if (!disk.exists) throw httpFail(409, "This diagram changed on disk.", "conflict");
    throw httpFail(409, "This diagram changed on disk since it was last loaded.", "conflict", {
      current: {
        path: relative,
        content: disk.content,
        mtimeMs: disk.mtimeMs,
        size: disk.size,
        hash: disk.hash,
      },
    });
  }

  if (decision.action === "unchanged" && disk.exists) {
    await noteDiagramSighting({ path: relative, hash: disk.hash });
    return {
      path: relative,
      mtimeMs: disk.mtimeMs,
      size: disk.size,
      hash: disk.hash,
      unchanged: true,
    };
  }

  let revisionId: string | undefined;
  if (decision.action === "overwrite" && disk.exists) {
    revisionId = await snapshotPrevious(relative, disk);
  }

  await fs.mkdir(path.dirname(abs), { recursive: true });
  await atomicWriteText(abs, content);
  await dropThumbnail(relative);
  const stat = await fs.stat(abs);
  const search = await import("./search.js");
  await search.rememberSearchEntry(relative, content, stat.mtimeMs, stat.size);
  await noteDiagramSighting({ path: relative, hash: hashContent(content) });
  noteSync({ kind: "content", summary: `Update ${relative}` });
  return {
    path: relative,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    hash: hashContent(content),
    revisionId,
  };
}

export async function restoreRevision(
  relativePath: string,
  id: string,
  lockToken?: string | null,
): Promise<{
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  content: string;
  unchanged?: boolean;
  revisionId?: string;
}> {
  const revision = await readRevision(relativePath, id);
  const written = await writeFile(relativePath, revision.content, { force: true, lockToken });
  return { ...written, content: revision.content };
}

export async function createFolder(relativePath: string): Promise<{ path: string }> {
  const cleaned = normalizeRelative(relativePath);
  if (!cleaned) throw httpFail(400, "Folder path required", "invalid");
  const abs = resolveSafePath(cleaned);
  await fs.mkdir(abs, { recursive: true });
  const created = toRelativePath(abs);
  noteSync({ kind: "structural", summary: `Create folder ${created}` });
  return { path: created };
}

export type RenameOptions = {
  /** When other files link here, rewrite those click targets. Without this, the rename is refused. */
  updateLinks?: boolean;
};

async function readDiagramSources(): Promise<{ path: string; content: string }[]> {
  const files = flattenFiles(await buildTree());
  const sources: { path: string; content: string }[] = [];
  for (const file of files) {
    const content = await readFile(file.path);
    sources.push({ path: content.path, content: content.content });
  }
  return sources;
}

export async function diagramLinks(relativePath: string): Promise<DiagramLinkEnds & { path: string }> {
  const file = await readFile(relativePath);
  const ends = linksFor(indexDiagramLinks(await readDiagramSources()), file.path);
  return { path: file.path, ...ends };
}

export async function renameItem(
  fromPath: string,
  toPath: string,
  options: RenameOptions = {},
): Promise<{ path: string; updated: string[] }> {
  const fromAbs = resolveSafePath(fromPath);
  const toAbs = resolveSafePath(toPath);
  if (path.resolve(fromAbs) === path.resolve(toAbs)) {
    return { path: toRelativePath(fromAbs), updated: [] };
  }

  let fromStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    fromStat = await fs.stat(fromAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Not found", "not_found");
    throw err;
  }

  if (fromStat.isFile() && !isDiagramFile(toPath)) {
    throw httpFail(400, "Diagram files must use .mmd extension", "invalid");
  }

  const fromRel = toRelativePath(fromAbs);
  const toRel = toRelativePath(toAbs);
  if (fromStat.isDirectory() && isInsideFolder(fromRel, toRel)) {
    throw httpFail(
      400,
      "A folder cannot be moved into itself or one of its subfolders.",
      "descendant",
    );
  }
  if (await pathExists(toAbs)) {
    const suggestedPath = await resolveAvailablePath(toRel, relativePathTaken, { word: "copy" });
    throw httpFail(409, "Something already exists at that path.", "collision", {
      path: toRel,
      suggestedPath,
    });
  }

  const rewrites = planLinkRewrites(await readDiagramSources(), fromRel, toRel, fromStat.isDirectory());
  if (rewrites.length > 0 && !options.updateLinks) {
    throw httpFail(409, "Other diagrams link here. Confirm to update those links.", "links", {
      files: rewrites.map((item) => item.path),
    });
  }
  for (const rewrite of rewrites) {
    const inside =
      rewrite.path === fromRel || (fromStat.isDirectory() && rewrite.path.startsWith(`${fromRel}/`));
    if (!inside) await assertUnlocked(rewrite.path, false);
  }

  await assertUnlocked(fromRel, fromStat.isDirectory());
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);
  await moveDiagramSighting(fromRel, toRel, fromStat.isDirectory());
  await rewriteFavoritePaths(fromRel, toRel, fromStat.isDirectory());
  await relocateHistory(fromRel, toRel, fromStat.isDirectory());
  await relocateLocks(fromRel, toRel, fromStat.isDirectory());
  await relocateThumbnails(fromRel, toRel, fromStat.isDirectory());
  const search = await import("./search.js");
  await search.moveSearchEntries(fromRel, toRel, fromStat.isDirectory());
  noteSync({ kind: "structural", summary: `Rename ${fromRel} to ${toRel}` });
  const updated: string[] = [];
  for (const rewrite of rewrites) {
    await writeFile(rewrite.nextPath, rewrite.content, { force: true });
    updated.push(rewrite.nextPath);
  }
  return { path: toRel, updated };
}

export async function moveItem(
  fromPath: string,
  toFolder: string,
  options: RenameOptions = {},
): Promise<{ path: string; updated: string[] }> {
  const name = path.posix.basename(normalizeRelative(fromPath));
  const folder = normalizeRelative(toFolder);
  const dest = folder ? `${folder}/${name}` : name;
  return renameItem(fromPath, dest, options);
}

/**
 * Copy a diagram or folder to a new collision-safe path in the same place.
 *
 * The copy starts unfavorited and with no revision history. A later save
 * builds history for the copy only. The source lock is left where it is, and
 * the copy does not inherit it.
 */
export async function duplicateItem(
  relativePath: string,
): Promise<{ path: string; type: "file" | "folder" }> {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) throw httpFail(400, "path is required", "invalid");
  const abs = resolveSafePath(normalized);

  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Not found", "not_found");
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw httpFail(400, "Only diagrams and folders can be duplicated", "invalid");
  }

  const fromRel = toRelativePath(abs);
  const destRel = await resolveAvailablePath(fromRel, relativePathTaken, { word: "copy" });
  const destAbs = resolveSafePath(destRel);

  if (stat.isDirectory()) {
    await fs.mkdir(destAbs);
    try {
      await copyFolderContents(abs, destAbs);
    } catch (err) {
      await fs.rm(destAbs, { recursive: true, force: true });
      throw err;
    }
    const copied = toRelativePath(destAbs);
    noteSync({ kind: "structural", summary: `Duplicate ${fromRel} to ${copied}` });
    return { path: copied, type: "folder" };
  }

  if (!stat.isFile() || !isDiagramFile(fromRel)) {
    throw httpFail(400, "Only .mmd diagram files are supported", "invalid");
  }
  const content = await fs.readFile(abs, "utf8");
  const written = await writeFile(destRel, content);
  noteSync({ kind: "structural", summary: `Duplicate ${fromRel} to ${written.path}` });
  return { path: written.path, type: "file" };
}

async function copyFolderContents(srcAbs: string, destAbs: string): Promise<void> {
  const entries = await fs.readdir(srcAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const src = path.join(srcAbs, entry.name);
    const dest = path.join(destAbs, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(dest);
      await copyFolderContents(src, dest);
      continue;
    }
    if (entry.isFile() && isDiagramFile(entry.name)) {
      const content = await fs.readFile(src, "utf8");
      await writeFile(toRelativePath(dest), content);
    }
  }
}

export async function deleteItem(
  relativePath: string,
  options: { confirmLinks?: boolean } = {},
): Promise<void> {
  const abs = resolveSafePath(relativePath);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Not found", "not_found");
    throw err;
  }
  const rel = toRelativePath(abs);
  if (!options.confirmLinks) {
    const inbound = inboundLinkFiles(indexDiagramLinks(await readDiagramSources()), rel, stat.isDirectory());
    if (inbound.length > 0) {
      throw httpFail(
        409,
        "Other diagrams link here. They will show a broken link after this is moved to the trash.",
        "linked",
        { files: inbound },
      );
    }
  }
  await moveToTrash(relativePath);
  await forgetDiagramSighting(rel, stat.isDirectory());
  noteSync({ kind: "structural", summary: `Delete ${normalizeRelative(relativePath)}` });
}

async function readDiagramSourcesWithHash(): Promise<{ path: string; content: string; hash: string }[]> {
  const files = flattenFiles(await buildTree());
  const sources: { path: string; content: string; hash: string }[] = [];
  for (const file of files) {
    const content = await readFile(file.path);
    sources.push({ path: content.path, content: content.content, hash: content.hash });
  }
  return sources;
}

/** Remember the diagrams on disk. A sync pull calls this before and after it applies the remote tree. */
export async function captureDiagramSightings(): Promise<void> {
  const files = await readDiagramSourcesWithHash();
  await observeDiagramSightings(files.map((file) => ({ path: file.path, hash: file.hash })));
}

export type RepairOptions = {
  /** Defaults to true. A preview writes nothing. */
  dryRun?: boolean;
  /** Writes only when this is true and dryRun is false. */
  confirm?: boolean;
  lockToken?: string | null;
  /**
   * Pairs the user confirmed. Omit to apply every unambiguous suggestion.
   * A pair that is not in the current preview is rejected.
   */
  choices?: { from: string; to: string }[] | null;
};

export function repairOptionsFromBody(body: Record<string, unknown>): RepairOptions {
  if (body.dryRun != null && typeof body.dryRun !== "boolean") {
    throw httpFail(400, "dryRun must be a boolean", "invalid");
  }
  if (body.confirm != null && typeof body.confirm !== "boolean") {
    throw httpFail(400, "confirm must be a boolean", "invalid");
  }
  if (body.lockToken != null && typeof body.lockToken !== "string") {
    throw httpFail(400, "lockToken must be a string", "invalid");
  }
  let choices: RepairOptions["choices"] = null;
  if (body.choices != null) {
    if (!Array.isArray(body.choices)) throw httpFail(400, "choices must be a list", "invalid");
    if (body.choices.length > 500) throw httpFail(400, "choices is too long", "invalid");
    choices = body.choices.map((item) => {
      if (!item || typeof item !== "object") throw httpFail(400, "choices must be a list of from and to", "invalid");
      const record = item as { from?: unknown; to?: unknown };
      if (typeof record.from !== "string" || typeof record.to !== "string" || !record.from.trim() || !record.to.trim()) {
        throw httpFail(400, "choices must be a list of from and to", "invalid");
      }
      if (record.from.length > 500 || record.to.length > 500) {
        throw httpFail(400, "choice path is too long", "invalid");
      }
      return { from: record.from, to: record.to };
    });
  }
  return {
    dryRun: body.dryRun !== false,
    confirm: body.confirm === true,
    lockToken: typeof body.lockToken === "string" ? body.lockToken : null,
    choices,
  };
}

function brokenDiagramTargets(files: readonly { path: string; content: string }[]): Set<string> {
  const broken = new Set<string>();
  for (const link of indexDiagramLinks(files)) {
    if (link.broken && link.resolved) broken.add(link.resolved);
  }
  return broken;
}

function toSuggestions(pending: readonly PendingRename[]): LinkRepairSuggestion[] {
  return pending
    .map((item) => ({
      from: item.from,
      to: item.to,
      match: item.match,
      candidates: [...item.candidates],
    }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

function selectRepairs(
  choices: { from: string; to: string }[] | null | undefined,
  applicable: readonly { from: string; to: string }[],
): { from: string; to: string }[] {
  const allowed = new Map(applicable.map((item) => [item.from, item.to]));
  if (choices == null) return applicable.map((item) => ({ from: item.from, to: item.to }));
  for (const choice of choices) {
    const from = normalizeRelative(choice.from);
    const to = normalizeRelative(choice.to);
    if (allowed.get(from) !== to) {
      throw httpFail(409, "Preview the repair again. That match is no longer available.", "stale");
    }
  }
  return choices.map((choice) => ({
    from: normalizeRelative(choice.from),
    to: normalizeRelative(choice.to),
  }));
}

/**
 * Preview or apply click repairs for a rename that happened outside the app.
 * Nothing is written unless `confirm` is true and `dryRun` is false. Ambiguous
 * matches are returned and never chosen. Applied edits go through `writeFile`,
 * so they keep revision history.
 */
export async function repairDiagramLinks(options: RepairOptions = {}): Promise<LinkRepairPlan> {
  const dryRun = options.dryRun !== false;
  const confirm = options.confirm === true;
  const files = await readDiagramSourcesWithHash();
  let pending = await observeDiagramSightings(files.map((file) => ({ path: file.path, hash: file.hash })));
  const broken = brokenDiagramTargets(files);
  pending = pending.filter((item) => broken.has(item.from));
  await setPendingRepairs(pending);

  const suggestions = toSuggestions(pending);
  const applicable = suggestions.filter(
    (item): item is LinkRepairSuggestion & { to: string } => item.to != null && item.match !== "ambiguous",
  );
  const preview = planRepairRewrites(
    files,
    applicable.map((item) => ({ from: item.from, to: item.to })),
  );
  const previewChanges = preview.map((item) => ({ path: item.path, links: item.links }));
  if (dryRun || !confirm) {
    return { suggestions, changes: previewChanges, applied: false, saved: [] };
  }

  const selected = selectRepairs(options.choices, applicable);
  const rewrites = planRepairRewrites(files, selected);
  const saved: string[] = [];
  for (const rewrite of rewrites) {
    const disk = files.find((file) => file.path === rewrite.path);
    if (!disk || disk.content === rewrite.content) continue;
    await writeFile(rewrite.path, rewrite.content, {
      expectedHash: disk.hash,
      lockToken: options.lockToken ?? null,
    });
    saved.push(rewrite.path);
  }
  const appliedFrom = new Set(selected.map((item) => item.from));
  await setPendingRepairs(pending.filter((item) => !appliedFrom.has(item.from)));
  return {
    suggestions: suggestions.filter((item) => !appliedFrom.has(item.from)),
    changes: rewrites.map((item) => ({ path: item.path, links: item.links })),
    applied: true,
    saved,
  };
}

function noteSync(change: { kind: "content" | "structural"; summary: string }): void {
  void import("./sync/hooks.js")
    .then((mod) => mod.noteLocalChange(change))
    .catch(() => {
      console.error("GitHub sync could not record a local change");
    });
}
