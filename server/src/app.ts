import express from "express";
import fs from "node:fs";
import path from "node:path";
import * as store from "./fsStore.js";
import { importDiagrams } from "./import.js";
import * as history from "./history.js";
import * as locks from "./locks.js";
import { ensureDataRoot, REPO_ROOT, resolveSafePath, toRelativePath } from "./paths.js";
import { REVISION_RETENTION, httpFail } from "./storage.js";
import * as trash from "./trash.js";
import {
  createDevCors,
  createHostGuard,
  createMutationGuard,
  inferRuntimeMode,
  parseCsv,
  resolveBindHosts,
  type RuntimeMode,
} from "./security.js";
import * as search from "./search.js";
import * as sync from "./sync/engine.js";
import * as syntaxReference from "./syntaxReference.js";
import * as templates from "./templates.js";
import * as thumbnails from "./thumbnails.js";
import * as updates from "./updates/service.js";
import { getVersionInfo } from "./updates/versionInfo.js";

export type ListenPort = { port: number };

export type CreateAppOptions = {
  mode?: RuntimeMode;
  /** Configured listen port. Included in the Host and Origin allow-lists. */
  port?: number;
  /**
   * Mutable listen port. `startServer` updates this after binding port 0 so
   * Host and Origin checks use the real port. Defaults to a ref around `port`.
   */
  portRef?: ListenPort;
  bindHosts?: readonly string[];
  allowedHosts?: readonly string[];
  allowedOrigins?: readonly string[];
};

function httpError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err && typeof err === "object") {
    const errno = "code" in err ? String((err as { code: unknown }).code) : "";
    const explicit =
      "status" in err && typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : undefined;
    const message = err instanceof Error ? err.message : "Unknown error";
    const details =
      "details" in err &&
      (err as { details?: unknown }).details &&
      typeof (err as { details?: unknown }).details === "object"
        ? (err as { details: Record<string, unknown> }).details
        : undefined;
    const appCode =
      typeof (err as { code?: unknown }).code === "string" &&
      !/^[A-Z0-9]+$/.test(String((err as { code?: unknown }).code))
        ? String((err as { code?: unknown }).code)
        : undefined;

    let status = explicit ?? 500;
    let errorMessage = message;
    if (explicit === undefined) {
      if (errno === "ENOENT" || message.includes("ENOENT")) {
        status = 404;
        errorMessage = "Not found";
      } else if (message.includes("escapes") || message.includes("Invalid")) {
        status = 400;
      }
    }

    const body: Record<string, unknown> = { error: errorMessage };
    if (appCode) body.code = appCode;
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        if (key !== "error" && key !== "status" && key !== "code") body[key] = value;
      }
    }
    return { status, body };
  }
  return { status: 500, body: { error: "Unknown error" } };
}

function sendError(res: express.Response, err: unknown): void {
  const { status, body } = httpError(err);
  res.status(status).json(body);
}

function jsonObject(req: express.Request, res: express.Response): boolean {
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

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value !== "boolean") {
    throw httpFail(400, `${name} must be a boolean`, "invalid");
  }
  return value;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const portRef = options.portRef ?? { port: options.port ?? Number(process.env.PORT || 8787) };
  if (options.port != null && options.port > 0) portRef.port = options.port;
  const getPort = () => portRef.port;
  const mode = options.mode ?? inferRuntimeMode();
  const bindHosts = options.bindHosts ?? resolveBindHosts(process.env.HOST);
  const extraHosts = options.allowedHosts ?? parseCsv(process.env.NERDGRAM_ALLOWED_HOSTS);
  const extraOrigins = options.allowedOrigins ?? parseCsv(process.env.NERDGRAM_CORS_ORIGINS);

  const app = express();
  app.use(createHostGuard({ getPort, bindHosts, extraHosts }));
  if (mode === "development") {
    app.use(createDevCors({ getPort, extraOrigins }));
  }
  app.use(createMutationGuard({ getPort, mode, extraOrigins }));
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    const version = getVersionInfo();
    res.json({
      ok: true,
      name: "NerdGram1337",
      dataDir: ensureDataRoot(),
      version: version.version,
      commit: version.commit,
      installKind: version.installKind,
    });
  });

  app.get("/api/version", (_req, res) => {
    res.json(getVersionInfo());
  });

  app.get("/api/updates", async (_req, res) => {
    try {
      res.json(await updates.getUpdateStatus());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/updates/job", (_req, res) => {
    res.json({ job: updates.getUpdateJob() });
  });

  app.post("/api/updates/check", async (req, res) => {
    try {
      if (!jsonObject(req, res)) return;
      res.json(await updates.manualCheck());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/updates/settings", async (req, res) => {
    try {
      if (!jsonObject(req, res)) return;
      res.json(
        await updates.saveUpdateSettings({
          automatic: optionalBoolean(req.body?.automatic, "automatic"),
          includePrerelease: optionalBoolean(req.body?.includePrerelease, "includePrerelease"),
          clearSkipped: optionalBoolean(req.body?.clearSkipped, "clearSkipped"),
        }),
      );
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/updates/skip", async (req, res) => {
    try {
      if (!jsonObject(req, res)) return;
      res.json(await updates.skipCurrentRelease());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/updates/later", async (req, res) => {
    try {
      if (!jsonObject(req, res)) return;
      res.json(await updates.dismissCurrentRelease());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/updates/apply", async (req, res) => {
    try {
      if (!jsonObject(req, res)) return;
      res.status(202).json({ job: updates.startApply() });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/tree", async (_req, res) => {
    try {
      const tree = await store.buildTree();
      res.json({ tree });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/list", async (req, res) => {
    try {
      const folderPath = String(req.query.path || "");
      const listing = await store.listFolder(folderPath);
      res.json(listing);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/diagram-meta", async (_req, res) => {
    try {
      const diagrams = await store.listDiagramMeta();
      res.json({ diagrams });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/search", async (req, res) => {
    try {
      const q = String(req.query.q ?? "");
      if (req.query.names != null && req.query.names !== "0" && req.query.names !== "1" && req.query.names !== "true" && req.query.names !== "false") {
        res.status(400).json({ error: "names must be 0 or 1", code: "invalid" });
        return;
      }
      if (req.query.regex != null && req.query.regex !== "0" && req.query.regex !== "1" && req.query.regex !== "true" && req.query.regex !== "false") {
        res.status(400).json({ error: "regex must be 0 or 1", code: "invalid" });
        return;
      }
      const result = await search.searchDiagrams({
        q,
        namesOnly: req.query.names === "1" || req.query.names === "true",
        contents: req.query.contents !== "0" && req.query.contents !== "false",
        regex: req.query.regex === "1" || req.query.regex === "true",
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/thumbnail", async (req, res) => {
    try {
      const filePath = String(req.query.path || "");
      if (!filePath) {
        res.status(400).json({ error: "path is required", code: "invalid" });
        return;
      }
      const hit = await thumbnails.readThumbnail(filePath);
      res.json(hit);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put("/api/thumbnail", async (req, res) => {
    try {
      const filePath = String(req.body?.path || "");
      if (!filePath || typeof req.body?.cacheKey !== "string" || !req.body.cacheKey.trim()) {
        res.status(400).json({ error: "path and cacheKey are required", code: "invalid" });
        return;
      }
      if (typeof req.body?.svg !== "string") {
        res.status(400).json({ error: "svg must be a string", code: "invalid" });
        return;
      }
      const result = await thumbnails.writeThumbnail(filePath, req.body.cacheKey, req.body.svg);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/file", async (req, res) => {
    try {
      const filePath = String(req.query.path || "");
      if (!filePath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      const file = await store.readFile(filePath);
      res.json(file);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put("/api/file", async (req, res) => {
    try {
      const filePath = String(req.body?.path || "");
      const content = String(req.body?.content ?? "");
      if (!filePath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      if (req.body?.expectedMtimeMs != null && typeof req.body.expectedMtimeMs !== "number") {
        res.status(400).json({ error: "expectedMtimeMs must be a number", code: "invalid" });
        return;
      }
      if (req.body?.expectedHash != null && typeof req.body.expectedHash !== "string") {
        res.status(400).json({ error: "expectedHash must be a string", code: "invalid" });
        return;
      }
      if (req.body?.force != null && typeof req.body.force !== "boolean") {
        res.status(400).json({ error: "force must be a boolean", code: "invalid" });
        return;
      }
      if (req.body?.lockToken != null && typeof req.body.lockToken !== "string") {
        res.status(400).json({ error: "lockToken must be a string", code: "invalid" });
        return;
      }
      const result = await store.writeFile(filePath, content, {
        expectedMtimeMs:
          typeof req.body?.expectedMtimeMs === "number" ? req.body.expectedMtimeMs : null,
        expectedHash: typeof req.body?.expectedHash === "string" ? req.body.expectedHash : null,
        force: req.body?.force === true,
        lockToken: typeof req.body?.lockToken === "string" ? req.body.lockToken : null,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/folder", async (req, res) => {
    try {
      const folderPath = String(req.body?.path || "");
      const result = await store.createFolder(folderPath);
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch("/api/rename", async (req, res) => {
    try {
      const from = String(req.body?.from || "");
      const to = String(req.body?.to || "");
      if (!from || !to) {
        res.status(400).json({ error: "from and to are required" });
        return;
      }
      const result = await store.renameItem(from, to);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/move", async (req, res) => {
    try {
      const from = String(req.body?.from || "");
      const toFolder = String(req.body?.toFolder ?? "");
      if (!from) {
        res.status(400).json({ error: "from is required" });
        return;
      }
      const result = await store.moveItem(from, toFolder);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/duplicate", async (req, res) => {
    try {
      const itemPath = String(req.body?.path || "");
      if (!itemPath) {
        res.status(400).json({ error: "path is required", code: "invalid" });
        return;
      }
      const result = await store.duplicateItem(itemPath);
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/import", async (req, res) => {
    try {
      if (req.body?.folder != null && typeof req.body.folder !== "string") {
        res.status(400).json({ error: "folder must be a string", code: "invalid" });
        return;
      }
      const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
      const result = await importDiagrams(folder, req.body?.files);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/api/item", async (req, res) => {
    try {
      const itemPath = String(req.query.path || req.body?.path || "");
      if (!itemPath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      await store.deleteItem(itemPath);
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/favorites", async (_req, res) => {
    try {
      const favorites = await store.getFavorites();
      res.json({ favorites });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/favorites/toggle", async (req, res) => {
    try {
      const itemPath = String(req.body?.path || "");
      if (!itemPath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      const result = await store.toggleFavorite(itemPath);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/reference", async (_req, res) => {
    try {
      await syntaxReference.ensureReferenceDirs();
      const data = await syntaxReference.listReference();
      res.json(data);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/reference/page", async (req, res) => {
    try {
      const id = String(req.query.id || "");
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const page = await syntaxReference.getReferencePage(id);
      res.json(page);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put("/api/reference/override", async (req, res) => {
    try {
      const id = String(req.body?.id || "");
      const text = String(req.body?.text ?? "");
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const result = await syntaxReference.setOverride(id, text);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/reference/sync", async (_req, res) => {
    try {
      const manifest = await syntaxReference.syncReference();
      res.json({ manifest, pages: manifest.pages });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/trash", async (_req, res) => {
    try {
      const items = await trash.listTrash();
      res.json({ items });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/trash/restore", async (req, res) => {
    try {
      const id = String(req.body?.id || "");
      if (!id) {
        res.status(400).json({ error: "id is required", code: "invalid" });
        return;
      }
      const destination =
        req.body?.path == null || req.body.path === "" ? undefined : String(req.body.path);
      if (req.body?.overwrite != null && typeof req.body.overwrite !== "boolean") {
        res.status(400).json({ error: "overwrite must be a boolean", code: "invalid" });
        return;
      }
      const result = await trash.restoreTrashItem(id, {
        destination,
        overwrite: req.body?.overwrite === true,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/api/trash/item", async (req, res) => {
    try {
      const id = String(req.query.id || req.body?.id || "");
      if (!id) {
        res.status(400).json({ error: "id is required", code: "invalid" });
        return;
      }
      await trash.purgeTrashItem(id);
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/trash/empty", async (_req, res) => {
    try {
      const result = await trash.emptyTrash();
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/history", async (req, res) => {
    try {
      const filePath = String(req.query.path || "");
      if (!filePath) {
        res.status(400).json({ error: "path is required", code: "invalid" });
        return;
      }
      const revisions = await history.listRevisions(filePath);
      res.json({ path: filePath, retention: REVISION_RETENTION, revisions });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/history/revision", async (req, res) => {
    try {
      const filePath = String(req.query.path || "");
      const id = String(req.query.id || "");
      if (!filePath || !id) {
        res.status(400).json({ error: "path and id are required", code: "invalid" });
        return;
      }
      const revision = await history.readRevision(filePath, id);
      res.json(revision);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/history/restore", async (req, res) => {
    try {
      const filePath = String(req.body?.path || "");
      const id = String(req.body?.id || "");
      if (!filePath || !id) {
        res.status(400).json({ error: "path and id are required", code: "invalid" });
        return;
      }
      if (req.body?.lockToken != null && typeof req.body.lockToken !== "string") {
        res.status(400).json({ error: "lockToken must be a string", code: "invalid" });
        return;
      }
      const result = await store.restoreRevision(
        filePath,
        id,
        typeof req.body?.lockToken === "string" ? req.body.lockToken : null,
      );
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  function diagramPath(input: unknown): string {
    const requested = String(input || "");
    if (!requested) {
      throw Object.assign(new Error("path is required"), { status: 400, code: "invalid" });
    }
    const absolute = resolveSafePath(requested);
    const relative = toRelativePath(absolute);
    if (!relative.toLowerCase().endsWith(".mmd")) {
      throw Object.assign(new Error("Only .mmd diagram files are supported"), {
        status: 400,
        code: "invalid",
      });
    }
    return relative;
  }

  app.post("/api/lock", async (req, res) => {
    try {
      const relative = diagramPath(req.body?.path);
      const sessionId = String(req.body?.sessionId || "");
      const lock = await locks.acquireLock(relative, sessionId);
      res.json(lock);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/lock/heartbeat", async (req, res) => {
    try {
      const relative = diagramPath(req.body?.path);
      const token = String(req.body?.token || "");
      if (!token) {
        res.status(400).json({ error: "token is required", code: "invalid" });
        return;
      }
      const lock = await locks.heartbeatLock(relative, token);
      res.json(lock);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/templates", async (_req, res) => {
    try {
      const listed = await templates.listTemplates();
      res.json({ templates: listed });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/templates/:id", async (req, res) => {
    try {
      const template = await templates.readTemplate(String(req.params.id || ""));
      res.json(template);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/templates/:id/use", async (req, res) => {
    try {
      const created = await templates.createDiagramFromTemplate(String(req.params.id || ""), {
        name: req.body?.name,
        folder: req.body?.folder,
      });
      res.status(201).json(created);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/lock/release", async (req, res) => {
    try {
      const relative = diagramPath(req.body?.path);
      const token = String(req.body?.token || "");
      if (!token) {
        res.status(400).json({ error: "token is required", code: "invalid" });
        return;
      }
      await locks.releaseLock(relative, token);
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/sync/status", async (_req, res) => {
    try {
      res.json(await sync.getSyncStatus());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sync/client-id", async (req, res) => {
    try {
      if (typeof req.body?.clientId !== "string") {
        res.status(400).json({ error: "clientId is required", code: "invalid" });
        return;
      }
      res.json(await sync.saveClientId(req.body.clientId));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sync/device/start", async (_req, res) => {
    try {
      res.json(await sync.startDeviceFlow());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sync/connect", async (req, res) => {
    try {
      if (req.body?.name != null && typeof req.body.name !== "string") {
        res.status(400).json({ error: "name must be a string", code: "invalid" });
        return;
      }
      if (req.body?.private != null && typeof req.body.private !== "boolean") {
        res.status(400).json({ error: "private must be a boolean", code: "invalid" });
        return;
      }
      if (req.body?.confirmNonEmpty != null && typeof req.body.confirmNonEmpty !== "boolean") {
        res.status(400).json({ error: "confirmNonEmpty must be a boolean", code: "invalid" });
        return;
      }
      res.json(
        await sync.connectRepo({
          name: typeof req.body?.name === "string" ? req.body.name : undefined,
          private: typeof req.body?.private === "boolean" ? req.body.private : undefined,
          confirmNonEmpty: req.body?.confirmNonEmpty === true,
        }),
      );
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sync/now", async (_req, res) => {
    try {
      res.json(await sync.syncNow());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sync/pull", async (_req, res) => {
    try {
      res.json(await sync.pullFromRemote());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sync/resolve", async (req, res) => {
    try {
      if (!Array.isArray(req.body?.choices)) {
        res.status(400).json({ error: "choices is required", code: "invalid" });
        return;
      }
      const choices: { path: string; choice: "local" | "remote" | "both" }[] = [];
      for (const choice of req.body.choices) {
        if (!choice || typeof choice !== "object") {
          res.status(400).json({ error: "Each choice needs a path and local, remote, or both", code: "invalid" });
          return;
        }
        const record = choice as { path?: unknown; choice?: unknown };
        const side = record.choice;
        const itemPath = typeof record.path === "string" ? record.path : "";
        if (!itemPath || (side !== "local" && side !== "remote" && side !== "both")) {
          res.status(400).json({ error: "Each choice needs a path and local, remote, or both", code: "invalid" });
          return;
        }
        choices.push({ path: itemPath, choice: side });
      }
      res.json(await sync.resolveConflicts(choices));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sync/disable", async (req, res) => {
    try {
      if (req.body?.confirm != null && typeof req.body.confirm !== "boolean") {
        res.status(400).json({ error: "confirm must be a boolean", code: "invalid" });
        return;
      }
      res.json(await sync.disableSync(req.body?.confirm === true));
    } catch (err) {
      sendError(res, err);
    }
  });

  const clientDist = path.join(REPO_ROOT, "client", "dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  return app;
}
