import { createRequire } from "node:module";
import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer";
import { diagramInitConfig } from "./frontMatter.js";
import { httpFail } from "./storage.js";
import { sanitizeThumbnailSvg } from "./thumbnails.js";

/**
 * Server-side Mermaid rendering.
 *
 * A DOM emulator (happy-dom) can parse Mermaid, but text measurement comes
 * back as a guess and the layout collapses. Puppeteer's chrome-headless-shell
 * is the same engine family as the editor, so SVG and PNG match what the
 * preview draws. The shell is smaller than full Chrome; the image still grows
 * by that browser plus the libraries it links. See the README.
 *
 * `securityLevel` is forced to `strict` and the SVG is passed through the
 * same sanitizer as cached thumbnails. A diagram directive cannot turn that off.
 */

const require = createRequire(import.meta.url);

export const MAX_RENDER_SOURCE_CHARS = 512 * 1024;
export const MAX_RENDER_SVG_CHARS = 2_000_000;

export type RenderFormat = "svg" | "png";

export type RenderInput = {
  source: string;
  format: RenderFormat;
  /** CSS hex color. Anything else is rejected. */
  background?: string;
};

export type RenderOutput = {
  format: RenderFormat;
  contentType: string;
  body: Buffer;
};

const DARK_BACKGROUND = "#1b1e27";
const LIGHT_BACKGROUND = "#ffffff";

let browserPromise: Promise<Browser> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function mermaidScript(): string {
  return require.resolve("mermaid/dist/mermaid.min.js");
}

function wantsNoSandbox(): boolean {
  return process.env.NERDGRAM_INSTALL === "docker" || process.env.NERDGRAM_CHROME_NO_SANDBOX === "1";
}

async function launchBrowser(): Promise<Browser> {
  const args = ["--disable-dev-shm-usage", "--no-first-run", "--disable-gpu"];
  if (wantsNoSandbox()) args.push("--no-sandbox", "--disable-setuid-sandbox");
  try {
    return await puppeteer.launch({ headless: "shell", args });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (wantsNoSandbox() || !/sandbox|namespace|zygote/i.test(message)) {
      throw httpFail(503, "The diagram renderer could not start.", "renderer");
    }
    return puppeteer.launch({
      headless: "shell",
      args: [...args, "--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
}

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  const current = await browserPromise;
  if (!current.connected) {
    browserPromise = null;
    return browser();
  }
  return current;
}

export async function closeRenderer(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const current = await pending;
    await current.close();
  } catch {
    // The process is already gone.
  }
}

function assertSource(source: string): string {
  if (typeof source !== "string") throw httpFail(400, "source must be a string", "invalid");
  if (source.includes("\0")) throw httpFail(400, "source is not valid text", "invalid");
  if (!source.trim()) throw httpFail(400, "source is empty", "invalid");
  if (source.length > MAX_RENDER_SOURCE_CHARS) {
    throw httpFail(400, "source is too large", "invalid");
  }
  return source;
}

function assertBackground(value: string | undefined, theme: unknown): string {
  if (value == null || value === "") {
    return typeof theme === "string" && theme.toLowerCase().includes("dark") ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  }
  if (typeof value !== "string" || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    throw httpFail(400, "background must be a hex color", "invalid");
  }
  return value;
}

function plainError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, " ").trim().slice(0, 400) || "Mermaid could not render that diagram.";
}

async function draw(page: Page, source: string, background: string): Promise<string> {
  const init = diagramInitConfig(source);
  init.startOnLoad = false;
  init.securityLevel = "strict";
  init.suppressErrorRendering = true;
  const config = JSON.parse(JSON.stringify(init)) as Record<string, unknown>;
  await page.setContent(
    "<!doctype html><html><head><meta charset='utf-8'></head><body style='margin:0'><div id='out'></div></body></html>",
    { waitUntil: "domcontentloaded" },
  );
  await page.addScriptTag({ path: mermaidScript() });
  const svg = await page.evaluate(
    async (code: string, mermaidConfig: Record<string, unknown>, fill: string) => {
      const api = (window as unknown as { mermaid?: { initialize: (config: unknown) => void; render: (id: string, text: string) => Promise<{ svg: string }> } }).mermaid;
      if (!api) throw new Error("Mermaid did not load");
      document.body.style.background = fill;
      api.initialize(mermaidConfig);
      const rendered = await api.render("nerdgram-render", code);
      return rendered.svg;
    },
    source,
    config,
    background,
  );
  return svg;
}

async function rasterize(page: Page, svg: string, background: string): Promise<Buffer> {
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:${background}"><div id="frame" style="display:inline-block;background:${background};padding:16px"></div></body></html>`,
    { waitUntil: "domcontentloaded" },
  );
  await page.evaluate((markup: string, fill: string) => {
    const frame = document.getElementById("frame");
    if (!frame) throw new Error("Missing frame");
    frame.innerHTML = markup;
    frame.style.background = fill;
    const svgEl = frame.querySelector("svg");
    if (!svgEl) return;
    const viewBox = svgEl.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      svgEl.setAttribute("width", String(viewBox.width));
      svgEl.setAttribute("height", String(viewBox.height));
    }
  }, svg, background);
  const frame = await page.$("#frame");
  if (!frame) throw httpFail(500, "The diagram renderer did not produce a PNG.", "renderer");
  const png = await frame.screenshot({ type: "png", omitBackground: false });
  return Buffer.from(png);
}

async function renderOnce(input: RenderInput): Promise<RenderOutput> {
  const source = assertSource(input.source);
  if (input.format !== "svg" && input.format !== "png") {
    throw httpFail(400, "format must be svg or png", "invalid");
  }
  const theme = diagramInitConfig(source).theme;
  const background = assertBackground(input.background, theme);
  const current = await browser();
  const page = await current.newPage();
  page.setDefaultTimeout(20_000);
  try {
    let svg: string;
    try {
      svg = await draw(page, source, background);
    } catch (err) {
      throw httpFail(400, plainError(err), "invalid");
    }
    const cleaned = sanitizeThumbnailSvg(svg).trim();
    if (!cleaned.includes("<svg") || /syntax error/i.test(cleaned) || cleaned.length > MAX_RENDER_SVG_CHARS) {
      throw httpFail(400, "Mermaid could not render that diagram.", "invalid");
    }
    if (/<script[\s>/]/i.test(cleaned)) {
      throw httpFail(400, "Rendered SVG was rejected.", "invalid");
    }
    if (input.format === "svg") {
      return { format: "svg", contentType: "image/svg+xml; charset=utf-8", body: Buffer.from(cleaned, "utf8") };
    }
    const png = await rasterize(page, cleaned, background);
    if (png.length < 32 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw httpFail(500, "The diagram renderer did not produce a PNG.", "renderer");
    }
    return { format: "png", contentType: "image/png", body: png };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export function renderDiagram(input: RenderInput): Promise<RenderOutput> {
  return enqueue(() => renderOnce(input));
}

export type RateLimit = { limit: number; windowMs: number };

export function createRateLimiter(options: RateLimit): {
  take: (id: string) => { ok: true } | { ok: false; retryAfterSec: number };
} {
  const buckets = new Map<string, number[]>();
  return {
    take(id: string) {
      const now = Date.now();
      const recent = (buckets.get(id) ?? []).filter((stamp) => now - stamp < options.windowMs);
      if (recent.length >= options.limit) {
        const retryAfterSec = Math.max(1, Math.ceil((recent[0]! + options.windowMs - now) / 1000));
        buckets.set(id, recent);
        return { ok: false, retryAfterSec };
      }
      recent.push(now);
      buckets.set(id, recent);
      return { ok: true };
    },
  };
}

export function defaultRenderRate(): RateLimit {
  const limit = Number(process.env.NERDGRAM_RENDER_LIMIT ?? 30);
  const windowMs = Number(process.env.NERDGRAM_RENDER_WINDOW_MS ?? 60_000);
  return {
    limit: Number.isInteger(limit) && limit > 0 ? limit : 30,
    windowMs: Number.isInteger(windowMs) && windowMs >= 1000 ? windowMs : 60_000,
  };
}
