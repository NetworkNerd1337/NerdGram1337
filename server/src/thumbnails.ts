import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import { thumbnailCacheKey } from "./frontMatter.js";
import { getMetaPath, resolveSafePath, toRelativePath } from "./paths.js";
import {
  atomicWriteJson,
  decodeStorageKey,
  encodeStorageKey,
  httpFail,
  normalizeRelative,
  pathExists,
  readJsonFile,
  rewriteMovedPath,
} from "./storage.js";

/**
 * Dashboard thumbnail cache. The source of truth is one JSON file per diagram
 * under `.meta/thumbs/`, next to favorites, trash, history, and locks.
 * `buildTree` never walks `.meta`, so a thumbnail cannot show up as a diagram.
 * Move and trash retarget the file with the diagram. A duplicate or import
 * does not copy it. Git sync (#14) should keep ignoring `.meta`.
 *
 * The client renders the SVG. This module only stores and serves it, and only
 * when `cacheKey` still matches `thumbnailCacheKey` of the bytes on disk.
 */

export const THUMBS_DIR_NAME = "thumbs";

/** Reject thumbnails larger than this. Mermaid output for a normal diagram is far smaller. */
export const MAX_THUMBNAIL_SVG_CHARS = 1_500_000;

type StoredThumbnail = {
  cacheKey: string;
  mtimeMs: number;
  svg: string;
};

export type ThumbnailHit = {
  hit: true;
  path: string;
  cacheKey: string;
  mtimeMs: number;
  svg: string;
};

export type ThumbnailMiss = {
  hit: false;
  path: string;
  cacheKey: string;
  mtimeMs: number;
};

export type ThumbnailLookup = ThumbnailHit | ThumbnailMiss;

function thumbsRoot(): string {
  return path.join(getMetaPath(), THUMBS_DIR_NAME);
}

function thumbFile(relativePath: string): string {
  return path.join(thumbsRoot(), `${encodeStorageKey(relativePath)}.json`);
}

function requireDiagram(relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!normalized.toLowerCase().endsWith(".mmd")) {
    throw httpFail(400, "Only .mmd diagram files are supported", "invalid");
  }
  return normalized;
}

const URL_ATTRS = new Set(["href", "xlink:href", "src"]);

function decodeUrl(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, num: string) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/[\u0000-\u0020]+/g, "")
    .trim()
    .toLowerCase();
}

function isDangerousUrl(value: string): boolean {
  const decoded = decodeUrl(value);
  return (
    decoded.startsWith("javascript:") ||
    decoded.startsWith("vbscript:") ||
    decoded.startsWith("data:text/html") ||
    decoded.startsWith("data:application/xhtml")
  );
}

/**
 * Strip active content from an SVG before it is stored or drawn.
 * A clean document is returned unchanged. Event-handler attributes,
 * scriptable URLs, and script-bearing markup are removed, including
 * markup nested in `foreignObject`.
 */
export function sanitizeThumbnailSvg(svg: string): string {
  const trimmed = svg.trim();
  if (!trimmed) return svg;
  let changed = false;
  const $ = cheerio.load(trimmed, { xml: true });
  $("*").each((_, el) => {
    if (el.type !== "tag" && el.type !== "script") return;
    const name = el.name.toLowerCase();
    if (name === "script" || name === "iframe" || name === "object" || name === "embed" || name === "link" || name === "meta" || name === "base") {
      $(el).remove();
      changed = true;
      return;
    }
    const attribs = el.attribs;
    for (const [attr, raw] of Object.entries(attribs)) {
      const lower = attr.toLowerCase();
      const value = raw ?? "";
      if (lower.startsWith("on")) {
        $(el).removeAttr(attr);
        changed = true;
        continue;
      }
      if (URL_ATTRS.has(lower) || lower.endsWith(":href")) {
        if (isDangerousUrl(value)) {
          $(el).removeAttr(attr);
          changed = true;
        }
      }
      if (lower === "style" && /javascript\s*:|expression\s*\(|behavior\s*:|-moz-binding|@import/i.test(value)) {
        $(el).removeAttr(attr);
        changed = true;
      }
      if (
        (name === "set" || name === "animate" || name === "animatetransform") &&
        lower === "attributename" &&
        (value.toLowerCase().startsWith("on") || value.toLowerCase() === "href" || value.toLowerCase().endsWith(":href"))
      ) {
        $(el).remove();
        changed = true;
      }
    }
  });
  const structured = changed ? $.xml().trim() : trimmed;
  const swept = structured
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /(\s(?:href|xlink:href|src)\s*=\s*)(["'])\s*(?:javascript|vbscript):[^"']*\2/gi,
      '$1$2#$2',
    );
  if (swept === svg || swept === trimmed) return svg;
  return swept;
}

function assertSvg(svg: string): string {
  const trimmed = svg.trim();
  if (!trimmed.startsWith("<svg") && !trimmed.startsWith("<?xml")) {
    throw httpFail(400, "Thumbnail must be an SVG document", "invalid");
  }
  if (trimmed.length > MAX_THUMBNAIL_SVG_CHARS) {
    throw httpFail(413, "Thumbnail is too large to cache", "too_large");
  }
  if (/<script[\s>/]/i.test(trimmed)) {
    throw httpFail(400, "Thumbnail SVG cannot contain a script", "invalid");
  }
  const cleaned = sanitizeThumbnailSvg(svg);
  if (!cleaned.trim().startsWith("<svg") && !cleaned.trim().startsWith("<?xml")) {
    throw httpFail(400, "Thumbnail must be an SVG document", "invalid");
  }
  return cleaned;
}

async function readDiagram(relativePath: string): Promise<{
  path: string;
  content: string;
  mtimeMs: number;
}> {
  const normalized = requireDiagram(relativePath);
  const abs = resolveSafePath(normalized);
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw httpFail(400, "Not a diagram file", "invalid");
    const content = await fs.readFile(abs, "utf8");
    return { path: toRelativePath(abs), content, mtimeMs: stat.mtimeMs };
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Not found", "not_found");
    throw err;
  }
}

function isStored(value: StoredThumbnail | null): value is StoredThumbnail {
  return !!value && typeof value.cacheKey === "string" && typeof value.svg === "string" && value.svg.length > 0;
}

/**
 * Cached SVG when it still matches the file. A miss is `hit: false`, not an
 * HTTP error: the dashboard asks for every visible card, including ones that
 * have never been drawn.
 */
export async function readThumbnail(relativePath: string): Promise<ThumbnailLookup> {
  const diagram = await readDiagram(relativePath);
  const cacheKey = thumbnailCacheKey(diagram.content);
  const stored = await readJsonFile<StoredThumbnail>(thumbFile(diagram.path));
  if (!isStored(stored) || stored.cacheKey !== cacheKey) {
    return { hit: false, path: diagram.path, cacheKey, mtimeMs: diagram.mtimeMs };
  }
  return {
    hit: true,
    path: diagram.path,
    cacheKey,
    mtimeMs: diagram.mtimeMs,
    svg: sanitizeThumbnailSvg(stored.svg),
  };
}

/**
 * Store an SVG the client already rendered. The key has to match the file
 * now, so a save that landed in between cannot pin a stale picture.
 */
export async function writeThumbnail(
  relativePath: string,
  cacheKey: string,
  svg: string,
): Promise<ThumbnailHit> {
  if (!cacheKey.trim()) throw httpFail(400, "cacheKey is required", "invalid");
  const safeSvg = assertSvg(svg);
  const diagram = await readDiagram(relativePath);
  const current = thumbnailCacheKey(diagram.content);
  if (cacheKey !== current) {
    throw httpFail(409, "Thumbnail does not match the diagram on disk", "stale");
  }
  const record: StoredThumbnail = {
    cacheKey: current,
    mtimeMs: diagram.mtimeMs,
    svg: safeSvg,
  };
  await atomicWriteJson(thumbFile(diagram.path), record);
  return {
    hit: true,
    path: diagram.path,
    cacheKey: current,
    mtimeMs: diagram.mtimeMs,
    svg: safeSvg,
  };
}

export async function dropThumbnail(relativePath: string): Promise<void> {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) return;
  await fs.rm(thumbFile(normalized), { force: true });
}

type ThumbMatch = { key: string; itemPath: string; file: string };

async function matchingThumbs(relativePath: string, isDir: boolean): Promise<ThumbMatch[]> {
  const root = thumbsRoot();
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const from = normalizeRelative(relativePath);
  const matches: ThumbMatch[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const key = name.slice(0, -".json".length);
    const itemPath = decodeStorageKey(key);
    if (!itemPath) continue;
    const hit = itemPath === from || (isDir && itemPath.startsWith(`${from}/`));
    if (!hit) continue;
    matches.push({ key, itemPath, file: path.join(root, name) });
  }
  return matches;
}

/** Keep the cached SVG when a diagram or folder changes path. */
export async function relocateThumbnails(
  fromPath: string,
  toPath: string,
  isDir: boolean,
): Promise<void> {
  const matches = await matchingThumbs(fromPath, isDir);
  for (const match of matches) {
    const nextPath = rewriteMovedPath(match.itemPath, fromPath, toPath, isDir);
    const dest = thumbFile(nextPath);
    if (path.resolve(match.file) === path.resolve(dest)) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (await pathExists(dest)) await fs.rm(dest, { force: true });
    await fs.rename(match.file, dest);
  }
}

/** Move cached SVGs into a trash item so restore can put them back. */
export async function archiveThumbnails(
  fromPath: string,
  isDir: boolean,
  destDir: string,
): Promise<void> {
  const matches = await matchingThumbs(fromPath, isDir);
  if (matches.length === 0) return;
  await fs.mkdir(destDir, { recursive: true });
  for (const match of matches) {
    const target = path.join(destDir, `${match.key}.json`);
    if (await pathExists(target)) continue;
    await fs.rename(match.file, target);
  }
}

export async function unarchiveThumbnails(
  archiveDir: string,
  originalPath: string,
  restoredPath: string,
  isDir: boolean,
): Promise<void> {
  let names: string[] = [];
  try {
    names = await fs.readdir(archiveDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const key = name.slice(0, -".json".length);
    const itemPath = decodeStorageKey(key);
    if (!itemPath) continue;
    const nextPath = rewriteMovedPath(itemPath, originalPath, restoredPath, isDir);
    const dest = thumbFile(nextPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (await pathExists(dest)) await fs.rm(dest, { force: true });
    await fs.rename(path.join(archiveDir, name), dest);
  }
}
