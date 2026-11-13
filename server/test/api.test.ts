import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { RuntimeMode } from "../src/security.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function makeApp(mode: RuntimeMode, extraOrigins: string[] = []) {
  return createApp({
    mode,
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: extraOrigins,
  });
}

describe("API host, origin, and path guards", () => {
  let dir = "";
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("serves health for a loopback Host and hides it from a foreign Host", async () => {
    const app = makeApp("production");
    const ok = await request(app).get("/api/health").set("Host", HOST);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.dataDir).toBe(dir);

    for (const host of ["evil.example", "evil.example:8787", "127.0.0.1.evil.com:8787"]) {
      const blocked = await request(app).get("/api/health").set("Host", host);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe("Forbidden host");
      expect(blocked.body.dataDir).toBeUndefined();
    }

    const v6 = await request(app).get("/api/health").set("Host", "[::1]:8787");
    expect(v6.status).toBe(200);
  });

  it("does not enable CORS in production, and only reflects the Vite origin in development", async () => {
    const production = makeApp("production");
    const hidden = await request(production)
      .get("/api/health")
      .set("Host", HOST)
      .set("Origin", "https://evil.example");
    expect(hidden.status).toBe(200);
    expect(hidden.headers["access-control-allow-origin"]).toBeUndefined();

    const dev = makeApp("development");
    const allowed = await request(dev)
      .get("/api/health")
      .set("Host", HOST)
      .set("Origin", "http://localhost:5173");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const denied = await request(dev)
      .get("/api/health")
      .set("Host", HOST)
      .set("Origin", "https://evil.example");
    expect(denied.status).toBe(200);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects a cross-origin mutation and still allows same-origin and local clients", async () => {
    const app = makeApp("production");
    const cross = await request(app)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Origin", "https://evil.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Content-Type", "application/json")
      .send({ path: "Stolen" });
    expect(cross.status).toBe(403);
    expect(cross.body.error).toBe("Forbidden origin");
    await expect(fs.access(path.join(dir, "Stolen"))).rejects.toThrow();

    const sameOrigin = await request(app)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Origin", "http://127.0.0.1:8787")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Content-Type", "application/json")
      .send({ path: "Lab" });
    expect(sameOrigin.status).toBe(201);

    const curl = await request(app)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "Notes" });
    expect(curl.status).toBe(201);
  });

  it("rejects a cross-origin DELETE and keeps the diagram", async () => {
    const app = makeApp("production");
    await request(app)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "Keep.mmd", content: "flowchart LR\n  A-->B" });

    const deleted = await request(app)
      .delete("/api/item")
      .query({ path: "Keep.mmd" })
      .set("Host", HOST)
      .set("Origin", "https://evil.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Content-Type", "application/json");
    expect(deleted.status).toBe(403);
    const stillThere = await fs.readFile(path.join(dir, "Keep.mmd"), "utf8");
    expect(stillThere).toContain("A-->B");
  });

  it("allows the Vite dev origin and rejects the fallback port unless it is listed", async () => {
    const dev = makeApp("development");
    const ok = await request(dev)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Origin", "http://127.0.0.1:5173")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Content-Type", "application/json")
      .send({ path: "FromDev" });
    expect(ok.status).toBe(201);

    const fallback = await request(dev)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Origin", "http://localhost:5174")
      .set("Content-Type", "application/json")
      .send({ path: "FromFallback" });
    expect(fallback.status).toBe(403);

    const production = makeApp("production");
    const devAgainstProd = await request(production)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Origin", "http://localhost:5173")
      .set("Content-Type", "application/json")
      .send({ path: "Nope" });
    expect(devAgainstProd.status).toBe(403);

    const listed = makeApp("development", ["http://localhost:5174"]);
    const allowed = await request(listed)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Origin", "http://localhost:5174")
      .set("Content-Type", "application/json")
      .send({ path: "FromListed" });
    expect(allowed.status).toBe(201);
  });

  it("rejects an HTML form content type", async () => {
    const app = makeApp("production");
    const form = await request(app)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("path=Formed");
    expect(form.status).toBe(415);

    const jsonCharset = await request(app)
      .post("/api/folder")
      .set("Host", HOST)
      .set("Content-Type", "application/json; charset=utf-8")
      .send({ path: "Charset" });
    expect(jsonCharset.status).toBe(201);
  });

  it("creates, renames, and deletes a diagram for a same-origin client", async () => {
    const app = makeApp("production");
    const headers = {
      Host: HOST,
      Origin: "http://localhost:8787",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    };

    const created = await request(app)
      .put("/api/file")
      .set(headers)
      .send({ path: "Lab/Core.mmd", content: "flowchart LR\n  A-->B" });
    expect(created.status).toBe(200);

    const read = await request(app).get("/api/file").query({ path: "Lab/Core.mmd" }).set("Host", HOST);
    expect(read.status).toBe(200);
    expect(read.body.content).toContain("A-->B");

    const renamed = await request(app)
      .patch("/api/rename")
      .set(headers)
      .send({ from: "Lab/Core.mmd", to: "Lab/Edge.mmd" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.path).toBe("Lab/Edge.mmd");

    const removed = await request(app)
      .delete("/api/item")
      .query({ path: "Lab/Edge.mmd" })
      .set(headers);
    expect(removed.status).toBe(204);
    await expect(fs.access(path.join(dir, "Lab", "Edge.mmd"))).rejects.toThrow();
  });

  it("rejects path traversal and null bytes without writing outside the data root", async () => {
    const app = makeApp("production");
    const outside = path.join(path.dirname(dir), "nerdgram-escaped.mmd");
    const escaped = await request(app)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "../nerdgram-escaped.mmd", content: "flowchart LR\n  A-->B" });
    expect(escaped.status).toBe(400);
    expect(escaped.body.error).toMatch(/escapes/);
    await expect(fs.access(outside)).rejects.toThrow();

    const absolute = await request(app)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "/tmp/nerdgram-absolute.mmd", content: "flowchart LR\n  A-->B" });
    expect(absolute.status).toBe(200);
    expect(absolute.body.path).toBe("tmp/nerdgram-absolute.mmd");
    await expect(fs.access("/tmp/nerdgram-absolute.mmd")).rejects.toThrow();
    const contained = await fs.readFile(path.join(dir, "tmp", "nerdgram-absolute.mmd"), "utf8");
    expect(contained).toContain("A-->B");

    const nul = await request(app)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "bad\0.mmd", content: "flowchart LR\n  A-->B" });
    expect(nul.status).toBe(400);
    expect(nul.body.error).toMatch(/Invalid path/);
  });
});
