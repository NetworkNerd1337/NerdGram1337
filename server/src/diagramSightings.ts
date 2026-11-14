import path from "node:path";
import { getMetaPath } from "./paths.js";
import { atomicWriteJson, normalizeRelative, readJsonFile, rewriteMovedPath } from "./storage.js";

/**
 * Memory of diagram paths and content hashes.
 *
 * A rename inside the app updates click targets itself. A rename from the
 * file manager, `git mv`, or a GitHub sync pull does not. This file is how
 * the next look can tell a missing path from a file that showed up in the
 * same gap. It lives under `.meta/` and is not a diagram.
 *
 * The first time the workspace is seen, the current files are recorded and
 * nothing is suggested. A later look pairs a path that disappeared in that
 * gap with a path that appeared in that same gap. The same content hash
 * wins. The file name is used only when the hash does not match. Two
 * equally good files stay unresolved so nothing is chosen for the user.
 */

export type DiagramSnapshot = {
  path: string;
  hash: string;
};

export type LinkRepairMatch = "content" | "basename" | "ambiguous";

export type PendingRename = {
  from: string;
  to: string | null;
  match: LinkRepairMatch;
  candidates: string[];
  noticedAt: number;
};

type Sighting = {
  path: string;
  hash: string;
  seenAt: number;
  missingAt?: number;
};

type Catalog = {
  version: 1;
  updatedAt: number;
  files: Sighting[];
  pending: PendingRename[];
};

const FILE_NAME = "diagram-sightings.json";

let chain: Promise<unknown> = Promise.resolve();
let depth = 0;
let suppress = 0;

function sightingsPath(): string {
  return path.join(getMetaPath(), FILE_NAME);
}

function emptyCatalog(): Catalog {
  return { version: 1, updatedAt: 0, files: [], pending: [] };
}

function basename(filePath: string): string {
  const normalized = normalizeRelative(filePath);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function isPending(value: unknown): value is PendingRename {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PendingRename>;
  return (
    typeof item.from === "string" &&
    (item.to === null || typeof item.to === "string") &&
    (item.match === "content" || item.match === "basename" || item.match === "ambiguous") &&
    Array.isArray(item.candidates) &&
    item.candidates.every((candidate) => typeof candidate === "string") &&
    typeof item.noticedAt === "number"
  );
}

function isSighting(value: unknown): value is Sighting {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Sighting>;
  return (
    typeof item.path === "string" &&
    typeof item.hash === "string" &&
    typeof item.seenAt === "number" &&
    (item.missingAt == null || typeof item.missingAt === "number")
  );
}

function normalizeCatalog(value: unknown): Catalog | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<Catalog>;
  if (record.version !== 1 || !Array.isArray(record.files) || !Array.isArray(record.pending)) return null;
  if (typeof record.updatedAt !== "number") return null;
  return {
    version: 1,
    updatedAt: record.updatedAt,
    files: record.files.filter(isSighting).map((file) => ({
      path: normalizeRelative(file.path),
      hash: file.hash,
      seenAt: file.seenAt,
      ...(file.missingAt != null ? { missingAt: file.missingAt } : {}),
    })),
    pending: record.pending.filter(isPending).map((item) => ({
      from: normalizeRelative(item.from),
      to: item.to ? normalizeRelative(item.to) : null,
      match: item.match,
      candidates: item.candidates.map((candidate) => normalizeRelative(candidate)).filter(Boolean),
      noticedAt: item.noticedAt,
    })),
  };
}

async function load(): Promise<Catalog> {
  try {
    return normalizeCatalog(await readJsonFile<unknown>(sightingsPath())) ?? emptyCatalog();
  } catch {
    return emptyCatalog();
  }
}

async function save(catalog: Catalog): Promise<void> {
  const files = [...catalog.files].sort((a, b) => a.path.localeCompare(b.path));
  const pending = [...catalog.pending].sort((a, b) => a.from.localeCompare(b.from));
  await atomicWriteJson(sightingsPath(), { ...catalog, files, pending });
}

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (depth > 0) return fn();
  const run = chain.then(async () => {
    depth += 1;
    try {
      return await fn();
    } finally {
      depth -= 1;
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Skip catalog updates while a sync pull rewrites the tree, then observe once. */
export async function withoutSightingNotes<T>(fn: () => Promise<T>): Promise<T> {
  suppress += 1;
  try {
    return await fn();
  } finally {
    suppress -= 1;
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const list = groups.get(name);
    if (list) list.push(item);
    else groups.set(name, [item]);
  }
  return groups;
}

/**
 * Pair paths that left the previous snapshot with paths that were not in it.
 * Content hash is decided first. A file name is used only for what the hash
 * did not claim. A hash or a name that fits more than one file is left open.
 */
export function matchExternalRenames(
  previous: readonly DiagramSnapshot[],
  current: readonly DiagramSnapshot[],
  noticedAt = Date.now(),
): PendingRename[] {
  const previousPaths = new Set(previous.map((item) => item.path));
  const currentPaths = new Set(current.map((item) => item.path));
  const disappeared = previous.filter((item) => !currentPaths.has(item.path));
  const appeared = current.filter((item) => !previousPaths.has(item.path));
  if (disappeared.length === 0 || appeared.length === 0) return [];

  const result: PendingRename[] = [];
  const usedAppeared = new Set<string>();
  const decided = new Set<string>();
  const disappearedByHash = groupBy(disappeared, (item) => item.hash);
  const appearedByHash = groupBy(appeared, (item) => item.hash);

  for (const [hash, olds] of disappearedByHash) {
    const news = appearedByHash.get(hash) ?? [];
    if (news.length === 0) continue;
    if (olds.length === 1 && news.length === 1) {
      const from = olds[0];
      const to = news[0];
      if (!from || !to) continue;
      result.push({
        from: from.path,
        to: to.path,
        match: "content",
        candidates: [to.path],
        noticedAt,
      });
      usedAppeared.add(to.path);
      decided.add(from.path);
      continue;
    }
    const candidates = news.map((item) => item.path).sort((a, b) => a.localeCompare(b));
    for (const old of olds) {
      result.push({ from: old.path, to: null, match: "ambiguous", candidates, noticedAt });
      decided.add(old.path);
    }
    for (const item of news) usedAppeared.add(item.path);
  }

  const remainingOld = disappeared.filter((item) => !decided.has(item.path));
  const remainingNew = appeared.filter((item) => !usedAppeared.has(item.path));
  const oldByName = groupBy(remainingOld, (item) => basename(item.path));
  const newByName = groupBy(remainingNew, (item) => basename(item.path));
  for (const [name, olds] of oldByName) {
    const news = newByName.get(name) ?? [];
    if (news.length === 0) continue;
    if (olds.length === 1 && news.length === 1) {
      const from = olds[0];
      const to = news[0];
      if (!from || !to) continue;
      result.push({
        from: from.path,
        to: to.path,
        match: "basename",
        candidates: [to.path],
        noticedAt,
      });
      continue;
    }
    const candidates = news.map((item) => item.path).sort((a, b) => a.localeCompare(b));
    for (const old of olds) {
      result.push({ from: old.path, to: null, match: "ambiguous", candidates, noticedAt });
    }
  }

  return result.sort((a, b) => a.from.localeCompare(b.from));
}

function seedCatalog(current: readonly DiagramSnapshot[], now: number): Catalog {
  return {
    version: 1,
    updatedAt: now,
    files: current.map((item) => ({ path: item.path, hash: item.hash, seenAt: now })),
    pending: [],
  };
}

function refreshPending(pending: readonly PendingRename[], currentPaths: ReadonlySet<string>): PendingRename[] {
  const next: PendingRename[] = [];
  for (const item of pending) {
    if (currentPaths.has(item.from)) continue;
    if (item.to) {
      if (!currentPaths.has(item.to)) continue;
      next.push(item);
      continue;
    }
    const candidates = item.candidates.filter((candidate) => currentPaths.has(candidate));
    if (candidates.length === 0) continue;
    if (candidates.length === 1 && item.candidates.length > 1) {
      const only = candidates[0];
      if (!only) continue;
      next.push({
        ...item,
        to: only,
        candidates,
        match: item.match === "ambiguous" ? "basename" : item.match,
      });
      continue;
    }
    next.push({ ...item, candidates });
  }
  return next;
}

/**
 * Compare the catalog with the diagrams on disk and remember the result.
 * The first catalog is only a baseline. Returns the renames still waiting,
 * including ones noticed on an earlier look.
 */
export async function observeDiagramSightings(current: readonly DiagramSnapshot[]): Promise<PendingRename[]> {
  return exclusive(async () => {
    const now = Date.now();
    const catalog = await load();
    const snaps = current.map((item) => ({ path: normalizeRelative(item.path), hash: item.hash })).filter((item) => item.path);
    if (catalog.updatedAt === 0 && catalog.files.length === 0 && catalog.pending.length === 0) {
      await save(seedCatalog(snaps, now));
      return [];
    }

    const currentPaths = new Set(snaps.map((item) => item.path));
    const present = catalog.files.filter((file) => file.missingAt == null);
    const fresh = matchExternalRenames(present, snaps, now);
    let pending = refreshPending(catalog.pending, currentPaths);
    const known = new Set(pending.map((item) => item.from));
    for (const item of fresh) {
      if (known.has(item.from)) continue;
      pending.push(item);
    }
    pending = refreshPending(pending, currentPaths);

    const pendingFrom = new Set(pending.map((item) => item.from));
    const files: Sighting[] = snaps.map((item) => ({ path: item.path, hash: item.hash, seenAt: now }));
    for (const old of catalog.files) {
      if (currentPaths.has(old.path) || !pendingFrom.has(old.path)) continue;
      files.push({ path: old.path, hash: old.hash, seenAt: old.seenAt, missingAt: old.missingAt ?? now });
    }

    await save({ version: 1, updatedAt: now, files, pending });
    return pending;
  });
}

export async function noteDiagramSighting(snapshot: DiagramSnapshot): Promise<void> {
  if (suppress > 0) return;
  const filePath = normalizeRelative(snapshot.path);
  if (!filePath || !snapshot.hash) return;
  await exclusive(async () => {
    if (suppress > 0) return;
    const now = Date.now();
    const catalog = await load();
    const files = catalog.files.filter((file) => file.path !== filePath && file.missingAt == null);
    files.push({ path: filePath, hash: snapshot.hash, seenAt: now });
    for (const old of catalog.files) {
      if (old.missingAt == null || old.path === filePath) continue;
      if (!catalog.pending.some((item) => item.from === old.path)) continue;
      files.push(old);
    }
    const pending = catalog.pending.filter((item) => item.from !== filePath);
    const updatedAt = catalog.updatedAt === 0 ? now : catalog.updatedAt;
    await save({ version: 1, updatedAt, files, pending });
  });
}

export async function forgetDiagramSighting(target: string, isDirectory: boolean): Promise<void> {
  if (suppress > 0) return;
  const normalized = normalizeRelative(target);
  if (!normalized) return;
  await exclusive(async () => {
    if (suppress > 0) return;
    const gone = (filePath: string) =>
      filePath === normalized || (isDirectory && filePath.startsWith(`${normalized}/`));
    const catalog = await load();
    catalog.files = catalog.files.filter((file) => !gone(file.path));
    catalog.pending = catalog.pending.filter((item) => !gone(item.from) && !(item.to && gone(item.to)));
    await save(catalog);
  });
}

export async function moveDiagramSighting(from: string, to: string, isDirectory: boolean): Promise<void> {
  if (suppress > 0) return;
  await exclusive(async () => {
    if (suppress > 0) return;
    const catalog = await load();
    const byPath = new Map<string, Sighting>();
    for (const file of catalog.files) {
      const next = rewriteMovedPath(file.path, from, to, isDirectory);
      byPath.set(next, { ...file, path: next });
    }
    const pending: PendingRename[] = [];
    for (const item of catalog.pending) {
      const nextFrom = rewriteMovedPath(item.from, from, to, isDirectory);
      if (nextFrom !== item.from) continue;
      pending.push({
        ...item,
        to: item.to ? rewriteMovedPath(item.to, from, to, isDirectory) : null,
        candidates: item.candidates.map((candidate) => rewriteMovedPath(candidate, from, to, isDirectory)),
      });
    }
    await save({ ...catalog, files: [...byPath.values()], pending });
  });
}

export async function setPendingRepairs(pending: readonly PendingRename[]): Promise<void> {
  await exclusive(async () => {
    const catalog = await load();
    const keep = new Set(pending.map((item) => item.from));
    catalog.files = catalog.files.filter((file) => file.missingAt == null || keep.has(file.path));
    catalog.pending = pending.map((item) => ({ ...item }));
    await save(catalog);
  });
}
