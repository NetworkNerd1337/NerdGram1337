import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { thumbnailCacheKey } from "../src/frontMatter.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = {
  Host: HOST,
  "Content-Type": "application/json",
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const BODY = "flowchart LR\n  A-->B\n";

function makeApp() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

describe("thumbnail cache", () => {
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

  async function writeNew(filePath: string, content: string) {
    const res = await request(app).put("/api/file").set(json).send({ path: filePath, content });
    expect(res.status).toBe(200);
    return res.body as { path: string; mtimeMs: number; hash: string };
  }

  async function putThumb(filePath: string, content: string, svg = SVG) {
    const res = await request(app).put("/api/thumbnail").set(json).send({
      path: filePath,
      cacheKey: thumbnailCacheKey(content),
      svg,
    });
    expect(res.status).toBe(200);
    return res;
  }

  it("serves a cached thumbnail and does not list it in the tree", async () => {
    const content = `---\nconfig:\n  theme: dark\n---\n${BODY}`;
    await writeNew("Lab/Notes.mmd", content);
    await putThumb("Lab/Notes.mmd", content);

    const hit = await request(app).get("/api/thumbnail").query({ path: "Lab/Notes.mmd" }).set("Host", HOST);
    expect(hit.status).toBe(200);
    expect(hit.body.hit).toBe(true);
    expect(hit.body.cacheKey).toBe(thumbnailCacheKey(content));
    expect(hit.body.svg).toBe(SVG);
    expect(hit.body.path).toBe("Lab/Notes.mmd");

    const tree = await request(app).get("/api/tree").set("Host", HOST);
    expect(JSON.stringify(tree.body)).not.toContain(".meta");
    expect(JSON.stringify(tree.body)).not.toContain("thumbs");
    const stored = path.join(dir, ".meta", "thumbs");
    const names = await fs.readdir(stored);
    expect(names.some((name) => name.endsWith(".json"))).toBe(true);
  });

  it("misses after a variables-only save and rejects a stale put", async () => {
    const content = `---\nconfig:\n  theme: dark\n---\n${BODY}`;
    const saved = await writeNew("Notes.mmd", content);
    await putThumb("Notes.mmd", content);

    const next = `---\nconfig:\n  theme: dark\n  themeVariables:\n    primaryColor: "#ff0000"\n---\n${BODY}`;
    const edited = await request(app).put("/api/file").set(json).send({
      path: "Notes.mmd",
      content: next,
      expectedHash: saved.hash,
    });
    expect(edited.status).toBe(200);

    const miss = await request(app).get("/api/thumbnail").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(miss.status).toBe(200);
    expect(miss.body.hit).toBe(false);
    expect(miss.body.cacheKey).toBe(thumbnailCacheKey(next));

    const stale = await request(app).put("/api/thumbnail").set(json).send({
      path: "Notes.mmd",
      cacheKey: thumbnailCacheKey(content),
      svg: SVG,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("stale");

    await putThumb("Notes.mmd", next, SVG.replace("rect", "rect data-next=\"1\""));
    const hit = await request(app).get("/api/thumbnail").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(hit.status).toBe(200);
    expect(hit.body.hit).toBe(true);
    expect(hit.body.cacheKey).toBe(thumbnailCacheKey(next));
    expect(hit.body.svg).toContain("data-next");
  });

  it("retargets a thumbnail on move and restores it from trash", async () => {
    const content = BODY;
    await writeNew("Lab/Notes.mmd", content);
    await putThumb("Lab/Notes.mmd", content);

    const moved = await request(app)
      .post("/api/move")
      .set(json)
      .send({ from: "Lab/Notes.mmd", toFolder: "" });
    expect(moved.status).toBe(200);

    const oldHit = await request(app).get("/api/thumbnail").query({ path: "Lab/Notes.mmd" }).set("Host", HOST);
    expect(oldHit.status).toBe(404);
    const movedHit = await request(app).get("/api/thumbnail").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(movedHit.status).toBe(200);
    expect(movedHit.body.hit).toBe(true);
    expect(movedHit.body.svg).toBe(SVG);

    const trashed = await request(app).delete("/api/item").query({ path: "Notes.mmd" }).set(json);
    expect(trashed.status).toBe(204);
    const gone = await request(app).get("/api/thumbnail").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(gone.status).toBe(404);

    const trash = await request(app).get("/api/trash").set("Host", HOST);
    const id = trash.body.items[0].id as string;
    const restored = await request(app).post("/api/trash/restore").set(json).send({ id });
    expect(restored.status).toBe(200);
    const back = await request(app).get("/api/thumbnail").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(back.status).toBe(200);
    expect(back.body.hit).toBe(true);
    expect(back.body.svg).toBe(SVG);
  });

  it("does not reuse the source thumbnail for a duplicate", async () => {
    const content = BODY;
    await writeNew("Notes.mmd", content);
    await putThumb("Notes.mmd", content);

    const copy = await request(app).post("/api/duplicate").set(json).send({ path: "Notes.mmd" });
    expect(copy.status).toBe(201);
    expect(copy.body.path).toBe("Notes (copy).mmd");

    const source = await request(app).get("/api/thumbnail").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(source.status).toBe(200);
    expect(source.body.hit).toBe(true);
    const duplicated = await request(app)
      .get("/api/thumbnail")
      .query({ path: "Notes (copy).mmd" })
      .set("Host", HOST);
    expect(duplicated.status).toBe(200);
    expect(duplicated.body.hit).toBe(false);
  });

  it("rejects a hidden path, a non-svg body, and a non-json put", async () => {
    await writeNew("Notes.mmd", BODY);

    const hidden = await request(app)
      .get("/api/thumbnail")
      .query({ path: ".meta/thumbs/Notes.mmd" })
      .set("Host", HOST);
    expect(hidden.status).toBe(400);

    const badSvg = await request(app).put("/api/thumbnail").set(json).send({
      path: "Notes.mmd",
      cacheKey: thumbnailCacheKey(BODY),
      svg: "<svg><script>alert(1)</script></svg>",
    });
    expect(badSvg.status).toBe(400);

    const form = await request(app)
      .put("/api/thumbnail")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("not json");
    expect(form.status).toBe(415);

    const foreign = await request(app)
      .put("/api/thumbnail")
      .set({ ...json, Origin: "https://evil.example" })
      .send({ path: "Notes.mmd", cacheKey: thumbnailCacheKey(BODY), svg: SVG });
    expect(foreign.status).toBe(403);
  });
});
