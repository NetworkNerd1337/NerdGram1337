import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { discardSearchCache, MAX_SEARCH_RESULTS } from "../src/search.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = {
  Host: HOST,
  "Content-Type": "application/json",
};

const NETWORK = `flowchart LR
  Internet --> Firewall
  Firewall --> Core
  Core --> Access
`;

const WELCOME = `flowchart LR
  subgraph NerdGram1337
    Paste[Paste Mermaid] --> Render[Live Preview]
    Render --> Export[Export SVG PNG JPG]
  end
  Disk[(Local diagrams folder)] <--> Paste
`;

const SEQUENCE = `sequenceDiagram
  participant User
  participant NerdGram1337
  participant Mermaid.js
  participant Disk

  User->>NerdGram1337: Paste Mermaid markdown
  NerdGram1337->>Mermaid.js: Render diagram
  Mermaid.js-->>NerdGram1337: SVG preview
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

type Hit = {
  path: string;
  rank: number;
  field: string;
  element: string | null;
  label: string;
  line: number | null;
  snippet: string;
  matchStart: number;
  matchLength: number;
};

describe("diagram search", () => {
  let dir = "";
  let cleanup = async () => {};
  const app = makeApp();

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    discardSearchCache();
  });

  afterEach(async () => {
    discardSearchCache();
    await cleanup();
  });

  async function writeNew(filePath: string, content: string) {
    const res = await request(app).put("/api/file").set(json).send({ path: filePath, content });
    expect(res.status).toBe(200);
    return res.body as { path: string; mtimeMs: number; hash: string };
  }

  async function search(q: string, extra?: Record<string, string>) {
    const res = await request(app).get("/api/search").query({ q, ...extra }).set("Host", HOST);
    return res;
  }

  function hitPaths(body: { hits: Hit[] }): string[] {
    return body.hits.map((hit) => hit.path);
  }

  it("finds node labels, edge labels, and sequence messages, and skips diagram keywords", async () => {
    await writeNew("NetworkMap.mmd", NETWORK);
    await writeNew("Welcome.mmd", WELCOME);
    await writeNew("Examples/Sequence.mmd", SEQUENCE);
    await writeNew("HiddenId.mmd", "flowchart TD\n  Qx[StartLabel] --> Zy[EndLabel]\n");
    await writeNew("Link.mmd", "flowchart LR\n  Client -->|HTTPS| Edge\n");

    const firewall = await search("Firewall");
    expect(firewall.status).toBe(200);
    expect(hitPaths(firewall.body)).toEqual(["NetworkMap.mmd"]);
    expect(firewall.body.hits[0]).toMatchObject({
      field: "text",
      element: "node",
      label: "Node label",
      line: 2,
    });
    expect(firewall.body.hits[0].snippet.slice(
      firewall.body.hits[0].matchStart,
      firewall.body.hits[0].matchStart + firewall.body.hits[0].matchLength,
    ).toLowerCase()).toBe("firewall");
    expect(JSON.stringify(firewall.body)).not.toContain(".meta");

    const paste = await search("Paste Mermaid");
    expect(hitPaths(paste.body)).toEqual(expect.arrayContaining(["Welcome.mmd", "Examples/Sequence.mmd"]));
    const welcome = paste.body.hits.find((hit: Hit) => hit.path === "Welcome.mmd");
    expect(welcome.label).toBe("Node label");
    const message = (await search("Paste Mermaid markdown")).body.hits[0];
    expect(message.path).toBe("Examples/Sequence.mmd");
    expect(message.label).toBe("Sequence message");

    expect(hitPaths((await search("Live Preview")).body)).toEqual(["Welcome.mmd"]);
    expect(hitPaths((await search("SVG preview")).body)).toEqual(["Examples/Sequence.mmd"]);
    const https = (await search("HTTPS")).body.hits[0];
    expect(https).toMatchObject({ path: "Link.mmd", element: "edge", label: "Edge label" });

    for (const keyword of ["flowchart", "graph TD", "sequenceDiagram"]) {
      const res = await search(keyword);
      expect(res.status).toBe(200);
      expect(hitPaths(res.body)).toEqual([]);
    }

    expect(hitPaths((await search("StartLabel")).body)).toEqual(["HiddenId.mmd"]);
    expect(hitPaths((await search("Qx")).body)).toEqual([]);

    const commented = await writeNew(
      "Commented.mmd",
      "flowchart LR\n  %% SecretCommentToken\n  A[PublicLabel]\n",
    );
    expect(commented.path).toBe("Commented.mmd");
    expect(hitPaths((await search("SecretCommentToken")).body)).toEqual([]);
    expect(hitPaths((await search("PublicLabel")).body)).toEqual(["Commented.mmd"]);
    const index = await fs.readFile(path.join(dir, ".meta", "search", "index.json"), "utf8");
    expect(index).not.toContain("SecretCommentToken");
  });

  it("ranks a file name ahead of a title, tag, description, note, and body label", async () => {
    await writeNew("Firewall.mmd", "flowchart LR\n  A[Other]\n");
    await writeNew(
      "Titled.mmd",
      "---\ntitle: Firewall Zone\n---\nflowchart LR\n  A[Other]\n",
    );
    await writeNew(
      "Tagged.mmd",
      "---\nnerdgram:\n  tags:\n    - firewall-rule\n---\nflowchart LR\n  A[Other]\n",
    );
    await writeNew(
      "Described.mmd",
      "---\nnerdgram:\n  description: the firewall edge\n---\nflowchart LR\n  A[Other]\n",
    );
    await writeNew(
      "Noted.mmd",
      "---\nnerdgram:\n  notes: see Firewall\n---\nflowchart LR\n  A[Other]\n",
    );
    await writeNew("NetworkMap.mmd", NETWORK);
    await writeNew("Zed.mmd", "flowchart LR\n  A[Firewall]\n");

    const res = await search("Firewall");
    expect(res.status).toBe(200);
    expect(hitPaths(res.body)).toEqual([
      "Firewall.mmd",
      "Titled.mmd",
      "Tagged.mmd",
      "Described.mmd",
      "Noted.mmd",
      "NetworkMap.mmd",
      "Zed.mmd",
    ]);
    expect(res.body.hits.map((hit: Hit) => hit.field)).toEqual([
      "filename",
      "title",
      "tag",
      "description",
      "notes",
      "text",
      "text",
    ]);
    expect(res.body.hits[0].label).toBe("File name");
    expect(res.body.hits[5].label).toBe("Node label");

    const names = await search("Firewall", { names: "1" });
    expect(hitPaths(names.body)).toEqual(["Firewall.mmd"]);
    const meta = await search("Firewall", { contents: "0" });
    expect(hitPaths(meta.body)).not.toContain("NetworkMap.mmd");
    expect(hitPaths(meta.body)).toContain("Titled.mmd");
  });

  it("updates the index after save, move, duplicate, import, trash, and restore", async () => {
    const saved = await writeNew("Lab/Map.mmd", "flowchart LR\n  A[Alpha]\n");
    expect(hitPaths((await search("Alpha")).body)).toEqual(["Lab/Map.mmd"]);

    const edited = await request(app).put("/api/file").set(json).send({
      path: "Lab/Map.mmd",
      content: "flowchart LR\n  A[Beta]\n",
      expectedHash: saved.hash,
    });
    expect(edited.status).toBe(200);
    expect(hitPaths((await search("Alpha")).body)).toEqual([]);
    expect(hitPaths((await search("Beta")).body)).toEqual(["Lab/Map.mmd"]);

    const moved = await request(app).post("/api/move").set(json).send({ from: "Lab/Map.mmd", toFolder: "" });
    expect(moved.status).toBe(200);
    expect(hitPaths((await search("Beta")).body)).toEqual(["Map.mmd"]);

    const copy = await request(app).post("/api/duplicate").set(json).send({ path: "Map.mmd" });
    expect(copy.status).toBe(201);
    expect(hitPaths((await search("Beta")).body).sort()).toEqual(["Map (copy).mmd", "Map.mmd"]);

    const imported = await request(app).post("/api/import").set(json).send({
      folder: "",
      files: [{ name: "Imported.mmd", text: "flowchart LR\n  A[ImportedLabel]\n" }],
    });
    expect(imported.status).toBe(200);
    expect(hitPaths((await search("ImportedLabel")).body)).toEqual(["Imported.mmd"]);

    const trashed = await request(app).delete("/api/item").query({ path: "Map.mmd" }).set(json);
    expect(trashed.status).toBe(204);
    expect(hitPaths((await search("Beta")).body)).toEqual(["Map (copy).mmd"]);

    const trash = await request(app).get("/api/trash").set("Host", HOST);
    const id = trash.body.items[0].id as string;
    const restored = await request(app).post("/api/trash/restore").set(json).send({ id });
    expect(restored.status).toBe(200);
    expect(hitPaths((await search("Beta")).body).sort()).toEqual(["Map (copy).mmd", "Map.mmd"]);
  });

  it("ignores .meta, dot paths, and a corrupt index, and sees an external edit", async () => {
    await writeNew("Visible.mmd", "flowchart LR\n  A[VisibleLabel]\n");
    expect(hitPaths((await search("VisibleLabel")).body)).toEqual(["Visible.mmd"]);

    await fs.mkdir(path.join(dir, ".meta", "trash"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".meta", "trash", "Hidden.mmd"),
      "flowchart LR\n  A[TrashOnlyToken]\n",
    );
    await fs.writeFile(path.join(dir, ".secret.mmd"), "flowchart LR\n  A[DotOnlyToken]\n");

    const hidden = await search("TrashOnlyToken");
    expect(hidden.status).toBe(200);
    expect(hidden.body.hits).toEqual([]);
    expect(hitPaths((await search("DotOnlyToken")).body)).toEqual([]);
    const blocked = await request(app).get("/api/search").query({ q: "VisibleLabel", path: ".meta/search/index.json" }).set("Host", HOST);
    expect(blocked.status).toBe(200);
    expect(JSON.stringify(blocked.body)).not.toContain(".meta");

    const denied = await request(app).get("/api/file").query({ path: ".meta/search/index.json" }).set("Host", HOST);
    expect(denied.status).toBe(400);

    const now = new Date();
    await fs.writeFile(path.join(dir, "Visible.mmd"), "flowchart LR\n  A[ExternalLabel]\n");
    await fs.utimes(path.join(dir, "Visible.mmd"), now, now);
    expect(hitPaths((await search("VisibleLabel")).body)).toEqual([]);
    expect(hitPaths((await search("ExternalLabel")).body)).toEqual(["Visible.mmd"]);

    discardSearchCache();
    await fs.writeFile(path.join(dir, ".meta", "search", "index.json"), "{", "utf8");
    expect(hitPaths((await search("ExternalLabel")).body)).toEqual(["Visible.mmd"]);

    discardSearchCache();
    await fs.rm(path.join(dir, ".meta", "search", "index.json"), { force: true });
    expect(hitPaths((await search("ExternalLabel")).body)).toEqual(["Visible.mmd"]);
    const tree = await request(app).get("/api/tree").set("Host", HOST);
    expect(JSON.stringify(tree.body)).not.toContain(".meta");
    expect(JSON.stringify(tree.body)).not.toContain("index.json");
  });

  it("rejects an unsafe regular expression quickly and treats the same text as a literal", async () => {
    await fs.writeFile(path.join(dir, "Long.mmd"), `flowchart LR\n  A[${"a".repeat(20_000)}]\n`);
    const started = Date.now();
    const unsafe = await search("(a+)+$", { regex: "1" });
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.code).toBe("unsafe_regex");
    expect(Date.now() - started).toBeLessThan(500);

    const literalStarted = Date.now();
    const literal = await search("(a+)+$");
    expect(literal.status).toBe(200);
    expect(literal.body.hits).toEqual([]);
    expect(Date.now() - literalStarted).toBeLessThan(500);

    await writeNew("Fire.mmd", "flowchart LR\n  A[Firewall]\n");
    const safe = await search("Firew.", { regex: "1" });
    expect(safe.status).toBe(200);
    expect(hitPaths(safe.body)).toContain("Fire.mmd");

    const tooLong = await search("x".repeat(201));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe("invalid");
  });

  it("caps the number of hits and the snippet length", async () => {
    const long = `flowchart LR\n  A[UniqueCap ${"Token ".repeat(80)}]\n`;
    await Promise.all(
      Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_, index) =>
        fs.writeFile(path.join(dir, `Cap${index}.mmd`), long),
      ),
    );
    const res = await search("UniqueCap");
    expect(res.status).toBe(200);
    expect(res.body.hits).toHaveLength(MAX_SEARCH_RESULTS);
    expect(res.body.truncated).toBe(true);
    for (const hit of res.body.hits as Hit[]) {
      expect(hit.snippet.length).toBeLessThanOrEqual(142);
      const matched = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength);
      expect(matched.toLowerCase()).toBe("uniquecap");
    }
  });

  it("searches a warm index of many diagrams quickly", async () => {
    await Promise.all(
      Array.from({ length: 400 }, (_, index) =>
        fs.writeFile(
          path.join(dir, `Bulk${index}.mmd`),
          `flowchart LR\n  N${index}[Bulk label #${index}#]\n`,
        ),
      ),
    );
    const cold = await search("Bulk label #399#");
    expect(hitPaths(cold.body)).toEqual(["Bulk399.mmd"]);
    const started = Date.now();
    const warm = await search("Bulk label #20#");
    expect(warm.status).toBe(200);
    expect(hitPaths(warm.body)).toEqual(["Bulk20.mmd"]);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(hitPaths((await search("not-in-any-diagram")).body)).toEqual([]);
  }, 30_000);
});
