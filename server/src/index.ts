import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./fsStore.js";
import { ensureDataRoot, REPO_ROOT } from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

function httpError(err: unknown): { status: number; message: string } {
  if (err && typeof err === "object") {
    const code = "code" in err ? String((err as { code: unknown }).code) : "";
    const explicit =
      "status" in err && typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : undefined;
    const message = err instanceof Error ? err.message : "Unknown error";
    if (explicit !== undefined) return { status: explicit, message };
    if (code === "ENOENT") return { status: 404, message: "Not found" };
    if (message.includes("escapes") || message.includes("Invalid")) {
      return { status: 400, message };
    }
    return { status: 500, message };
  }
  return { status: 500, message: "Unknown error" };
}

ensureDataRoot();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "NerdGram1337",
    dataDir: ensureDataRoot(),
  });
});

app.get("/api/tree", async (_req, res) => {
  try {
    const tree = await store.buildTree();
    res.json({ tree });
  } catch (err) {
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
  }
});

app.get("/api/list", async (req, res) => {
  try {
    const folderPath = String(req.query.path || "");
    const listing = await store.listFolder(folderPath);
    res.json(listing);
  } catch (err) {
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
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
    const { status, message } = httpError(err);
    res.status(status === 500 && message.includes("ENOENT") ? 404 : status).json({
      error: message,
    });
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
    const result = await store.writeFile(filePath, content);
    res.json(result);
  } catch (err) {
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
  }
});

app.post("/api/folder", async (req, res) => {
  try {
    const folderPath = String(req.body?.path || "");
    const result = await store.createFolder(folderPath);
    res.status(201).json(result);
  } catch (err) {
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
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
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
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
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
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
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
  }
});

app.get("/api/favorites", async (_req, res) => {
  try {
    const favorites = await store.getFavorites();
    res.json({ favorites });
  } catch (err) {
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
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
    const { status, message } = httpError(err);
    res.status(status).json({ error: message });
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

app.listen(PORT, () => {
  console.log(`NerdGram1337 API listening on http://localhost:${PORT}`);
  console.log(`Data directory: ${ensureDataRoot()}`);
  console.log(`Server module dir: ${__dirname}`);
});
