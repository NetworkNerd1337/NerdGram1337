import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildOpenApiSpec, V1_ROUTES, openApiPath } from "../src/openapi.js";
import { closeRenderer } from "../src/renderDiagram.js";
import { hashesEqual, hashToken } from "../src/tokens.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

const links = `Local Device,Local Port,Remote Device,Remote Port
Core,Gi0/1,Atlanta,Gi0/2
`;

function app(extra: Parameters<typeof createApp>[0] = {}) {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    ...extra,
  });
}

async function issueToken(server: ReturnType<typeof app>, scope: "read" | "read-write" | "write", name = "ci") {
  const created = await request(server)
    .post("/api/tokens")
    .set("Host", HOST)
    .set("Content-Type", "application/json")
    .send({ name, scope });
  expect(created.status).toBe(201);
  return created.body as {
    token: string;
    tokenMeta: { id: string; prefix: string; scope: string };
  };
}

describe("automation API", () => {
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

  afterAll(async () => {
    await closeRenderer();
  });

  it("compares token hashes in constant time and does not store the secret", async () => {
    const secret = hashToken("ng_example");
    expect(hashesEqual(secret, hashToken("ng_example"))).toBe(true);
    expect(hashesEqual(secret, hashToken("ng_other"))).toBe(false);
    expect(hashesEqual(secret, Buffer.from("short"))).toBe(false);

    const server = app();
    const created = await issueToken(server, "read-write", "laptop");
    expect(created.token.startsWith("ng_")).toBe(true);
    expect(created.tokenMeta.prefix).toBe(created.token.slice(0, 11));

    const listed = await request(server).get("/api/tokens").set("Host", HOST);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.token);
    expect(listed.body.tokens[0].hash).toBeUndefined();

    const stored = await fs.readFile(path.join(dir, ".meta", "api-tokens.json"), "utf8");
    expect(stored).not.toContain(created.token);
    expect(stored).toContain(created.tokenMeta.id);
    const mode = (await fs.stat(path.join(dir, ".meta", "api-tokens.json"))).mode & 0o777;
    expect(mode).toBe(0o600);

    const revoked = await request(server)
      .delete(`/api/tokens/${created.tokenMeta.id}`)
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({});
    expect(revoked.status).toBe(200);
    expect(revoked.body.token.revokedAt).toEqual(expect.any(String));
    const again = await request(server)
      .get("/api/v1/diagrams")
      .set("Host", HOST)
      .set("Authorization", `Bearer ${created.token}`);
    expect(again.status).toBe(401);
  });

  it("rejects missing tokens, read tokens on writes, and keeps the UI guards", async () => {
    const server = app();
    for (const route of V1_ROUTES) {
      if (route.scope === "public") continue;
      const call = request(server)[route.method](openApiPath(route)).set("Host", HOST);
      if (route.method !== "get") call.set("Content-Type", "application/json");
      const response = await call.send(route.method === "get" ? undefined : {});
      expect(response.status, `${route.method} ${openApiPath(route)}`).toBe(401);
    }

    const openapi = await request(server).get("/api/v1/openapi.json").set("Host", HOST);
    expect(openapi.status).toBe(200);
    expect(openapi.body.openapi).toBe("3.0.3");

    const read = await issueToken(server, "read");
    const denied = await request(server)
      .post("/api/v1/diagrams")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${read.token}`)
      .send({ path: "Nope.mmd", content: "flowchart LR\n  A-->B\n" });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("forbidden");

    const allowed = await request(server)
      .get("/api/v1/diagrams")
      .set("Host", HOST)
      .set("Authorization", `Bearer ${read.token}`);
    expect(allowed.status).toBe(200);

    const write = await issueToken(server, "write", "alias");
    expect(write.tokenMeta.scope).toBe("read-write");

    const ui = await request(server).get("/api/file").set("Host", HOST).query({ path: "Welcome.mmd" });
    expect(ui.status).toBe(404);

    const badHost = await request(server)
      .get("/api/v1/diagrams")
      .set("Host", "evil.example")
      .set("Authorization", `Bearer ${write.token}`);
    expect(badHost.status).toBe(403);

    const badOrigin = await request(server)
      .post("/api/v1/folders")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .set("Origin", "http://evil.example")
      .set("Authorization", `Bearer ${write.token}`)
      .send({ path: "Sites" });
    expect(badOrigin.status).toBe(403);

    const badType = await request(server)
      .post("/api/v1/folders")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .set("Authorization", `Bearer ${write.token}`)
      .send("path=Sites");
    expect(badType.status).toBe(415);
  });

  it("covers each write, link updates, locks, confinement, lint, generate, and refresh", async () => {
    const server = app();
    const write = await issueToken(server, "read-write");
    const auth = {
      Host: HOST,
      Authorization: `Bearer ${write.token}`,
      "Content-Type": "application/json",
    };

    const created = await request(server)
      .post("/api/v1/diagrams")
      .set(auth)
      .send({ path: "WAN.mmd", content: "flowchart LR\n  Atlanta[Atlanta]\n  click Atlanta \"nerdgram:Sites/Atlanta.mmd\" \"Open\"\n" });
    expect(created.status).toBe(201);
    expect(created.body.path).toBe("WAN.mmd");

    const folder = await request(server).post("/api/v1/folders").set(auth).send({ path: "Sites" });
    expect(folder.status).toBe(201);
    const detail = await request(server)
      .put("/api/v1/diagrams")
      .set(auth)
      .send({ path: "Sites/Atlanta.mmd", content: "flowchart TB\n  Edge[Edge]\n", force: true });
    expect(detail.status).toBe(200);

    const renamed = await request(server)
      .post("/api/v1/diagrams/rename")
      .set(auth)
      .send({ from: "Sites/Atlanta.mmd", to: "Sites/City.mmd" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.updated).toContain("WAN.mmd");
    const wan = await request(server).get("/api/v1/diagrams/content").set(auth).query({ path: "WAN.mmd" });
    expect(wan.body.content).toContain("nerdgram:Sites/City.mmd");

    const blocked = await request(server)
      .post("/api/v1/diagrams/move")
      .set(auth)
      .send({ from: "Sites/City.mmd", toFolder: "Archive", updateLinks: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("links");

    const moved = await request(server)
      .post("/api/v1/diagrams/move")
      .set(auth)
      .send({ from: "Sites", toFolder: "Network" });
    expect(moved.status).toBe(200);
    expect(moved.body.path).toBe("Network/Sites");
    const afterMove = await request(server).get("/api/v1/diagrams/content").set(auth).query({ path: "WAN.mmd" });
    expect(afterMove.body.content).toContain("nerdgram:Network/Sites/City.mmd");

    const found = await request(server).get("/api/v1/search").set(auth).query({ q: "Atlanta" });
    expect(found.status).toBe(200);
    expect(found.body.hits.some((hit: { path: string }) => hit.path === "WAN.mmd")).toBe(true);

    const exported = await request(server).get("/api/v1/export").set(auth).query({ path: "Network" });
    expect(exported.status).toBe(200);
    expect(exported.body.files.map((file: { path: string }) => file.path)).toContain("Network/Sites/City.mmd");

    const escaped = await request(server)
      .put("/api/v1/diagrams")
      .set(auth)
      .send({ path: "../Outside.mmd", content: "flowchart LR\n  A-->B\n", force: true });
    expect(escaped.status).toBe(400);
    const hidden = await request(server)
      .put("/api/v1/diagrams")
      .set(auth)
      .send({ path: ".meta/Secret.mmd", content: "flowchart LR\n  A-->B\n", force: true });
    expect(hidden.status).toBe(400);

    const locked = await request(server)
      .post("/api/lock")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "WAN.mmd", sessionId: "editor-session" });
    expect(locked.status).toBe(200);
    const refused = await request(server)
      .put("/api/v1/diagrams")
      .set(auth)
      .send({ path: "WAN.mmd", content: "flowchart LR\n  A-->B\n", force: true });
    expect(refused.status).toBe(423);

    const lintOne = await request(server).get("/api/v1/lint").set(auth).query({ path: "WAN.mmd" });
    expect(lintOne.status).toBe(200);
    expect(Array.isArray(lintOne.body.diagnostics)).toBe(true);
    const lintPosted = await request(server)
      .post("/api/v1/lint")
      .set(auth)
      .send({ source: "flowchart LR\n  A[One] --> B[Two]\n" });
    expect(lintPosted.status).toBe(200);
    expect(lintPosted.body.diagnostics).toEqual([]);
    const classLint = await request(server)
      .post("/api/v1/lint")
      .set(auth)
      .send({ source: 'classDiagram\n  class Animal["Cat"]\n  class Animal["Dog"]\n' });
    expect(classLint.status).toBe(200);
    expect(classLint.body.diagnostics.some((item: { ruleId: string }) => item.ruleId === "duplicate-class")).toBe(true);
    const lintBroken = await request(server)
      .post("/api/v1/lint")
      .set(auth)
      .send({ source: "flowchart LR\n  A -->\n" });
    expect(lintBroken.status).toBe(200);
    expect(lintBroken.body.diagnostics.some((item: { ruleId: string; line: number; severity: string }) => item.ruleId === "parse" && item.severity === "error" && item.line === 2)).toBe(true);

    const generated = await request(server).post("/api/v1/generate").set(auth).send({ text: links, path: "Campus.mmd", title: "Campus" });
    expect(generated.status).toBe(201);
    expect(generated.body.dataPath).toBe("Campus.csv");
    const preview = await request(server).post("/api/v1/generate/preview").set(auth).send({ text: links });
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);

    const refreshed = await request(server)
      .post("/api/v1/generate/refresh")
      .set(auth)
      .send({ path: "Campus.mmd", text: links, save: true, writeData: true });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.saved).toBe(true);
    const onDisk = await fs.readFile(path.join(dir, "Campus.mmd"), "utf8");
    expect(onDisk).toContain("%% nerdgram:generated");

    const trashed = await request(server).delete("/api/v1/diagrams").set(auth).send({ path: "Campus.mmd" });
    expect(trashed.status).toBe(200);
    expect(trashed.body.trashed).toBe(true);
    const gone = await request(server).get("/api/v1/diagrams/content").set(auth).query({ path: "Campus.mmd" });
    expect(gone.status).toBe(404);
    const trash = await request(server).get("/api/trash").set("Host", HOST);
    expect(trash.body.items.some((item: { name: string }) => item.name === "Campus.mmd")).toBe(true);
  });

  it("renders SVG and PNG and rate limits", async () => {
    const server = app({ renderRate: { limit: 2, windowMs: 60_000 } });
    const read = await issueToken(server, "read", "render");
    const auth = { Host: HOST, Authorization: `Bearer ${read.token}`, "Content-Type": "application/json" };
    await request(server)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "Box.mmd", content: "flowchart LR\n  Alpha[Alpha] --> Beta[Beta]\n" });

    const svg = await request(server).post("/api/v1/render").set(auth).send({ path: "Box.mmd", format: "svg" });
    expect(svg.status).toBe(200);
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    const svgText = Buffer.isBuffer(svg.body) ? svg.body.toString("utf8") : String(svg.text);
    expect(svgText).toContain("<svg");
    expect(svgText).toContain("Alpha");
    expect(svgText.toLowerCase()).not.toContain("<script");

    const png = await request(server).get("/api/v1/render").set(auth).query({ path: "Box.mmd", format: "png" });
    expect(png.status).toBe(200);
    expect(png.headers["content-type"]).toContain("image/png");
    expect(png.body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.body.length).toBeGreaterThan(200);

    const limited = await request(server).post("/api/v1/render").set(auth).send({ source: "flowchart LR\n  A-->B\n", format: "svg" });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
  }, 60_000);

  it("publishes an OpenAPI document that matches the routes", () => {
    const spec = buildOpenApiSpec();
    expect(spec.openapi).toBe("3.0.3");
    const info = spec.info as { title: string; version: string };
    expect(info.title).toContain("NerdGram");
    expect(info.version).toBe(createRequire(import.meta.url)("../package.json").version);
    const schemes = (spec.components as { securitySchemes: Record<string, { type: string; scheme: string }> }).securitySchemes;
    expect(schemes.bearerAuth.type).toBe("http");
    expect(schemes.bearerAuth.scheme).toBe("bearer");

    const paths = spec.paths as Record<string, Record<string, { operationId: string; responses: Record<string, unknown> }>>;
    const fromRoutes = V1_ROUTES.map((route) => `${route.method} ${openApiPath(route)}`).sort();
    const fromSpec: string[] = [];
    for (const [specPath, methods] of Object.entries(paths)) {
      expect(specPath.startsWith("/api/v1/")).toBe(true);
      for (const [method, operation] of Object.entries(methods)) {
        fromSpec.push(`${method} ${specPath}`);
        expect(operation.operationId).toBeTruthy();
        expect(operation.responses["200"] || operation.responses["201"]).toBeTruthy();
      }
    }
    expect(fromSpec.sort()).toEqual(fromRoutes);
    const ids = V1_ROUTES.map((route) => route.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
