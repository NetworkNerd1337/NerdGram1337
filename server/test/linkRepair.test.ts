import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { main } from "../src/cli.js";
import { planRepairRewrites } from "../src/diagramLinks.js";
import { matchExternalRenames, withoutSightingNotes } from "../src/diagramSightings.js";
import { listRevisions, readRevision } from "../src/history.js";
import * as store from "../src/fsStore.js";
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

const detail = "flowchart TB\n  Edge[Edge] --> Rack[Rack]\n";

describe("external rename matching", () => {
  it("prefers one content hash and leaves two equal names unresolved", () => {
    const previous = [{ path: "Sites/Atlanta.mmd", hash: "hash-a" }];
    const renamed = matchExternalRenames(previous, [{ path: "Sites/Atlanta-Core.mmd", hash: "hash-a" }]);
    expect(renamed).toEqual([
      expect.objectContaining({
        from: "Sites/Atlanta.mmd",
        to: "Sites/Atlanta-Core.mmd",
        match: "content",
      }),
    ]);

    const moved = matchExternalRenames(previous, [
      { path: "WAN.mmd", hash: "other" },
      { path: "Network/Atlanta.mmd", hash: "hash-a" },
    ]);
    expect(moved.map((item) => item.to)).toEqual(["Network/Atlanta.mmd"]);

    const byName = matchExternalRenames(previous, [{ path: "Network/Atlanta.mmd", hash: "edited" }]);
    expect(byName).toEqual([
      expect.objectContaining({ from: "Sites/Atlanta.mmd", to: "Network/Atlanta.mmd", match: "basename" }),
    ]);

    const ambiguous = matchExternalRenames(previous, [
      { path: "East/Atlanta.mmd", hash: "hash-a" },
      { path: "West/Atlanta.mmd", hash: "hash-a" },
    ]);
    expect(ambiguous).toEqual([
      expect.objectContaining({
        from: "Sites/Atlanta.mmd",
        to: null,
        match: "ambiguous",
        candidates: ["East/Atlanta.mmd", "West/Atlanta.mmd"],
      }),
    ]);

    const oneReplacement = matchExternalRenames(
      [
        { path: "A.mmd", hash: "same" },
        { path: "B.mmd", hash: "same" },
      ],
      [{ path: "C.mmd", hash: "same" }],
    );
    expect(oneReplacement.map((item) => item.to)).toEqual([null, null]);
  });

  it("rewrites every click that still points at the old path and skips an ambiguous move", () => {
    const files = [
      {
        path: "WAN.mmd",
        content: 'flowchart LR\n  Atlanta[Atlanta]\n  click Atlanta "nerdgram:Sites/Atlanta.mmd" "Open"\n',
      },
      {
        path: "Overview/Map.mmd",
        content: 'flowchart LR\n  Site[Site]\n  click Site "../Sites/Atlanta.mmd"\n  click Site "https://example.com"\n',
      },
    ];
    const rewrites = planRepairRewrites(files, [{ from: "Sites/Atlanta.mmd", to: "Sites/Atlanta-Core.mmd" }]);
    expect(rewrites.map((item) => item.path)).toEqual(["Overview/Map.mmd", "WAN.mmd"]);
    expect(rewrites.find((item) => item.path === "WAN.mmd")?.content).toContain(
      'click Atlanta "nerdgram:Sites/Atlanta-Core.mmd" "Open"',
    );
    expect(rewrites.find((item) => item.path === "Overview/Map.mmd")?.content).toContain('"../Sites/Atlanta-Core.mmd"');
    expect(rewrites.find((item) => item.path === "Overview/Map.mmd")?.content).toContain("https://example.com");
    expect(planRepairRewrites(files, [])).toEqual([]);
  });
});

describe("link repair API", () => {
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

  async function seedPair(target = "Sites/Atlanta.mmd"): Promise<void> {
    await store.writeFile(target, detail);
    await store.writeFile(
      "WAN.mmd",
      `flowchart LR\n  Atlanta[Atlanta]\n  click Atlanta "nerdgram:${target}" "Open"\n`,
    );
    await store.writeFile(
      "Overview/Map.mmd",
      'flowchart LR\n  Site[Site]\n  click Site "../Sites/Atlanta.mmd"\n',
    );
  }

  it("rejects a foreign host, a foreign origin, and a non-JSON body", async () => {
    const app = makeApp();
    expect((await request(app).get("/api/link-repairs").set("Host", "evil.example")).status).toBe(403);
    const origin = await request(app)
      .post("/api/link-repairs")
      .set("Host", HOST)
      .set("Origin", "https://evil.example")
      .set("Content-Type", "application/json")
      .send({ dryRun: false, confirm: true });
    expect(origin.status).toBe(403);
    const text = await request(app)
      .post("/api/link-repairs")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("{}");
    expect(text.status).toBe(415);
  });

  it("suggests a renamed file and writes every affected link only after confirmation", async () => {
    await seedPair();
    await fs.rename(path.join(dir, "Sites", "Atlanta.mmd"), path.join(dir, "Sites", "Atlanta-Core.mmd"));
    const app = makeApp();

    const preview = await request(app).get("/api/link-repairs").set("Host", HOST);
    expect(preview.status).toBe(200);
    expect(preview.body.applied).toBe(false);
    expect(preview.body.suggestions).toEqual([
      expect.objectContaining({
        from: "Sites/Atlanta.mmd",
        to: "Sites/Atlanta-Core.mmd",
        match: "content",
      }),
    ]);
    expect(preview.body.changes.map((change: { path: string }) => change.path)).toEqual([
      "Overview/Map.mmd",
      "WAN.mmd",
    ]);
    const before = await fs.readFile(path.join(dir, "WAN.mmd"), "utf8");
    expect(before).toContain("nerdgram:Sites/Atlanta.mmd");

    const dry = await request(app).post("/api/link-repairs").set(json).send({});
    expect(dry.status).toBe(200);
    expect(dry.body.applied).toBe(false);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toBe(before);

    const confirmedDry = await request(app)
      .post("/api/link-repairs")
      .set(json)
      .send({ dryRun: true, confirm: true, choices: [{ from: "Sites/Atlanta.mmd", to: "Sites/Atlanta-Core.mmd" }] });
    expect(confirmedDry.body.applied).toBe(false);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toBe(before);

    const applied = await request(app)
      .post("/api/link-repairs")
      .set(json)
      .send({
        dryRun: false,
        confirm: true,
        choices: [{ from: "Sites/Atlanta.mmd", to: "Sites/Atlanta-Core.mmd" }],
      });
    expect(applied.status).toBe(200);
    expect(applied.body.applied).toBe(true);
    expect(applied.body.saved).toEqual(["Overview/Map.mmd", "WAN.mmd"]);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain(
      'click Atlanta "nerdgram:Sites/Atlanta-Core.mmd" "Open"',
    );
    expect(await fs.readFile(path.join(dir, "Overview", "Map.mmd"), "utf8")).toContain('"../Sites/Atlanta-Core.mmd"');

    const revisions = await listRevisions("WAN.mmd");
    expect(revisions).toHaveLength(1);
    const previous = revisions[0];
    expect(previous).toBeTruthy();
    if (!previous) return;
    expect((await readRevision("WAN.mmd", previous.id)).content).toContain("nerdgram:Sites/Atlanta.mmd");

    const again = await request(app).get("/api/link-repairs").set("Host", HOST);
    expect(again.body.suggestions).toEqual([]);
    expect(again.body.changes).toEqual([]);
  });

  it("suggests a file moved into a subfolder", async () => {
    await store.writeFile("Atlanta.mmd", detail);
    await store.writeFile(
      "WAN.mmd",
      'flowchart LR\n  Atlanta[Atlanta]\n  click Atlanta "nerdgram:Atlanta.mmd"\n',
    );
    await fs.mkdir(path.join(dir, "Network"));
    await fs.rename(path.join(dir, "Atlanta.mmd"), path.join(dir, "Network", "Atlanta.mmd"));
    const app = makeApp();

    const preview = await request(app).get("/api/link-repairs").set("Host", HOST);
    expect(preview.body.suggestions).toEqual([
      expect.objectContaining({ from: "Atlanta.mmd", to: "Network/Atlanta.mmd", match: "content" }),
    ]);
    const applied = await request(app)
      .post("/api/link-repairs")
      .set(json)
      .send({ dryRun: false, confirm: true, choices: [{ from: "Atlanta.mmd", to: "Network/Atlanta.mmd" }] });
    expect(applied.body.saved).toEqual(["WAN.mmd"]);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Network/Atlanta.mmd");
  });

  it("does not pick either file when two copies match", async () => {
    await store.writeFile("Atlanta.mmd", detail);
    await store.writeFile(
      "WAN.mmd",
      'flowchart LR\n  Atlanta[Atlanta]\n  click Atlanta "nerdgram:Atlanta.mmd"\n',
    );
    await fs.mkdir(path.join(dir, "East"));
    await fs.mkdir(path.join(dir, "West"));
    await fs.copyFile(path.join(dir, "Atlanta.mmd"), path.join(dir, "East", "Atlanta.mmd"));
    await fs.copyFile(path.join(dir, "Atlanta.mmd"), path.join(dir, "West", "Atlanta.mmd"));
    await fs.rm(path.join(dir, "Atlanta.mmd"));
    const app = makeApp();

    const preview = await request(app).get("/api/link-repairs").set("Host", HOST);
    expect(preview.body.applied).toBe(false);
    expect(preview.body.changes).toEqual([]);
    expect(preview.body.suggestions).toEqual([
      expect.objectContaining({
        from: "Atlanta.mmd",
        to: null,
        match: "ambiguous",
        candidates: ["East/Atlanta.mmd", "West/Atlanta.mmd"],
      }),
    ]);

    const applied = await request(app).post("/api/link-repairs").set(json).send({ dryRun: false, confirm: true });
    expect(applied.status).toBe(200);
    expect(applied.body.saved).toEqual([]);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Atlanta.mmd");

    const forced = await request(app)
      .post("/api/link-repairs")
      .set(json)
      .send({ dryRun: false, confirm: true, choices: [{ from: "Atlanta.mmd", to: "East/Atlanta.mmd" }] });
    expect(forced.status).toBe(409);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Atlanta.mmd");
  });

  it("does not give one new file to two missing diagrams with the same content", async () => {
    await store.writeFile("A.mmd", detail);
    await store.writeFile("B.mmd", detail);
    await store.writeFile("WAN.mmd", 'flowchart LR\n  A[A]\n  click A "nerdgram:A.mmd"\n');
    await fs.rm(path.join(dir, "A.mmd"));
    await fs.rm(path.join(dir, "B.mmd"));
    await fs.writeFile(path.join(dir, "C.mmd"), detail);
    const app = makeApp();
    const preview = await request(app).get("/api/link-repairs").set("Host", HOST);
    expect(preview.body.changes).toEqual([]);
    expect(preview.body.suggestions).toEqual([
      expect.objectContaining({ from: "A.mmd", to: null, match: "ambiguous", candidates: ["C.mmd"] }),
    ]);
    const applied = await request(app).post("/api/link-repairs").set(json).send({ dryRun: false, confirm: true });
    expect(applied.body.saved).toEqual([]);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:A.mmd");
  });

  it("does not pair a file that disappeared earlier with one created later", async () => {
    await store.writeFile("Atlanta.mmd", detail);
    await store.writeFile(
      "WAN.mmd",
      'flowchart LR\n  Atlanta[Atlanta]\n  click Atlanta "nerdgram:Atlanta.mmd"\n',
    );
    await fs.rm(path.join(dir, "Atlanta.mmd"));
    const app = makeApp();
    const gone = await request(app).get("/api/link-repairs").set("Host", HOST);
    expect(gone.body.suggestions).toEqual([]);

    await fs.mkdir(path.join(dir, "Network"));
    await fs.writeFile(path.join(dir, "Network", "Atlanta.mmd"), detail);
    const later = await request(app).get("/api/link-repairs").set("Host", HOST);
    expect(later.body.suggestions).toEqual([]);
    expect(later.body.changes).toEqual([]);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Atlanta.mmd");
  });

  it("does not suggest a repair after an in-app rename, and does after a suppressed tree change", async () => {
    await seedPair();
    await store.renameItem("Sites/Atlanta.mmd", "Sites/City.mmd", { updateLinks: true });
    const quiet = await store.repairDiagramLinks({ dryRun: true, confirm: false });
    expect(quiet.suggestions).toEqual([]);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Sites/City.mmd");

    await withoutSightingNotes(async () => {
      await fs.mkdir(path.join(dir, "Regions"));
      await fs.rename(path.join(dir, "Sites", "City.mmd"), path.join(dir, "Regions", "City.mmd"));
    });
    const noticed = await store.repairDiagramLinks({ dryRun: true, confirm: false });
    expect(noticed.suggestions).toEqual([
      expect.objectContaining({ from: "Sites/City.mmd", to: "Regions/City.mmd", match: "content" }),
    ]);
    expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Sites/City.mmd");
  });

  it("previews through a read token and applies through the CLI only with --apply", async () => {
    await store.writeFile("Atlanta.mmd", detail);
    await store.writeFile(
      "WAN.mmd",
      'flowchart LR\n  Atlanta[Atlanta]\n  click Atlanta "nerdgram:Atlanta.mmd"\n',
    );
    await fs.rename(path.join(dir, "Atlanta.mmd"), path.join(dir, "Atlanta-Core.mmd"));
    const app = makeApp();
    const read = await request(app)
      .post("/api/tokens")
      .set(json)
      .send({ name: "read", scope: "read" });
    const write = await request(app)
      .post("/api/tokens")
      .set(json)
      .send({ name: "write", scope: "read-write" });
    expect(read.status).toBe(201);
    expect(write.status).toBe(201);

    const preview = await request(app)
      .get("/api/v1/link-repairs")
      .set("Host", HOST)
      .set("Authorization", `Bearer ${read.body.token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.suggestions[0].to).toBe("Atlanta-Core.mmd");
    const denied = await request(app)
      .post("/api/v1/link-repairs")
      .set(json)
      .set("Authorization", `Bearer ${read.body.token}`)
      .send({ dryRun: false, confirm: true });
    expect(denied.status).toBe(403);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: (chunk: string) => stdout.push(chunk),
      stderr: (chunk: string) => stderr.push(chunk),
      env: { NERDGRAM_URL: `http://127.0.0.1:${address.port}`, NERDGRAM_TOKEN: write.body.token as string },
    };
    try {
      stdout.length = 0;
      expect(await main(["repair-links", "--dry-run", "--json"], io)).toBe(0);
      const dry = JSON.parse(stdout.join("")) as { ok: boolean; applied: boolean; suggestions: { to: string }[] };
      expect(dry.ok).toBe(true);
      expect(dry.applied).toBe(false);
      expect(dry.suggestions[0]?.to).toBe("Atlanta-Core.mmd");
      expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Atlanta.mmd");

      stdout.length = 0;
      expect(await main(["repair-links", "--json"], io)).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({ applied: false });
      expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Atlanta.mmd");

      stdout.length = 0;
      expect(await main(["repair-links", "--apply", "--json"], io)).toBe(0);
      const applied = JSON.parse(stdout.join("")) as { applied: boolean; saved: string[] };
      expect(applied.applied).toBe(true);
      expect(applied.saved).toEqual(["WAN.mmd"]);
      expect(await fs.readFile(path.join(dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Atlanta-Core.mmd");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
