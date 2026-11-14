import fs from "node:fs/promises";
import path from "node:path";
import { isSafeDataPath, readDataSource, replaceDataSourcePaths } from "./diagramData.js";
import { resolveSafePath } from "./paths.js";
import {
  httpFail,
  normalizeRelative,
  pathExists,
  resolveAvailablePath,
  rewriteMovedPath,
} from "./storage.js";

/**
 * A generated diagram stores its CSV, JSON, CDP, or LLDP file beside it and
 * records that path under `nerdgram.source`. Rename, move, duplicate, and
 * delete keep that file with the diagram when it actually sits in the same
 * directory. A source path in some other directory stays where it is, and
 * refresh keeps reading it.
 */

export type DataFileMove = { from: string; to: string };

export type CompanionUpdate = {
  /** Diagram path after the rename or move. */
  path: string;
  original: string;
  apply: (content: string) => string;
};

export function parentDir(filePath: string): string {
  const normalized = normalizeRelative(filePath);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

export function baseName(filePath: string): string {
  const normalized = normalizeRelative(filePath);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function diagramStem(diagramPath: string): string {
  return baseName(diagramPath).replace(/\.mmd$/i, "");
}

export function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * Where a data file should sit after its diagram moves.
 * A sibling named with the diagram stem follows the new stem
 * (`Campus.csv` and `Campus.edges.csv` become `Core.csv` and `Core.edges.csv`).
 * Any other sibling keeps its own name and only changes directory.
 * Returns null when the data file is not in the diagram's directory.
 */
export function relocatedCompanionPath(fromDiagram: string, toDiagram: string, dataPath: string): string | null {
  const from = normalizeRelative(fromDiagram);
  const to = normalizeRelative(toDiagram);
  const data = normalizeRelative(dataPath);
  if (!from || !to || !data) return null;
  if (parentDir(data) !== parentDir(from)) return null;
  const base = baseName(data);
  const oldStem = diagramStem(from);
  const newStem = diagramStem(to);
  const prefix = `${oldStem}.`;
  const renamed = oldStem && base.startsWith(prefix) ? `${newStem}${base.slice(oldStem.length)}` : base;
  if (!isSafeDataPath(joinRel(parentDir(to), renamed))) return null;
  return joinRel(parentDir(to), renamed);
}

export function recordedSourcePaths(content: string): string[] {
  const source = readDataSource(content);
  if (!source) return [];
  const paths = [source.file, source.edgesFile].filter((item): item is string => Boolean(item));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of paths) {
    const normalized = normalizeRelative(item);
    if (!normalized || seen.has(normalized) || !isSafeDataPath(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Source paths that live in the same directory as the diagram. */
export function companionPaths(diagramPath: string, content: string): string[] {
  const dir = parentDir(diagramPath);
  return recordedSourcePaths(content).filter((item) => parentDir(item) === dir);
}

export function rewriteSourcePrefix(content: string, fromDir: string, toDir: string): string {
  const source = readDataSource(content);
  if (!source) return content;
  const file = prefixPath(source.file, fromDir, toDir);
  const edgesFile = source.edgesFile ? prefixPath(source.edgesFile, fromDir, toDir) : undefined;
  if (file === source.file && edgesFile === source.edgesFile) return content;
  return replaceDataSourcePaths(content, {
    ...(file !== source.file ? { file } : {}),
    ...(edgesFile && edgesFile !== source.edgesFile ? { edgesFile } : {}),
  });
}

function prefixPath(dataPath: string, fromDir: string, toDir: string): string {
  const data = normalizeRelative(dataPath);
  const from = normalizeRelative(fromDir);
  const to = normalizeRelative(toDir);
  if (!from) return data;
  if (data === from || data.startsWith(`${from}/`)) {
    const next = `${to}${data.slice(from.length)}`;
    return isSafeDataPath(next) ? next : data;
  }
  return data;
}

async function isRegularDataFile(relativePath: string): Promise<boolean> {
  if (!isSafeDataPath(relativePath)) return false;
  try {
    const stat = await fs.lstat(resolveSafePath(relativePath));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function freeDataDest(desired: string, leaving: string): Promise<string> {
  return resolveAvailablePath(
    desired,
    async (candidate) => {
      if (candidate === leaving) return false;
      return pathExists(resolveSafePath(candidate));
    },
    { word: "copy" },
  );
}

async function moveDataFile(from: string, to: string): Promise<void> {
  if (from === to) return;
  const src = resolveSafePath(from);
  const dest = resolveSafePath(to);
  const stat = await fs.lstat(src);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw httpFail(400, "The data file is not a regular file.", "invalid");
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(src, dest);
}

async function copyDataFile(from: string, to: string): Promise<void> {
  const src = resolveSafePath(from);
  const dest = resolveSafePath(to);
  const stat = await fs.lstat(src);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw httpFail(400, "The data file is not a regular file.", "invalid");
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

export async function existingCompanions(
  files: readonly { path: string; content: string }[],
  root: string,
  isDirectory: boolean,
): Promise<string[]> {
  const inScope = files.filter((file) =>
    isDirectory ? file.path === root || file.path.startsWith(`${root}/`) : file.path === root,
  );
  const found: string[] = [];
  const seen = new Set<string>();
  for (const file of inScope) {
    for (const dataPath of companionPaths(file.path, file.content)) {
      if (seen.has(dataPath)) continue;
      if (isDirectory && dataPath !== root && !dataPath.startsWith(`${root}/`)) continue;
      if (!(await isRegularDataFile(dataPath))) continue;
      seen.add(dataPath);
      found.push(dataPath);
    }
  }
  found.sort((a, b) => a.localeCompare(b));
  return found;
}

function referencedByOther(
  files: readonly { path: string; content: string }[],
  dataPath: string,
  diagramPath: string,
): boolean {
  return files.some((file) => file.path !== diagramPath && recordedSourcePaths(file.content).includes(dataPath));
}

/**
 * Move or copy sibling data files after the diagram or folder is already at `to`.
 * A folder rename has already carried the files inside it. A shared file is copied
 * so the diagram that stayed keeps the original bytes.
 */
export async function relocateCompanions(
  files: readonly { path: string; content: string }[],
  from: string,
  to: string,
  isDirectory: boolean,
): Promise<{ dataFiles: DataFileMove[]; updates: CompanionUpdate[] }> {
  if (isDirectory) return relocateFolderSources(files, from, to);
  return relocateFileCompanions(files, from, to);
}

function relocateFolderSources(
  files: readonly { path: string; content: string }[],
  from: string,
  to: string,
): { dataFiles: DataFileMove[]; updates: CompanionUpdate[] } {
  const dataFiles: DataFileMove[] = [];
  const seen = new Set<string>();
  const updates: CompanionUpdate[] = [];
  const apply = (content: string) => rewriteSourcePrefix(content, from, to);
  for (const file of files) {
    const next = apply(file.content);
    if (next !== file.content) {
      updates.push({
        path: rewriteMovedPath(file.path, from, to, true),
        original: file.content,
        apply,
      });
    }
    const inside = file.path === from || file.path.startsWith(`${from}/`);
    if (!inside) continue;
    for (const dataPath of companionPaths(file.path, file.content)) {
      if (seen.has(dataPath)) continue;
      if (dataPath !== from && !dataPath.startsWith(`${from}/`)) continue;
      seen.add(dataPath);
      const nextPath = rewriteMovedPath(dataPath, from, to, true);
      if (nextPath !== dataPath) dataFiles.push({ from: dataPath, to: nextPath });
    }
  }
  dataFiles.sort((a, b) => a.from.localeCompare(b.from));
  return { dataFiles, updates };
}

async function relocateFileCompanions(
  files: readonly { path: string; content: string }[],
  from: string,
  to: string,
): Promise<{ dataFiles: DataFileMove[]; updates: CompanionUpdate[] }> {
  const diagram = files.find((file) => file.path === from);
  if (!diagram) return { dataFiles: [], updates: [] };
  const mapping = new Map<string, string>();
  const dataFiles: DataFileMove[] = [];
  for (const dataPath of companionPaths(from, diagram.content)) {
    if (!(await isRegularDataFile(dataPath))) continue;
    const desired = relocatedCompanionPath(from, to, dataPath);
    if (!desired || desired === dataPath) continue;
    const dest = await freeDataDest(desired, dataPath);
    const shared = referencedByOther(files, dataPath, from);
    if (shared) await copyDataFile(dataPath, dest);
    else await moveDataFile(dataPath, dest);
    mapping.set(dataPath, dest);
    dataFiles.push({ from: dataPath, to: dest });
  }
  if (mapping.size === 0) return { dataFiles, updates: [] };
  const apply = (content: string) => applyDataMapping(content, mapping);
  return {
    dataFiles,
    updates: [{ path: to, original: diagram.content, apply }],
  };
}

function applyDataMapping(content: string, mapping: ReadonlyMap<string, string>): string {
  const source = readDataSource(content);
  if (!source) return content;
  const file = mapping.get(normalizeRelative(source.file));
  const edgesFile = source.edgesFile ? mapping.get(normalizeRelative(source.edgesFile)) : undefined;
  return replaceDataSourcePaths(content, {
    ...(file ? { file } : {}),
    ...(edgesFile ? { edgesFile } : {}),
  });
}

/**
 * Copy sibling data files so they sit beside `toDiagram`, and return the
 * diagram text with `nerdgram.source` pointed at the copies.
 * The original files are not modified.
 */
export async function copyCompanionsBeside(
  fromDiagram: string,
  toDiagram: string,
  content: string,
  companions: readonly string[],
): Promise<{ content: string; dataFiles: DataFileMove[] }> {
  const mapping = new Map<string, string>();
  const dataFiles: DataFileMove[] = [];
  for (const dataPath of companions) {
    const desired = relocatedCompanionPath(fromDiagram, toDiagram, dataPath);
    if (!desired) continue;
    const dest = await freeDataDest(desired, "");
    await copyDataFile(dataPath, dest);
    mapping.set(dataPath, dest);
    dataFiles.push({ from: dataPath, to: dest });
  }
  return { content: applyDataMapping(content, mapping), dataFiles };
}

/**
 * Copy data files that live inside a duplicated folder and rewrite source
 * paths in `content` from the original folder prefix to the copy.
 */
export async function copyFolderCompanions(
  fromDir: string,
  toDir: string,
  companions: readonly string[],
): Promise<DataFileMove[]> {
  const dataFiles: DataFileMove[] = [];
  for (const dataPath of companions) {
    const dest = prefixPath(dataPath, fromDir, toDir);
    if (!isSafeDataPath(dest) || dest === dataPath) continue;
    const actual = await freeDataDest(dest, "");
    await copyDataFile(dataPath, actual);
    dataFiles.push({ from: dataPath, to: actual });
  }
  return dataFiles;
}

/**
 * Hold data files outside `folder` so a folder trash can leave them in place,
 * then put them back at their original paths.
 */
export async function parkDataFiles(folder: string, companions: readonly string[]): Promise<{ from: string; park: string }[]> {
  const parent = parentDir(folder);
  const parked: { from: string; park: string }[] = [];
  for (const dataPath of companions) {
    const desired = joinRel(parent, `${baseName(dataPath)}.kept`);
    const park = await freeDataDest(desired, dataPath);
    await moveDataFile(dataPath, park);
    parked.push({ from: dataPath, park });
  }
  return parked;
}

export async function unparkDataFiles(parked: readonly { from: string; park: string }[]): Promise<void> {
  for (const item of parked) {
    await moveDataFile(item.park, item.from);
  }
}

/** Data-file reference repairs after a diagram was renamed outside the app. */
export async function externalDataRepairs(
  files: readonly { path: string; content: string }[],
  moves: readonly { from: string; to: string }[],
): Promise<{ diagram: string; from: string; to: string }[]> {
  const repairs: { diagram: string; from: string; to: string }[] = [];
  for (const move of moves) {
    const diagram = files.find((file) => file.path === move.to);
    if (!diagram) continue;
    for (const dataPath of recordedSourcePaths(diagram.content)) {
      if (parentDir(dataPath) !== parentDir(move.from)) continue;
      const next = relocatedCompanionPath(move.from, move.to, dataPath);
      if (!next || next === dataPath) continue;
      const oldGone = !(await isRegularDataFile(dataPath));
      const arrived = await isRegularDataFile(next);
      if (oldGone && arrived) repairs.push({ diagram: move.to, from: dataPath, to: next });
    }
  }
  return repairs;
}

export function applyExternalDataRepairs(
  content: string,
  repairs: readonly { from: string; to: string }[],
): string {
  if (repairs.length === 0) return content;
  const mapping = new Map(repairs.map((item) => [item.from, item.to]));
  return applyDataMapping(content, mapping);
}
