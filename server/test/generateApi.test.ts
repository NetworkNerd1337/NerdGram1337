import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = { Host: HOST, "Content-Type": "application/json" };

const links = `Local Device,Local Port,Remote Device,Remote Port,Local Group,Remote Diagram
Core,Gi0/1,Atlanta,Gi0/2,HQ,Sites/Atlanta.mmd
Core,Gi0/3,Remote,Gi0/4,HQ,
`;

describe("generate API", () => {
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

  function app() {
    return createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
  }

  it("previews, stores the data file, and refuses a path outside the workspace", async () => {
    const server = app();
    const preview = await request(server).post("/api/generate/preview").set(json).send({ text: links, title: "Campus" });
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.mermaid).toContain('click Atlanta "nerdgram:Sites/Atlanta.mmd"');
    expect(preview.body.mermaid).not.toContain("javascript:");

    const created = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text: links, path: "Network/Campus.mmd", title: "Campus" });
    expect(created.status).toBe(201);
    expect(created.body.path).toBe("Network/Campus.mmd");
    expect(created.body.dataPath).toBe("Network/Campus.csv");
    const diagram = await fs.readFile(path.join(dir, "Network", "Campus.mmd"), "utf8");
    const data = await fs.readFile(path.join(dir, "Network", "Campus.csv"), "utf8");
    expect(diagram).toContain("%% nerdgram:generated");
    expect(diagram).toContain("file: Network/Campus.csv");
    expect(data).toContain("Atlanta");
    expect(path.resolve(path.join(dir, "Network", "Campus.csv")).startsWith(path.resolve(dir))).toBe(true);

    const escaped = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text: links, path: "../Campus.mmd" });
    expect(escaped.status).toBe(400);

    const hidden = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text: links, path: "Campus.mmd", dataName: ".meta/secret.csv" });
    expect(hidden.status).toBe(400);
    await expect(fs.access(path.join(dir, ".meta", "secret.csv"))).rejects.toThrow();

    const again = await request(server).post("/api/generate").set(json).send({ text: links, path: "Network/Campus.mmd" });
    expect(again.status).toBe(409);
  });

  it("shows a refresh diff and keeps text outside the generated markers", async () => {
    const server = app();
    const created = await request(server).post("/api/generate").set(json).send({ text: links, path: "Campus.mmd" });
    expect(created.status).toBe(201);
    const original = await fs.readFile(path.join(dir, "Campus.mmd"), "utf8");
    const edited = `${original}\n%% operator note\n  spare["Spare"]\n`;
    const updated = links.replace("Remote,Gi0/4,HQ,", "Remote,Gi0/4,HQ,\nEdge,Gi0/9,Remote,Gi0/8,HQ,");
    const preview = await request(server)
      .post("/api/generate/refresh")
      .set(json)
      .send({ path: "Campus.mmd", diagramText: edited, text: updated });
    expect(preview.status).toBe(200);
    expect(preview.body.diff.nodes.added.map((node: { id: string }) => node.id)).toContain("Edge");
    expect(preview.body.mermaid).toContain("%% operator note");
    expect(preview.body.mermaid).toContain('spare["Spare"]');
    expect(preview.body.mermaid).toContain("%% nerdgram:generated");
    expect(await fs.readFile(path.join(dir, "Campus.mmd"), "utf8")).toBe(original);
    expect(await fs.readFile(path.join(dir, "Campus.csv"), "utf8")).toBe(links);

    const applied = await request(server)
      .post("/api/generate/refresh")
      .set(json)
      .send({ path: "Campus.mmd", diagramText: edited, text: updated, writeData: true });
    expect(applied.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Campus.csv"), "utf8")).toBe(updated);
    expect(await fs.readFile(path.join(dir, "Campus.mmd"), "utf8")).toBe(original);
  });

  it("rejects a non-JSON body and a deferred source", async () => {
    const server = app();
    const form = await request(server)
      .post("/api/generate/preview")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("local,remote");
    expect(form.status).toBe(415);

    const deferred = await request(server)
      .post("/api/generate/preview")
      .set(json)
      .send({ text: "Device ID, Local Intf", format: "lldp" });
    expect(deferred.status).toBe(400);
    expect(deferred.body.code).toBe("deferred");
  });
});
