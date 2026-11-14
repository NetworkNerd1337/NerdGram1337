import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { relocatedCompanionPath, rewriteSourcePrefix } from "../src/diagramCompanions.js";
import { readDataSource, replaceDataSourcePaths } from "../src/diagramData.js";
import { listUserFiles } from "../src/sync/layout.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = { Host: HOST, "Content-Type": "application/json" };
const csv = "Local Device,Local Port,Remote Device,Remote Port\nCore,Gi0/0,Edge,Gi0/1\n";
const edges = "source,target,label\ncore,edge,uplink\n";
const nodes = "id,label\ncore,Core\nedge,Edge\n";
const lldp = `core-sw#show lldp neighbors detail
Local Intf: Gi1/0/1
Chassis id: 0011.2233.4455
Port id: Gi1/0/2
System Name: dist-sw
System Description: Cisco IOS Software
`;
const cdp = `core-sw#show cdp neighbors detail
-------------------------
Device ID: dist-sw
Platform: cisco C9300-48P, Capabilities: Switch
Interface: Gi1/0/1, Port ID (outgoing port): Gi1/0/2
`;

function makeApp() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

describe("companion path planning", () => {
  it("follows the diagram stem and stays beside it", () => {
    expect(relocatedCompanionPath("Sites/Campus.mmd", "Regions/Core.mmd", "Sites/Campus.csv")).toBe(
      "Regions/Core.csv",
    );
    expect(relocatedCompanionPath("Sites/Campus.mmd", "Regions/Core.mmd", "Sites/Campus.edges.csv")).toBe(
      "Regions/Core.edges.csv",
    );
    expect(relocatedCompanionPath("Sites/Campus.mmd", "Regions/Core.mmd", "Sites/Campus.lldp")).toBe(
      "Regions/Core.lldp",
    );
    expect(relocatedCompanionPath("Sites/Campus.mmd", "Regions/Campus.mmd", "Sites/inventory.csv")).toBe(
      "Regions/inventory.csv",
    );
    expect(relocatedCompanionPath("Sites/Campus.mmd", "Regions/Core.mmd", "Shared/Campus.csv")).toBeNull();
    expect(relocatedCompanionPath("Campus.mmd", "Core.mmd", "Campuses.csv")).toBe("Campuses.csv");
  });

  it("rewrites only source paths that lived inside a moved folder", () => {
    const source = [
      "---",
      "nerdgram:",
      "  source:",
      "    file: Sites/Campus.csv",
      "    format: csv",
      "    shape: links",
      "    mapping:",
      "      localDevice: Local Device",
      "      localPort: Local Port",
      "      remoteDevice: Remote Device",
      "      remotePort: Remote Port",
      "    direction: LR",
      "    grouping: true",
      "    diagramType: flowchart",
      "---",
      "flowchart LR",
      "",
    ].join("\n");
    const moved = rewriteSourcePrefix(source, "Sites", "Regions/Sites");
    expect(readDataSource(moved)?.file).toBe("Regions/Sites/Campus.csv");
    expect(rewriteSourcePrefix(source, "Other", "Archive")).toBe(source);
  });

  it("keeps the rest of the front matter when the data path changes", () => {
    const source = [
      "---",
      "title: Campus",
      "config:",
      "  theme: forest",
      "nerdgram:",
      "  notes: Keep me",
      "  source:",
      "    file: Sites/Campus.csv",
      "    format: csv",
      "    shape: links",
      "    mapping:",
      "      localDevice: Local Device",
      "    direction: TD",
      "    grouping: false",
      "    diagramType: flowchart",
      "    edgesFile: Sites/Campus.edges.csv",
      "    edgesFormat: csv",
      "---",
      "flowchart TD",
      "  A-->B",
      "",
    ].join("\n");
    const next = replaceDataSourcePaths(source, {
      file: "Regions/Core.csv",
      edgesFile: "Regions/Core.edges.csv",
    });
    expect(next).toContain("title: Campus");
    expect(next).toContain("theme: forest");
    expect(next).toContain("notes: Keep me");
    expect(next).toContain("A-->B");
    expect(readDataSource(next)?.file).toBe("Regions/Core.csv");
    expect(readDataSource(next)?.edgesFile).toBe("Regions/Core.edges.csv");
    expect(readDataSource(next)?.grouping).toBe(false);
  });
});

describe("data files follow the diagram", () => {
  let dir = "";
  let cleanup = async () => {};
  const app = makeApp();

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  async function generate(diagramPath: string, body: Record<string, unknown> = {}) {
    const created = await request(app)
      .post("/api/generate")
      .set(json)
      .send({ path: diagramPath, text: csv, title: "Campus", ...body });
    expect(created.status).toBe(201);
    return created.body as { path: string; dataPath: string; edgesPath: string };
  }

  it("moves a sibling CSV with the diagram and refresh still reads it", async () => {
    const created = await generate("Sites/Campus.mmd");
    expect(created.dataPath).toBe("Sites/Campus.csv");
    const before = await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8");

    const moved = await request(app).post("/api/move").set(json).send({ from: "Sites/Campus.mmd", toFolder: "Regions" });
    expect(moved.status).toBe(200);
    expect(moved.body.path).toBe("Regions/Campus.mmd");
    expect(moved.body.dataFiles).toEqual([{ from: "Sites/Campus.csv", to: "Regions/Campus.csv" }]);
    await expect(fs.access(path.join(dir, "Sites", "Campus.csv"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "Regions", "Campus.csv"), "utf8")).toBe(before);

    const diagram = await fs.readFile(path.join(dir, "Regions", "Campus.mmd"), "utf8");
    expect(readDataSource(diagram)?.file).toBe("Regions/Campus.csv");
    const refreshed = await request(app).post("/api/generate/refresh").set(json).send({ path: "Regions/Campus.mmd" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.dataPath).toBe("Regions/Campus.csv");
    expect(refreshed.body.counts.nodes).toBeGreaterThan(0);

    const synced = await listUserFiles(dir);
    expect(synced.has("Regions/Campus.mmd")).toBe(true);
    expect(synced.has("Regions/Campus.csv")).toBe(true);
    expect(synced.has("Sites/Campus.csv")).toBe(false);
  });

  it("renames the data file when the diagram stem changes, including CDP and LLDP", async () => {
    await generate("Campus.mmd", { text: lldp, format: "lldp" });
    const renamed = await request(app).patch("/api/rename").set(json).send({ from: "Campus.mmd", to: "Core.mmd" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.dataFiles).toEqual([{ from: "Campus.lldp", to: "Core.lldp" }]);
    expect(readDataSource(await fs.readFile(path.join(dir, "Core.mmd"), "utf8"))?.file).toBe("Core.lldp");
    const refreshed = await request(app).post("/api/generate/refresh").set(json).send({ path: "Core.mmd" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.dataPath).toBe("Core.lldp");

    await generate("Neighbors.mmd", { text: cdp, format: "cdp" });
    const movedCdp = await request(app)
      .patch("/api/rename")
      .set(json)
      .send({ from: "Neighbors.mmd", to: "Network/Neighbors.mmd" });
    expect(movedCdp.status).toBe(200);
    expect(movedCdp.body.dataFiles).toEqual([{ from: "Neighbors.cdp", to: "Network/Neighbors.cdp" }]);
    expect(await fs.readFile(path.join(dir, "Network", "Neighbors.cdp"), "utf8")).toContain("dist-sw");
  });

  it("moves an edges file and updates both source paths when a folder moves", async () => {
    await generate("Sites/Campus.mmd", { text: nodes, edgesText: edges, shape: "nodes" });
    const moved = await request(app).post("/api/move").set(json).send({ from: "Sites", toFolder: "Regions" });
    expect(moved.status).toBe(200);
    expect(moved.body.dataFiles).toEqual([
      { from: "Sites/Campus.csv", to: "Regions/Sites/Campus.csv" },
      { from: "Sites/Campus.edges.csv", to: "Regions/Sites/Campus.edges.csv" },
    ]);
    const source = readDataSource(await fs.readFile(path.join(dir, "Regions", "Sites", "Campus.mmd"), "utf8"));
    expect(source?.file).toBe("Regions/Sites/Campus.csv");
    expect(source?.edgesFile).toBe("Regions/Sites/Campus.edges.csv");
    const refreshed = await request(app)
      .post("/api/generate/refresh")
      .set(json)
      .send({ path: "Regions/Sites/Campus.mmd" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.dataPath).toBe("Regions/Sites/Campus.csv");
  });

  it("leaves a data file that is not beside the diagram where it is", async () => {
    await fs.mkdir(path.join(dir, "Shared"), { recursive: true });
    await fs.writeFile(path.join(dir, "Shared", "campus.csv"), csv);
    const created = await request(app).post("/api/generate").set(json).send({
      path: "Sites/Campus.mmd",
      text: csv,
      storeData: false,
      sourceFile: "Shared/campus.csv",
    });
    expect(created.status).toBe(201);
    const moved = await request(app).post("/api/move").set(json).send({ from: "Sites/Campus.mmd", toFolder: "Regions" });
    expect(moved.status).toBe(200);
    expect(moved.body.dataFiles).toEqual([]);
    expect(await fs.readFile(path.join(dir, "Shared", "campus.csv"), "utf8")).toBe(csv);
    expect(readDataSource(await fs.readFile(path.join(dir, "Regions", "Campus.mmd"), "utf8"))?.file).toBe(
      "Shared/campus.csv",
    );
    const refreshed = await request(app).post("/api/generate/refresh").set(json).send({ path: "Regions/Campus.mmd" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.dataPath).toBe("Shared/campus.csv");
  });

  it("copies a shared data file when the diagram moves so the original bytes stay", async () => {
    await generate("Campus.mmd");
    const shared = await request(app).post("/api/duplicate").set(json).send({ path: "Campus.mmd", copyData: false });
    expect(shared.status).toBe(201);
    const original = await fs.readFile(path.join(dir, "Campus.csv"), "utf8");
    const moved = await request(app).post("/api/move").set(json).send({ from: "Campus.mmd", toFolder: "Archive" });
    expect(moved.status).toBe(200);
    expect(moved.body.dataFiles).toEqual([{ from: "Campus.csv", to: "Archive/Campus.csv" }]);
    expect(await fs.readFile(path.join(dir, "Campus.csv"), "utf8")).toBe(original);
    expect(readDataSource(await fs.readFile(path.join(dir, "Campus (copy).mmd"), "utf8"))?.file).toBe("Campus.csv");
    expect(readDataSource(await fs.readFile(path.join(dir, "Archive", "Campus.mmd"), "utf8"))?.file).toBe(
      "Archive/Campus.csv",
    );
  });

  it("asks before duplicating, then copies or shares without changing the original", async () => {
    await generate("Sites/Campus.mmd");
    const originalDiagram = await fs.readFile(path.join(dir, "Sites", "Campus.mmd"), "utf8");
    const originalData = await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8");

    const asked = await request(app).post("/api/duplicate").set(json).send({ path: "Sites/Campus.mmd" });
    expect(asked.status).toBe(409);
    expect(asked.body.code).toBe("data");
    expect(asked.body.files).toEqual(["Sites/Campus.csv"]);
    expect(await fs.readFile(path.join(dir, "Sites", "Campus.mmd"), "utf8")).toBe(originalDiagram);

    const copied = await request(app)
      .post("/api/duplicate")
      .set(json)
      .send({ path: "Sites/Campus.mmd", copyData: true });
    expect(copied.status).toBe(201);
    expect(copied.body.dataFiles).toEqual([{ from: "Sites/Campus.csv", to: "Sites/Campus (copy).csv" }]);
    expect(await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8")).toBe(originalData);
    expect(await fs.readFile(path.join(dir, "Sites", "Campus.mmd"), "utf8")).toBe(originalDiagram);
    const copy = await fs.readFile(path.join(dir, "Sites", "Campus (copy).mmd"), "utf8");
    expect(readDataSource(copy)?.file).toBe("Sites/Campus (copy).csv");
    expect(await fs.readFile(path.join(dir, "Sites", "Campus (copy).csv"), "utf8")).toBe(originalData);
    const copyRefresh = await request(app)
      .post("/api/generate/refresh")
      .set(json)
      .send({ path: "Sites/Campus (copy).mmd" });
    expect(copyRefresh.status).toBe(200);
    expect(copyRefresh.body.dataPath).toBe("Sites/Campus (copy).csv");

    const sharing = await request(app)
      .post("/api/duplicate")
      .set(json)
      .send({ path: "Sites/Campus.mmd", copyData: false });
    expect(sharing.status).toBe(201);
    expect(sharing.body.path).toBe("Sites/Campus (copy 2).mmd");
    expect(sharing.body.dataFiles).toEqual([]);
    expect(readDataSource(await fs.readFile(path.join(dir, "Sites", "Campus (copy 2).mmd"), "utf8"))?.file).toBe(
      "Sites/Campus.csv",
    );
    expect(await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8")).toBe(originalData);
    expect(await fs.readFile(path.join(dir, "Sites", "Campus.mmd"), "utf8")).toBe(originalDiagram);
    await expect(fs.access(path.join(dir, "Sites", "Campus (copy 2).csv"))).rejects.toThrow();
  });

  it("copies data files with a duplicated folder and can share them instead", async () => {
    await generate("Lab/Campus.mmd");
    const asked = await request(app).post("/api/duplicate").set(json).send({ path: "Lab" });
    expect(asked.status).toBe(409);
    expect(asked.body.files).toEqual(["Lab/Campus.csv"]);

    const copied = await request(app).post("/api/duplicate").set(json).send({ path: "Lab", copyData: true });
    expect(copied.status).toBe(201);
    expect(copied.body.dataFiles).toEqual([{ from: "Lab/Campus.csv", to: "Lab (copy)/Campus.csv" }]);
    expect(readDataSource(await fs.readFile(path.join(dir, "Lab (copy)", "Campus.mmd"), "utf8"))?.file).toBe(
      "Lab (copy)/Campus.csv",
    );
    const shared = await request(app).post("/api/duplicate").set(json).send({ path: "Lab", copyData: false });
    expect(shared.status).toBe(201);
    expect(readDataSource(await fs.readFile(path.join(dir, "Lab (copy 2)", "Campus.mmd"), "utf8"))?.file).toBe(
      "Lab/Campus.csv",
    );
    await expect(fs.access(path.join(dir, "Lab (copy 2)", "Campus.csv"))).rejects.toThrow();
  });

  it("asks before delete, trashes the data file with the diagram, and restores both", async () => {
    await generate("Sites/Campus.mmd");
    const asked = await request(app).delete("/api/item").set(json).query({ path: "Sites/Campus.mmd" });
    expect(asked.status).toBe(409);
    expect(asked.body.code).toBe("data");
    expect(asked.body.files).toEqual(["Sites/Campus.csv"]);
    expect(await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8")).toContain("Core");

    const trashed = await request(app)
      .delete("/api/item")
      .set(json)
      .query({ path: "Sites/Campus.mmd", deleteData: "1" });
    expect(trashed.status).toBe(204);
    await expect(fs.access(path.join(dir, "Sites", "Campus.mmd"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "Sites", "Campus.csv"))).rejects.toThrow();

    const trash = await request(app).get("/api/trash").set("Host", HOST);
    expect(trash.body.items).toHaveLength(1);
    const restored = await request(app)
      .post("/api/trash/restore")
      .set(json)
      .send({ id: trash.body.items[0].id });
    expect(restored.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8")).toContain("Core");
    const refreshed = await request(app).post("/api/generate/refresh").set(json).send({ path: "Sites/Campus.mmd" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.dataPath).toBe("Sites/Campus.csv");
  });

  it("can keep the data file when the diagram is trashed", async () => {
    await generate("Sites/Campus.mmd");
    const kept = await request(app)
      .delete("/api/item")
      .set(json)
      .query({ path: "Sites/Campus.mmd", deleteData: "0" });
    expect(kept.status).toBe(204);
    await expect(fs.access(path.join(dir, "Sites", "Campus.mmd"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8")).toContain("Core");
  });

  it("keeps folder data in place when deleteData is false and takes it along when true", async () => {
    await generate("Lab/Campus.mmd");
    const kept = await request(app).delete("/api/item").set(json).query({ path: "Lab", deleteData: "0" });
    expect(kept.status).toBe(204);
    expect(await fs.readFile(path.join(dir, "Lab", "Campus.csv"), "utf8")).toContain("Core");
    await expect(fs.access(path.join(dir, "Lab", "Campus.mmd"))).rejects.toThrow();

    await generate("Lab/Other.mmd");
    const trashed = await request(app).delete("/api/item").set(json).query({ path: "Lab", deleteData: "1" });
    expect(trashed.status).toBe(204);
    await expect(fs.access(path.join(dir, "Lab", "Campus.csv"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "Lab", "Other.csv"))).rejects.toThrow();
  });

  it("updates nerdgram.source during link repair when the data file moved outside the app", async () => {
    await generate("Sites/Campus.mmd");
    await request(app)
      .put("/api/file")
      .set(json)
      .send({
        path: "WAN.mmd",
        content: 'flowchart LR\n  Campus[Campus]\n  click Campus "nerdgram:Sites/Campus.mmd"\n',
      });
    await fs.mkdir(path.join(dir, "Regions"));
    await fs.rename(path.join(dir, "Sites", "Campus.mmd"), path.join(dir, "Regions", "Campus.mmd"));
    await fs.rename(path.join(dir, "Sites", "Campus.csv"), path.join(dir, "Regions", "Campus.csv"));

    const preview = await request(app).get("/api/link-repairs").set("Host", HOST);
    expect(preview.status).toBe(200);
    expect(preview.body.dataFiles).toEqual([
      { diagram: "Regions/Campus.mmd", from: "Sites/Campus.csv", to: "Regions/Campus.csv" },
    ]);
    expect(readDataSource(await fs.readFile(path.join(dir, "Regions", "Campus.mmd"), "utf8"))?.file).toBe(
      "Sites/Campus.csv",
    );

    const applied = await request(app)
      .post("/api/link-repairs")
      .set(json)
      .send({ dryRun: false, confirm: true });
    expect(applied.status).toBe(200);
    expect(applied.body.applied).toBe(true);
    expect(applied.body.saved).toContain("Regions/Campus.mmd");
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Regions/Campus.mmd");
    expect(readDataSource(await fs.readFile(path.join(dir, "Regions", "Campus.mmd"), "utf8"))?.file).toBe(
      "Regions/Campus.csv",
    );
    const refreshed = await request(app).post("/api/generate/refresh").set(json).send({ path: "Regions/Campus.mmd" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.dataPath).toBe("Regions/Campus.csv");
  });
});
