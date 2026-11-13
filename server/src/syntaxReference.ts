import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import TurndownService from "turndown";
import { getMetaPath, REPO_ROOT } from "./paths.js";

export type ReferencePageMeta = {
  id: string;
  title: string;
  sourceUrl: string;
  filename: string;
};

export type ReferenceManifest = {
  lastSyncedAt: string | null;
  attribution: string;
  license: string;
  sources: string[];
  pages: ReferencePageMeta[];
};

export type ReferencePagePayload = {
  id: string;
  title: string;
  sourceUrl: string;
  content: string;
  override: string;
};

const ATTRIBUTION =
  "Content mirrored from the Mermaid documentation (MIT License). Source: https://mermaid.js.org/";

const BASE = "https://mermaid.js.org";

/**
 * Retired docs URLs that still appear in older Mermaid pages. A sync copies
 * them through as absolute links, so rewrite them on the way in and on read.
 * The hash, when present, is left in place.
 */
const RETIRED_DOC_LINKS: ReadonlyArray<readonly [string, string]> = [
  [`${BASE}/getting-started.html`, `${BASE}/intro/getting-started.html`],
  [`${BASE}/flowchart.html`, `${BASE}/syntax/flowchart.html`],
  [`${BASE}/sequenceDiagram.html`, `${BASE}/syntax/sequenceDiagram.html`],
  [`${BASE}/stateDiagram.html`, `${BASE}/syntax/stateDiagram.html`],
  [`${BASE}/pie.html`, `${BASE}/syntax/pie.html`],
  [`${BASE}/sankey.html`, `${BASE}/syntax/sankey.html`],
];

export function rewriteReferenceLinks(markdown: string): string {
  let next = markdown;
  for (const [from, to] of RETIRED_DOC_LINKS) {
    next = next.split(from).join(to);
  }
  return next;
}

/** Allowlisted docs pages: intro syntax reference + all syntax diagram pages. */
export const REFERENCE_SOURCES: { id: string; sourceUrl: string; title: string }[] = [
  {
    id: "syntax-reference",
    sourceUrl: `${BASE}/intro/syntax-reference.html`,
    title: "Diagram Syntax Reference",
  },
  { id: "flowchart", sourceUrl: `${BASE}/syntax/flowchart.html`, title: "Flowchart" },
  {
    id: "sequenceDiagram",
    sourceUrl: `${BASE}/syntax/sequenceDiagram.html`,
    title: "Sequence Diagram",
  },
  { id: "classDiagram", sourceUrl: `${BASE}/syntax/classDiagram.html`, title: "Class Diagram" },
  { id: "stateDiagram", sourceUrl: `${BASE}/syntax/stateDiagram.html`, title: "State Diagram" },
  {
    id: "entityRelationshipDiagram",
    sourceUrl: `${BASE}/syntax/entityRelationshipDiagram.html`,
    title: "Entity Relationship Diagram",
  },
  { id: "userJourney", sourceUrl: `${BASE}/syntax/userJourney.html`, title: "User Journey" },
  { id: "gantt", sourceUrl: `${BASE}/syntax/gantt.html`, title: "Gantt" },
  { id: "pie", sourceUrl: `${BASE}/syntax/pie.html`, title: "Pie Chart" },
  { id: "quadrantChart", sourceUrl: `${BASE}/syntax/quadrantChart.html`, title: "Quadrant Chart" },
  { id: "requirementDiagram", sourceUrl: `${BASE}/syntax/requirementDiagram.html`, title: "Requirement Diagram" },
  { id: "gitgraph", sourceUrl: `${BASE}/syntax/gitgraph.html`, title: "Git Graph" },
  { id: "c4", sourceUrl: `${BASE}/syntax/c4.html`, title: "C4 Diagram" },
  { id: "mindmap", sourceUrl: `${BASE}/syntax/mindmap.html`, title: "Mindmap" },
  { id: "timeline", sourceUrl: `${BASE}/syntax/timeline.html`, title: "Timeline" },
  { id: "zenuml", sourceUrl: `${BASE}/syntax/zenuml.html`, title: "ZenUML" },
  { id: "sankey", sourceUrl: `${BASE}/syntax/sankey.html`, title: "Sankey" },
  { id: "xyChart", sourceUrl: `${BASE}/syntax/xyChart.html`, title: "XY Chart" },
  { id: "block", sourceUrl: `${BASE}/syntax/block.html`, title: "Block Diagram" },
  { id: "packet", sourceUrl: `${BASE}/syntax/packet.html`, title: "Packet" },
  { id: "kanban", sourceUrl: `${BASE}/syntax/kanban.html`, title: "Kanban" },
  { id: "architecture", sourceUrl: `${BASE}/syntax/architecture.html`, title: "Architecture" },
  { id: "radar", sourceUrl: `${BASE}/syntax/radar.html`, title: "Radar" },
  { id: "treemap", sourceUrl: `${BASE}/syntax/treemap.html`, title: "Treemap" },
  { id: "treeView", sourceUrl: `${BASE}/syntax/treeView.html`, title: "Tree View" },
  { id: "ishikawa", sourceUrl: `${BASE}/syntax/ishikawa.html`, title: "Ishikawa" },
  { id: "venn", sourceUrl: `${BASE}/syntax/venn.html`, title: "Venn" },
  { id: "wardley", sourceUrl: `${BASE}/syntax/wardley.html`, title: "Wardley" },
  { id: "railroad", sourceUrl: `${BASE}/syntax/railroad.html`, title: "Railroad" },
  { id: "swimlanes", sourceUrl: `${BASE}/syntax/swimlanes.html`, title: "Swimlanes" },
  { id: "usecase", sourceUrl: `${BASE}/syntax/usecase.html`, title: "Use Case" },
  { id: "cynefin", sourceUrl: `${BASE}/syntax/cynefin.html`, title: "Cynefin" },
  { id: "eventmodeling", sourceUrl: `${BASE}/syntax/eventmodeling.html`, title: "Event Modeling" },
  { id: "agentflow", sourceUrl: `${BASE}/syntax/agentflow.html`, title: "Agent Flow" },
  { id: "all-examples", sourceUrl: `${BASE}/syntax/all-examples.html`, title: "All Examples" },
];

const OVERRIDES_FILE = "syntax-overrides.json";

/** Bundled mirror checked into the repo and copied read-only into the image. */
export function bundledReferenceRoot(): string {
  return path.join(REPO_ROOT, "reference");
}

/** Repo-root reference tree. Reads go through `resolveLiveReferenceRoot`. */
export function getReferenceRoot(): string {
  return bundledReferenceRoot();
}

/**
 * Writable sync target. Set only when `NERDGRAM_DATA_DIR` is set, so a
 * non-root container can update the docs and the result stays on the volume.
 * Unset keeps sync on the repo-root `reference/` tree.
 */
export function dataReferenceRoot(): string | null {
  if (!process.env.NERDGRAM_DATA_DIR?.trim()) return null;
  return path.join(getMetaPath(), "reference");
}

export type ReferenceLayout = {
  live: string;
  staging: string;
  backup: string;
  inDataDir: boolean;
};

/** Staging and backup sit next to the live tree so the rename stays on one filesystem. */
export function referenceWriteLayout(): ReferenceLayout {
  const data = dataReferenceRoot();
  if (data) {
    const parent = path.dirname(data);
    return {
      live: data,
      staging: path.join(parent, "reference.staging"),
      backup: path.join(parent, "reference.bak"),
      inDataDir: true,
    };
  }
  return {
    live: bundledReferenceRoot(),
    staging: path.join(REPO_ROOT, "reference.staging"),
    backup: path.join(REPO_ROOT, "reference.bak"),
    inDataDir: false,
  };
}

function getPagesDir(root: string): string {
  return path.join(root, "pages");
}

function getManifestPath(root: string): string {
  return path.join(root, "manifest.json");
}

async function manifestLooksValid(root: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(getManifestPath(root), "utf8");
    const parsed = JSON.parse(raw) as { pages?: unknown };
    return Array.isArray(parsed.pages) && parsed.pages.length > 0;
  } catch {
    return false;
  }
}

/**
 * Prefer a synced copy under the data directory when it has a manifest.
 * Otherwise serve the bundled tree at `REPO_ROOT/reference`.
 */
export async function resolveLiveReferenceRoot(): Promise<string> {
  const data = dataReferenceRoot();
  if (data && (await manifestLooksValid(data))) return data;
  return bundledReferenceRoot();
}

function pageFile(root: string, filename: string): string {
  const base = path.basename(filename);
  if (!base || base !== filename || !base.endsWith(".md") || base.includes("\0")) {
    throw Object.assign(new Error("Invalid reference page"), { status: 400 });
  }
  const pages = getPagesDir(root);
  const absolute = path.resolve(pages, base);
  const relative = path.relative(pages, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Object.assign(new Error("Invalid reference page"), { status: 400 });
  }
  return absolute;
}

function getOverridesPath(): string {
  return path.join(getMetaPath(), OVERRIDES_FILE);
}

function emptyManifest(): ReferenceManifest {
  return {
    lastSyncedAt: null,
    attribution: ATTRIBUTION,
    license: "MIT",
    sources: REFERENCE_SOURCES.map((s) => s.sourceUrl),
    pages: [],
  };
}

export async function ensureReferenceDirs(): Promise<void> {
  await fs.mkdir(getPagesDir(await resolveLiveReferenceRoot()), { recursive: true });
}

async function readManifestFrom(root: string): Promise<ReferenceManifest> {
  try {
    const raw = await fs.readFile(getManifestPath(root), "utf8");
    const parsed = JSON.parse(raw) as ReferenceManifest;
    return {
      ...emptyManifest(),
      ...parsed,
      pages: Array.isArray(parsed.pages) ? parsed.pages : [],
    };
  } catch {
    return emptyManifest();
  }
}

export async function readManifest(): Promise<ReferenceManifest> {
  return readManifestFrom(await resolveLiveReferenceRoot());
}

async function readOverrides(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(getOverridesPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeOverrides(map: Record<string, string>): Promise<void> {
  await fs.mkdir(getMetaPath(), { recursive: true });
  await fs.writeFile(getOverridesPath(), JSON.stringify(map, null, 2), "utf8");
}

export async function listReference(): Promise<{
  manifest: ReferenceManifest;
  pages: ReferencePageMeta[];
}> {
  const manifest = await readManifest();
  return { manifest, pages: manifest.pages };
}

function assertSafePageId(id: string): string {
  const cleaned = id.trim();
  if (!cleaned || cleaned.includes("..") || cleaned.includes("/") || cleaned.includes("\\")) {
    throw Object.assign(new Error("Invalid page id"), { status: 400 });
  }
  return cleaned;
}

export async function getReferencePage(id: string): Promise<ReferencePagePayload> {
  const pageId = assertSafePageId(id);
  const root = await resolveLiveReferenceRoot();
  const manifest = await readManifestFrom(root);
  const meta = manifest.pages.find((p) => p.id === pageId);
  if (!meta) {
    throw Object.assign(new Error("Reference page not found"), { status: 404 });
  }
  const filename = meta.filename || `${pageId}.md`;
  const content = rewriteReferenceLinks(await fs.readFile(pageFile(root, filename), "utf8"));
  const overrides = await readOverrides();
  return {
    id: meta.id,
    title: meta.title,
    sourceUrl: meta.sourceUrl,
    content,
    override: overrides[pageId] || "",
  };
}

export async function setOverride(id: string, text: string): Promise<{ override: string }> {
  const pageId = assertSafePageId(id);
  const manifest = await readManifest();
  if (!manifest.pages.some((p) => p.id === pageId)) {
    throw Object.assign(new Error("Reference page not found"), { status: 404 });
  }
  const overrides = await readOverrides();
  const trimmed = text.trim();
  if (!trimmed) {
    delete overrides[pageId];
  } else {
    overrides[pageId] = text;
  }
  await writeOverrides(overrides);
  return { override: overrides[pageId] || "" };
}

function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.addRule("preCode", {
    filter: (node) =>
      node.nodeName === "PRE" &&
      Boolean(node.firstChild && (node.firstChild as Element).nodeName === "CODE"),
    replacement: (_content, node) => {
      const code = (node as HTMLElement).querySelector("code");
      const text = code?.textContent || node.textContent || "";
      const className = code?.getAttribute("class") || "";
      const langMatch = className.match(/language-([a-z0-9+-]+)/i);
      const lang = langMatch?.[1] || "";
      return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, "")}\n\`\`\`\n\n`;
    },
  });
  return turndown;
}

function extractMainHtml(html: string): { title: string; html: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, .VPNav, .VPSidebar, .VPLocalNav").remove();

  let main =
    $("main .vp-doc").first().html() ||
    $("main").first().html() ||
    $("article").first().html() ||
    $(".content").first().html() ||
    $("body").html() ||
    "";

  const h1 = $("h1").first().text().trim();
  const titleTag = $("title").first().text().trim();
  const title = h1 || titleTag.replace(/\s*\|\s*Mermaid.*$/i, "").trim() || "Untitled";

  // Absolute-ize relative links that point at mermaid docs
  const $main = cheerio.load(`<div id="root">${main}</div>`);
  $main("a[href]").each((_, el) => {
    const href = $main(el).attr("href");
    if (!href) return;
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) return;
    try {
      const abs = new URL(href, BASE).toString();
      $main(el).attr("href", abs);
    } catch {
      /* keep as-is */
    }
  });
  main = $main("#root").html() || main;

  return { title, html: main };
}

async function fetchPage(sourceUrl: string): Promise<string> {
  const res = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "NerdGram1337-syntax-sync/1.0 (+https://github.com/NetworkNerd1337/NerdGram1337)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${sourceUrl} (${res.status})`);
  }
  return res.text();
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmrf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

/**
 * Sync from mermaid.js.org into a staging directory, then atomically replace
 * the live reference. On any failure, the existing reference is left untouched.
 */
export async function syncReference(): Promise<ReferenceManifest> {
  const layout = referenceWriteLayout();
  const liveRoot = layout.live;
  const stagingRoot = layout.staging;
  const backupRoot = layout.backup;

  await rmrf(stagingRoot);
  await fs.mkdir(path.join(stagingRoot, "pages"), { recursive: true });

  const turndown = createTurndown();
  const pages: ReferencePageMeta[] = [];
  const errors: string[] = [];

  for (const source of REFERENCE_SOURCES) {
    try {
      const html = await fetchPage(source.sourceUrl);
      const extracted = extractMainHtml(html);
      const markdownBody = turndown.turndown(extracted.html).trim();
      const title = source.title || extracted.title;
      const filename = `${source.id}.md`;
      const header = rewriteReferenceLinks(
        [
          `<!-- Source: ${source.sourceUrl} -->`,
          `<!-- License: MIT (Mermaid documentation) -->`,
          "",
          `# ${title}`,
          "",
          `> Offline mirror for NerdGram1337. Upstream: [${source.sourceUrl}](${source.sourceUrl})`,
          "",
          markdownBody,
          "",
        ].join("\n"),
      );

      await fs.writeFile(path.join(stagingRoot, "pages", filename), header, "utf8");
      pages.push({
        id: source.id,
        title,
        sourceUrl: source.sourceUrl,
        filename,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Skip optional pages that 404 (e.g. canvas may not exist); fail hard if core pages fail
      if (source.id === "syntax-reference" || source.id === "flowchart") {
        errors.push(`${source.id}: ${message}`);
      } else if (message.includes("(404)")) {
        continue;
      } else {
        errors.push(`${source.id}: ${message}`);
      }
    }
  }

  if (pages.length === 0 || errors.some((e) => e.startsWith("syntax-reference:") || e.startsWith("flowchart:"))) {
    await rmrf(stagingRoot);
    throw Object.assign(
      new Error(
        errors.length
          ? `Sync failed; existing library left unchanged. ${errors.join("; ")}`
          : "Sync failed; no pages downloaded. Existing library left unchanged.",
      ),
      { status: 502 },
    );
  }

  if (errors.length > 0 && pages.length < 5) {
    await rmrf(stagingRoot);
    throw Object.assign(
      new Error(`Sync failed with too many errors; existing library left unchanged. ${errors.join("; ")}`),
      { status: 502 },
    );
  }

  const manifest: ReferenceManifest = {
    lastSyncedAt: new Date().toISOString(),
    attribution: ATTRIBUTION,
    license: "MIT",
    sources: pages.map((p) => p.sourceUrl),
    pages,
  };

  await fs.writeFile(
    path.join(stagingRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  // Atomic-ish swap: move live -> bak, staging -> live, then remove bak.
  // If rename of staging into live fails, restore bak.
  await rmrf(backupRoot);
  const hadLive = await pathExists(liveRoot);
  try {
    if (hadLive) {
      await fs.rename(liveRoot, backupRoot);
    }
    await fs.rename(stagingRoot, liveRoot);
    await rmrf(backupRoot);
  } catch (err) {
    // Attempt restore
    if (hadLive && (await pathExists(backupRoot)) && !(await pathExists(liveRoot))) {
      try {
        await fs.rename(backupRoot, liveRoot);
      } catch {
        /* ignore restore failure */
      }
    }
    await rmrf(stagingRoot);
    throw Object.assign(
      new Error(
        `Sync failed during replace; existing library left unchanged. ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
      { status: 500 },
    );
  }

  return manifest;
}
