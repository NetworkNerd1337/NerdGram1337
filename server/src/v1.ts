import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { importDiagramData } from "./diagramData.js";
import { createGeneratedDiagram, importInputFromBody, refreshGeneratedDiagram } from "./diagramDataFiles.js";
import { normalizeLintRules, type LintRuleId } from "./diagramLint.js";
import { lintDiagramSource } from "./mermaidSyntax.js";
import * as store from "./fsStore.js";
import { sendError } from "./httpError.js";
import { buildOpenApiSpec, openApiPath, V1_ROUTES, type V1Route, type V1Scope } from "./openapi.js";
import { createRateLimiter, defaultRenderRate, renderDiagram, type RateLimit, type RenderFormat } from "./renderDiagram.js";
import * as search from "./search.js";
import { httpFail } from "./storage.js";
import { authenticateToken, bearerValue, type AuthenticatedToken } from "./tokens.js";

export type MountV1Options = {
  renderRate?: RateLimit;
};

type AuthedRequest = Request & { apiToken?: AuthenticatedToken };

function jsonObject(req: Request, res: Response): req is Request & { body: Record<string, unknown> } {
  if (req.body == null) {
    req.body = {};
    return true;
  }
  if (typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "JSON object required", code: "invalid" });
    return false;
  }
  return true;
}

function requireScope(scope: V1Scope): RequestHandler {
  return async (req, res, next) => {
    if (scope === "public") {
      next();
      return;
    }
    try {
      const presented = bearerValue(req.header("authorization"));
      if (!presented) {
        res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
        return;
      }
      const token = await authenticateToken(presented);
      if (!token) {
        res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
        return;
      }
      if (scope === "write" && token.scope !== "read-write") {
        res.status(403).json({ error: "This token cannot write.", code: "forbidden" });
        return;
      }
      (req as AuthedRequest).apiToken = token;
      next();
    } catch (err) {
      sendError(res, err);
    }
  };
}

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch((err: unknown) => {
      if (res.headersSent) return;
      sendError(res, err);
    });
  };
}

function queryFlag(value: unknown, name: string): boolean | undefined {
  if (value == null) return undefined;
  const text = String(value);
  if (text === "1" || text === "true") return true;
  if (text === "0" || text === "false") return false;
  throw httpFail(400, `${name} must be 0 or 1`, "invalid");
}

function readPath(value: unknown, label = "path"): string {
  if (typeof value !== "string" || !value.trim()) throw httpFail(400, `${label} is required`, "invalid");
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw httpFail(400, `${label} must be a string`, "invalid");
  return value;
}

function updateLinksFlag(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "boolean") throw httpFail(400, "updateLinks must be a boolean", "invalid");
  return value;
}

type TreeNode = { type: string; path: string; children?: TreeNode[] };

function walkFiles(nodes: TreeNode[]): TreeNode[] {
  const files: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "folder" && node.children) files.push(...walkFiles(node.children));
    else if (node.type === "file") files.push(node);
  }
  return files;
}

async function workspaceDiagramPaths(): Promise<string[]> {
  return walkFiles(await store.buildTree()).map((file) => file.path);
}

function readLintRules(value: unknown): Partial<Record<LintRuleId, boolean>> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw httpFail(400, "rules must be an object", "invalid");
  const record = value as Record<string, unknown>;
  for (const [key, flag] of Object.entries(record)) {
    if (flag != null && typeof flag !== "boolean") throw httpFail(400, `${key} must be a boolean`, "invalid");
  }
  return normalizeLintRules(record);
}

function readFormat(value: unknown): RenderFormat {
  if (value === "svg" || value === "png") return value;
  throw httpFail(400, "format must be svg or png", "invalid");
}

const MAX_EXPORT_FILES = 500;
const MAX_EXPORT_CHARS = 8_000_000;

export function mountAutomationApi(app: Express, options: MountV1Options = {}): void {
  const limiter = createRateLimiter(options.renderRate ?? defaultRenderRate());
  const handlers: Record<string, RequestHandler> = {
    getOpenApi: (_req, res) => {
      res.json(buildOpenApiSpec());
    },
    listDiagrams: asyncHandler(async (req, res) => {
      const listing = await store.listFolder(String(req.query.path || ""));
      res.json(listing);
    }),
    searchDiagrams: asyncHandler(async (req, res) => {
      const q = String(req.query.q ?? "");
      queryFlag(req.query.names, "names");
      queryFlag(req.query.regex, "regex");
      if (req.query.contents != null && queryFlag(req.query.contents, "contents") == null) {
        throw httpFail(400, "contents must be 0 or 1", "invalid");
      }
      const result = await search.searchDiagrams({
        q,
        namesOnly: req.query.names === "1" || req.query.names === "true",
        contents: req.query.contents !== "0" && req.query.contents !== "false",
        regex: req.query.regex === "1" || req.query.regex === "true",
      });
      res.json(result);
    }),
    getDiagram: asyncHandler(async (req, res) => {
      res.json(await store.readFile(readPath(req.query.path)));
    }),
    createDiagram: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      const filePath = readPath(req.body.path);
      if (typeof req.body.content !== "string") throw httpFail(400, "content must be a string", "invalid");
      try {
        await store.readFile(filePath);
        throw httpFail(409, "A diagram already exists at that path.", "exists", { path: filePath });
      } catch (err) {
        const status = err && typeof err === "object" && "status" in err ? (err as { status: unknown }).status : undefined;
        if (status !== 404) throw err;
      }
      const written = await store.writeFile(filePath, req.body.content);
      res.status(201).json(written);
    }),
    updateDiagram: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      const filePath = readPath(req.body.path);
      if (typeof req.body.content !== "string") throw httpFail(400, "content must be a string", "invalid");
      if (req.body.expectedMtimeMs != null && typeof req.body.expectedMtimeMs !== "number") {
        throw httpFail(400, "expectedMtimeMs must be a number", "invalid");
      }
      if (req.body.expectedHash != null && typeof req.body.expectedHash !== "string") {
        throw httpFail(400, "expectedHash must be a string", "invalid");
      }
      if (req.body.force != null && typeof req.body.force !== "boolean") {
        throw httpFail(400, "force must be a boolean", "invalid");
      }
      const written = await store.writeFile(filePath, req.body.content, {
        expectedMtimeMs: typeof req.body.expectedMtimeMs === "number" ? req.body.expectedMtimeMs : null,
        expectedHash: typeof req.body.expectedHash === "string" ? req.body.expectedHash : null,
        force: req.body.force === true,
      });
      res.json(written);
    }),
    renameDiagram: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      const from = readPath(req.body.from, "from");
      const to = readPath(req.body.to, "to");
      const result = await store.renameItem(from, to, { updateLinks: updateLinksFlag(req.body.updateLinks) });
      res.json(result);
    }),
    moveDiagram: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      const from = readPath(req.body.from, "from");
      if (req.body.toFolder != null && typeof req.body.toFolder !== "string") {
        throw httpFail(400, "toFolder must be a string", "invalid");
      }
      const toFolder = typeof req.body.toFolder === "string" ? req.body.toFolder : "";
      const result = await store.moveItem(from, toFolder, { updateLinks: updateLinksFlag(req.body.updateLinks) });
      res.json(result);
    }),
    deleteDiagram: asyncHandler(async (req, res) => {
      if (req.body != null && (typeof req.body !== "object" || Array.isArray(req.body))) {
        res.status(400).json({ error: "JSON object required", code: "invalid" });
        return;
      }
      const itemPath = String(req.query.path || req.body?.path || "");
      if (!itemPath) throw httpFail(400, "path is required", "invalid");
      const confirmLinks = req.query.confirmLinks === "0" || req.body?.confirmLinks === false ? false : true;
      if (req.body?.confirmLinks != null && typeof req.body.confirmLinks !== "boolean") {
        throw httpFail(400, "confirmLinks must be a boolean", "invalid");
      }
      await store.deleteItem(itemPath, { confirmLinks });
      res.json({ path: itemPath, trashed: true });
    }),
    createFolder: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      const created = await store.createFolder(readPath(req.body.path));
      res.status(201).json(created);
    }),
    exportDiagrams: asyncHandler(async (req, res) => {
      const folder = String(req.query.path || "");
      const files = walkFiles(await store.buildTree(folder || "."));
      if (files.length > MAX_EXPORT_FILES) throw httpFail(413, "That folder has too many diagrams to export at once.", "too_large");
      const exported: { path: string; content: string }[] = [];
      let chars = 0;
      for (const file of files) {
        const content = await store.readFile(file.path);
        chars += content.content.length;
        if (chars > MAX_EXPORT_CHARS) throw httpFail(413, "That folder is too large to export at once.", "too_large");
        exported.push({ path: content.path, content: content.content });
      }
      res.json({ path: folder, files: exported });
    }),
    previewLinkRepairs: asyncHandler(async (_req, res) => {
      res.json(await store.repairDiagramLinks({ dryRun: true, confirm: false }));
    }),
    applyLinkRepairs: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      res.json(await store.repairDiagramLinks(store.repairOptionsFromBody(req.body)));
    }),
    lintWorkspace: asyncHandler(async (req, res) => {
      const paths = await workspaceDiagramPaths();
      const requested = optionalString(req.query.path, "path");
      if (requested) {
        const file = await store.readFile(requested);
        res.json({
          path: file.path,
          diagnostics: await lintDiagramSource(file.content, { diagramPaths: paths, sourcePath: file.path }),
        });
        return;
      }
      const diagrams: { path: string; diagnostics: Awaited<ReturnType<typeof lintDiagramSource>> }[] = [];
      for (const filePath of paths) {
        const content = await store.readFile(filePath);
        const diagnostics = await lintDiagramSource(content.content, { diagramPaths: paths, sourcePath: filePath });
        if (diagnostics.length > 0) diagrams.push({ path: filePath, diagnostics });
      }
      res.json({ checked: paths.length, diagrams });
    }),
    lintSource: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      if (typeof req.body.source !== "string") throw httpFail(400, "source must be a string", "invalid");
      if (req.body.source.length > 512 * 1024) throw httpFail(400, "source is too large", "invalid");
      const sourcePath = optionalString(req.body.sourcePath, "sourcePath");
      let paths = req.body.diagramPaths;
      if (paths == null) paths = await workspaceDiagramPaths();
      if (!Array.isArray(paths) || paths.some((item) => typeof item !== "string")) {
        throw httpFail(400, "diagramPaths must be an array of strings", "invalid");
      }
      const diagramPaths = paths.slice(0, 5000).map((item: string) => item.slice(0, 500));
      res.json({
        diagnostics: await lintDiagramSource(req.body.source, {
          diagramPaths,
          rules: readLintRules(req.body.rules),
          sourcePath,
        }),
      });
    }),
    renderSavedDiagram: asyncHandler(async (req, res) => {
      await sendRender(req, res, limiter, {
        path: readPath(req.query.path),
        format: readFormat(req.query.format),
        background: optionalString(req.query.background, "background"),
      });
    }),
    renderDiagram: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      const pathValue = optionalString(req.body.path, "path");
      const source = optionalString(req.body.source, "source");
      if (pathValue && source != null) throw httpFail(400, "Send path or source, not both.", "invalid");
      if (!pathValue && source == null) throw httpFail(400, "path or source is required", "invalid");
      await sendRender(req, res, limiter, {
        path: pathValue,
        source,
        format: readFormat(req.body.format),
        background: optionalString(req.body.background, "background"),
      });
    }),
    previewGenerate: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      res.json(importDiagramData(importInputFromBody(req.body)));
    }),
    generateDiagram: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      if (typeof req.body.path !== "string" || !req.body.path.trim()) {
        throw httpFail(400, "path is required", "invalid");
      }
      if (req.body.storeData != null && typeof req.body.storeData !== "boolean") {
        throw httpFail(400, "storeData must be a boolean", "invalid");
      }
      if (req.body.dataName != null && typeof req.body.dataName !== "string") {
        throw httpFail(400, "dataName must be a string", "invalid");
      }
      const created = await createGeneratedDiagram({
        ...importInputFromBody(req.body),
        path: req.body.path,
        storeData: req.body.storeData,
        dataName: req.body.dataName,
      });
      res.status(201).json(created);
    }),
    refreshDiagram: asyncHandler(async (req, res) => {
      if (!jsonObject(req, res)) return;
      if (typeof req.body.path !== "string" || !req.body.path.trim()) {
        throw httpFail(400, "path is required", "invalid");
      }
      if (req.body.save != null && typeof req.body.save !== "boolean") {
        throw httpFail(400, "save must be a boolean", "invalid");
      }
      if (req.body.writeData != null && typeof req.body.writeData !== "boolean") {
        throw httpFail(400, "writeData must be a boolean", "invalid");
      }
      if (req.body.text != null && typeof req.body.text !== "string") throw httpFail(400, "text must be a string", "invalid");
      if (req.body.edgesText != null && typeof req.body.edgesText !== "string") {
        throw httpFail(400, "edgesText must be a string", "invalid");
      }
      if (req.body.diagramText != null && typeof req.body.diagramText !== "string") {
        throw httpFail(400, "diagramText must be a string", "invalid");
      }
      const refreshed = await refreshGeneratedDiagram({
        path: req.body.path,
        diagramText: req.body.diagramText,
        text: req.body.text,
        edgesText: typeof req.body.edgesText === "string" ? req.body.edgesText : undefined,
        writeData: req.body.writeData,
      });
      if (req.body.save === true) {
        const written = await store.writeFile(refreshed.path, refreshed.mermaid, { force: true });
        res.json({ ...refreshed, saved: true, mtimeMs: written.mtimeMs, hash: written.hash });
        return;
      }
      res.json({ ...refreshed, saved: false });
    }),
  };

  const router = Router();
  for (const route of V1_ROUTES) {
    const handler = handlers[route.operationId];
    if (!handler) throw new Error(`Missing /api/v1 handler ${route.operationId}`);
    router[route.method](route.path, requireScope(route.scope), handler);
  }
  app.use("/api/v1", router);
}

async function sendRender(
  req: Request,
  res: Response,
  limiter: ReturnType<typeof createRateLimiter>,
  input: { path?: string; source?: string; format: RenderFormat; background?: string },
): Promise<void> {
  const token = (req as AuthedRequest).apiToken;
  if (!token) throw httpFail(401, "Unauthorized", "unauthorized");
  const decision = limiter.take(token.id);
  if (!decision.ok) {
    res.setHeader("Retry-After", String(decision.retryAfterSec));
    res.status(429).json({ error: "Too many render requests.", code: "rate_limited" });
    return;
  }
  const source = input.source ?? (await store.readFile(input.path || "")).content;
  const rendered = await renderDiagram({ source, format: input.format, background: input.background });
  res.setHeader("Content-Type", rendered.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.send(rendered.body);
}

export function v1RouteList(): { method: string; path: string; scope: V1Scope; operationId: string }[] {
  return V1_ROUTES.map((route) => ({
    method: route.method,
    path: openApiPath(route),
    scope: route.scope,
    operationId: route.operationId,
  }));
}
