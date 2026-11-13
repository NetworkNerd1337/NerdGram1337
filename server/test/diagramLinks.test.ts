import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  actionForClickTarget,
  clickTargetFromNode,
  indexDiagramLinks,
  inboundLinkFiles,
  linksFor,
  planLinkRewrites,
  resolveDiagramTarget,
} from "../src/diagramLinks.js";
import { resolveSafePath } from "../src/paths.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = { Host: HOST, "Content-Type": "application/json" };

function makeApp() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

const overview = `flowchart LR
  Atlanta[Atlanta] --> Remote[Remote]
  click Atlanta "nerdgram:Sites/Atlanta.mmd" "Open Atlanta"
`;

const detail = `flowchart TB
  Edge[Edge] --> Rack[Rack 3]
  click Edge "../WAN.mmd"
`;

describe("diagram link resolution", () => {
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

  it("resolves nerdgram and relative paths and refuses escapes", () => {
    expect(resolveDiagramTarget("nerdgram:Sites/Atlanta.mmd", "WAN.mmd")).toEqual({
      ok: true,
      path: "Sites/Atlanta.mmd",
    });
    expect(resolveDiagramTarget("diagram:Sites/Atlanta.mmd", "WAN.mmd")).toEqual({
      ok: true,
      path: "Sites/Atlanta.mmd",
    });
    expect(resolveDiagramTarget("../WAN.mmd", "Sites/Atlanta.mmd")).toEqual({ ok: true, path: "WAN.mmd" });
    expect(resolveDiagramTarget("./Atlanta.mmd", "Sites/WAN.mmd")).toEqual({ ok: true, path: "Sites/Atlanta.mmd" });
    expect(resolveDiagramTarget("nerdgram:../secret.mmd", "WAN.mmd")).toEqual({ ok: false, reason: "escape" });
    expect(resolveDiagramTarget("../../etc/passwd.mmd", "Sites/Atlanta.mmd")).toEqual({ ok: false, reason: "escape" });
    expect(resolveDiagramTarget("nerdgram:.meta/lock.mmd", "WAN.mmd")).toEqual({ ok: false, reason: "invalid" });
    expect(resolveDiagramTarget("Sites/Atlanta.mmd\0.mmd", "WAN.mmd").ok).toBe(false);

    const inside = resolveDiagramTarget("nerdgram:Sites/Atlanta.mmd", "WAN.mmd");
    expect(inside.ok).toBe(true);
    if (inside.ok) {
      const absolute = resolveSafePath(inside.path);
      expect(absolute.startsWith(dir + path.sep)).toBe(true);
      expect(absolute).toBe(path.join(dir, "Sites", "Atlanta.mmd"));
    }
    expect(() => resolveSafePath("../secret.mmd")).toThrow(/escapes data directory/);
    expect(() => resolveSafePath(".meta/lock.mmd")).toThrow(/Invalid path/);
  });

  it("opens workspace diagrams, blocks javascript, and reports a missing file", () => {
    const known = ["WAN.mmd", "Sites/Atlanta.mmd"];
    expect(actionForClickTarget("nerdgram:Sites/Atlanta.mmd", "WAN.mmd", known)).toEqual({
      type: "navigate",
      path: "Sites/Atlanta.mmd",
    });
    expect(actionForClickTarget("./Atlanta.mmd", "Sites/WAN.mmd", known)).toEqual({
      type: "navigate",
      path: "Sites/Atlanta.mmd",
    });
    expect(actionForClickTarget("https://example.com/net", "WAN.mmd", known)).toEqual({
      type: "external",
      url: "https://example.com/net",
    });
    expect(actionForClickTarget("javascript:alert(1)", "WAN.mmd", known).type).toBe("broken");
    expect(actionForClickTarget("nerdgram:Missing.mmd", "WAN.mmd", known).type).toBe("broken");
    expect(actionForClickTarget("../secret.mmd", "WAN.mmd", known).type).toBe("broken");
  });
});

describe("backlinks and link rewrites", () => {
  const files = [
    { path: "WAN.mmd", content: overview },
    { path: "Sites/Atlanta.mmd", content: detail },
  ];

  it("indexes links to and linked from", () => {
    const links = indexDiagramLinks(files);
    expect(linksFor(links, "Sites/Atlanta.mmd").linkedFrom).toEqual([
      { path: "WAN.mmd", target: "nerdgram:Sites/Atlanta.mmd", line: 3 },
    ]);
    expect(linksFor(links, "Sites/Atlanta.mmd").linksTo).toEqual([
      { path: "WAN.mmd", target: "../WAN.mmd", line: 3, broken: false },
    ]);
    expect(linksFor(links, "WAN.mmd").linksTo[0]?.path).toBe("Sites/Atlanta.mmd");
    expect(inboundLinkFiles(links, "Sites/Atlanta.mmd", false)).toEqual(["WAN.mmd"]);
  });

  it("rewrites nerdgram and relative links when a diagram is renamed or moved", () => {
    const renamed = planLinkRewrites(files, "Sites/Atlanta.mmd", "Sites/Atlanta-Core.mmd", false);
    const overviewNext = renamed.find((item) => item.path === "WAN.mmd");
    expect(overviewNext?.content).toContain('click Atlanta "nerdgram:Sites/Atlanta-Core.mmd"');
    const moved = planLinkRewrites(files, "Sites", "Regions/Sites", true);
    const detailNext = moved.find((item) => item.path === "Sites/Atlanta.mmd");
    expect(detailNext?.nextPath).toBe("Regions/Sites/Atlanta.mmd");
    expect(detailNext?.content).toContain('click Edge "../../WAN.mmd"');
    const overviewMoved = moved.find((item) => item.path === "WAN.mmd");
    expect(overviewMoved?.content).toContain('click Atlanta "nerdgram:Regions/Sites/Atlanta.mmd"');
  });

  it("matches the node id Mermaid puts on the rendered shape", () => {
    const node = {
      id: "",
      dataId: null,
      href: null,
      tag: "rect",
      parent: {
        id: "flowchart-Core-Site-0",
        dataId: null,
        href: null,
        tag: "g",
        parent: null,
      },
    };
    const source = 'flowchart LR\n  Site[Site] --> Core-Site[Core]\n  click Site "A.mmd"\n  click Core-Site "nerdgram:B.mmd"\n';
    expect(clickTargetFromNode(source, node)).toBe("nerdgram:B.mmd");
  });
});

describe("link API", () => {
  let cleanup = async () => {};
  const app = makeApp();

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  async function writeNew(filePath: string, content: string) {
    const res = await request(app).put("/api/file").set(json).send({ path: filePath, content });
    expect(res.status).toBe(200);
  }

  it("reports backlinks and refuses a rename until the caller confirms the update", async () => {
    await writeNew("WAN.mmd", overview);
    await writeNew("Sites/Atlanta.mmd", detail);

    const links = await request(app).get("/api/diagram-links").query({ path: "Sites/Atlanta.mmd" }).set("Host", HOST);
    expect(links.status).toBe(200);
    expect(links.body.linkedFrom.map((item: { path: string }) => item.path)).toEqual(["WAN.mmd"]);
    expect(links.body.linksTo.map((item: { path: string }) => item.path)).toEqual(["WAN.mmd"]);

    const refused = await request(app)
      .patch("/api/rename")
      .set(json)
      .send({ from: "Sites/Atlanta.mmd", to: "Sites/Atlanta-Core.mmd" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("links");
    expect(refused.body.files).toEqual(["WAN.mmd"]);
    expect(await request(app).get("/api/file").query({ path: "Sites/Atlanta.mmd" }).set("Host", HOST)).toMatchObject({
      status: 200,
    });

    const renamed = await request(app)
      .patch("/api/rename")
      .set(json)
      .send({ from: "Sites/Atlanta.mmd", to: "Sites/Atlanta-Core.mmd", updateLinks: true });
    expect(renamed.status).toBe(200);
    expect(renamed.body.path).toBe("Sites/Atlanta-Core.mmd");
    expect(renamed.body.updated).toContain("WAN.mmd");
    const updated = await request(app).get("/api/file").query({ path: "WAN.mmd" }).set("Host", HOST);
    expect(updated.body.content).toContain("nerdgram:Sites/Atlanta-Core.mmd");
  });

  it("updates links when a folder moves and warns before deleting a linked diagram", async () => {
    await writeNew("WAN.mmd", overview);
    await writeNew("Sites/Atlanta.mmd", detail);

    const moved = await request(app)
      .post("/api/move")
      .set(json)
      .send({ from: "Sites", toFolder: "Regions", updateLinks: true });
    expect(moved.status).toBe(200);
    expect(moved.body.path).toBe("Regions/Sites");
    const wan = await request(app).get("/api/file").query({ path: "WAN.mmd" }).set("Host", HOST);
    expect(wan.body.content).toContain("nerdgram:Regions/Sites/Atlanta.mmd");
    const atlanta = await request(app)
      .get("/api/file")
      .query({ path: "Regions/Sites/Atlanta.mmd" })
      .set("Host", HOST);
    expect(atlanta.body.content).toContain('click Edge "../../WAN.mmd"');

    const blocked = await request(app).delete("/api/item").query({ path: "Regions/Sites/Atlanta.mmd" }).set(json);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("linked");
    expect(blocked.body.files).toEqual(["WAN.mmd"]);

    const removed = await request(app)
      .delete("/api/item")
      .query({ path: "Regions/Sites/Atlanta.mmd", confirmLinks: "1" })
      .set(json);
    expect(removed.status).toBe(204);
    const after = await request(app).get("/api/file").query({ path: "Regions/Sites/Atlanta.mmd" }).set("Host", HOST);
    expect(after.status).toBe(404);
  });
});
