import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { diagramNameFromImport } from "../src/import.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = {
  Host: HOST,
  "Content-Type": "application/json",
};

function makeApp() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

describe("move, duplicate, and import", () => {
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

  it("moves a diagram into the workspace root and keeps its favorite and history", async () => {
    const saved = await writeNew("Lab/Notes.mmd", "before\n");
    const edited = await request(app).put("/api/file").set(json).send({
      path: "Lab/Notes.mmd",
      content: "after\n",
      expectedHash: saved.hash,
    });
    expect(edited.status).toBe(200);
    await request(app).post("/api/favorites/toggle").set(json).send({ path: "Lab/Notes.mmd" });

    const moved = await request(app)
      .post("/api/move")
      .set(json)
      .send({ from: "Lab/Notes.mmd", toFolder: "" });
    expect(moved.status).toBe(200);
    expect(moved.body.path).toBe("Notes.mmd");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("after\n");
    await expect(fs.access(path.join(dir, "Lab", "Notes.mmd"))).rejects.toThrow();

    const favorites = await request(app).get("/api/favorites").set("Host", HOST);
    expect(favorites.body.favorites).toEqual(["Notes.mmd"]);
    const history = await request(app).get("/api/history").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(history.body.revisions.length).toBeGreaterThan(0);
  });

  it("moves a folder and rewrites favorites underneath it", async () => {
    await writeNew("Lab/One.mmd", "flowchart LR\n  A-->B\n");
    await writeNew("Lab/Nested/Two.mmd", "flowchart LR\n  C-->D\n");
    await request(app).post("/api/favorites/toggle").set(json).send({ path: "Lab/Nested/Two.mmd" });

    const moved = await request(app).post("/api/move").set(json).send({ from: "Lab", toFolder: "Archive" });
    expect(moved.status).toBe(200);
    expect(moved.body.path).toBe("Archive/Lab");
    expect(await fs.readFile(path.join(dir, "Archive", "Lab", "Nested", "Two.mmd"), "utf8")).toContain("C-->D");
    const favorites = await request(app).get("/api/favorites").set("Host", HOST);
    expect(favorites.body.favorites).toEqual(["Archive/Lab/Nested/Two.mmd"]);
  });

  it("rejects moving a folder into itself or a descendant and leaves the tree alone", async () => {
    await writeNew("Lab/Nested/One.mmd", "flowchart LR\n  A-->B\n");

    const intoSelf = await request(app).post("/api/move").set(json).send({ from: "Lab", toFolder: "Lab" });
    expect(intoSelf.status).toBe(400);
    expect(intoSelf.body.code).toBe("descendant");

    const intoChild = await request(app)
      .post("/api/move")
      .set(json)
      .send({ from: "Lab", toFolder: "Lab/Nested" });
    expect(intoChild.status).toBe(400);
    expect(intoChild.body.code).toBe("descendant");

    const renamed = await request(app)
      .patch("/api/rename")
      .set(json)
      .send({ from: "Lab", to: "Lab/Nested/Lab" });
    expect(renamed.status).toBe(400);
    expect(renamed.body.code).toBe("descendant");
    expect(await fs.readFile(path.join(dir, "Lab", "Nested", "One.mmd"), "utf8")).toContain("A-->B");
  });

  it("refuses a move that would overwrite and offers a copy name", async () => {
    await writeNew("Notes.mmd", "source\n");
    await writeNew("Lab/Notes.mmd", "destination\n");

    const moved = await request(app).post("/api/move").set(json).send({ from: "Notes.mmd", toFolder: "Lab" });
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe("collision");
    expect(moved.body.path).toBe("Lab/Notes.mmd");
    expect(moved.body.suggestedPath).toBe("Lab/Notes (copy).mmd");
    expect(await fs.readFile(path.join(dir, "Lab", "Notes.mmd"), "utf8")).toBe("destination\n");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("source\n");

    const kept = await request(app)
      .patch("/api/rename")
      .set(json)
      .send({ from: "Notes.mmd", to: moved.body.suggestedPath });
    expect(kept.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Lab", "Notes (copy).mmd"), "utf8")).toBe("source\n");
    expect(await fs.readFile(path.join(dir, "Lab", "Notes.mmd"), "utf8")).toBe("destination\n");
  });

  it("rejects a move of a locked diagram or of a folder that contains one", async () => {
    await writeNew("Notes.mmd", "flowchart LR\n  A-->B\n");
    await writeNew("Lab/One.mmd", "flowchart LR\n  C-->D\n");
    const lock = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-one" });
    expect(lock.status).toBe(200);
    const moved = await request(app).post("/api/move").set(json).send({ from: "Notes.mmd", toFolder: "Lab" });
    expect(moved.status).toBe(423);
    expect(moved.body.code).toBe("locked");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toContain("A-->B");

    await request(app).post("/api/lock/release").set(json).send({ path: "Notes.mmd", token: lock.body.token });
    const child = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Lab/One.mmd", sessionId: "tab-two" });
    expect(child.status).toBe(200);
    const movedFolder = await request(app).post("/api/move").set(json).send({ from: "Lab", toFolder: "Archive" });
    expect(movedFolder.status).toBe(423);
    expect(movedFolder.body.code).toBe("locked");
    expect(await fs.readFile(path.join(dir, "Lab", "One.mmd"), "utf8")).toContain("C-->D");
  });

  it("rejects a move into .meta", async () => {
    await writeNew("Notes.mmd", "flowchart LR\n  A-->B\n");
    const moved = await request(app).post("/api/move").set(json).send({ from: "Notes.mmd", toFolder: ".meta" });
    expect(moved.status).toBe(400);
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toContain("A-->B");
  });

  it("duplicates a diagram with a collision-safe name and its own history", async () => {
    const saved = await writeNew("Notes.mmd", "before\n");
    await request(app).put("/api/file").set(json).send({
      path: "Notes.mmd",
      content: "after\n",
      expectedHash: saved.hash,
    });
    await request(app).post("/api/favorites/toggle").set(json).send({ path: "Notes.mmd" });
    const lock = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-one" });
    expect(lock.status).toBe(200);

    const first = await request(app).post("/api/duplicate").set(json).send({ path: "Notes.mmd" });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ path: "Notes (copy).mmd", type: "file", dataFiles: [] });
    expect(await fs.readFile(path.join(dir, "Notes (copy).mmd"), "utf8")).toBe("after\n");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("after\n");

    const second = await request(app).post("/api/duplicate").set(json).send({ path: "Notes.mmd" });
    expect(second.status).toBe(201);
    expect(second.body.path).toBe("Notes (copy 2).mmd");

    const favorites = await request(app).get("/api/favorites").set("Host", HOST);
    expect(favorites.body.favorites).toEqual(["Notes.mmd"]);
    const copyHistory = await request(app)
      .get("/api/history")
      .query({ path: "Notes (copy).mmd" })
      .set("Host", HOST);
    expect(copyHistory.body.revisions).toEqual([]);
    const sourceHistory = await request(app).get("/api/history").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(sourceHistory.body.revisions.length).toBeGreaterThan(0);

    const copyLock = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes (copy).mmd", sessionId: "tab-two" });
    expect(copyLock.status).toBe(200);
    const sourceStillLocked = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-two" });
    expect(sourceStillLocked.status).toBe(423);
  });

  it("duplicates a folder tree without hidden files", async () => {
    await writeNew("Lab/Sub/One.mmd", "flowchart LR\n  A-->B\n");
    await writeNew("Lab/Two.mmd", "flowchart LR\n  C-->D\n");
    await fs.writeFile(path.join(dir, "Lab", ".secret.mmd"), "hidden\n");

    const copied = await request(app).post("/api/duplicate").set(json).send({ path: "Lab" });
    expect(copied.status).toBe(201);
    expect(copied.body).toEqual({ path: "Lab (copy)", type: "folder", dataFiles: [] });
    expect(await fs.readFile(path.join(dir, "Lab (copy)", "Sub", "One.mmd"), "utf8")).toContain("A-->B");
    expect(await fs.readFile(path.join(dir, "Lab (copy)", "Two.mmd"), "utf8")).toContain("C-->D");
    await expect(fs.access(path.join(dir, "Lab (copy)", ".secret.mmd"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "Lab", "Two.mmd"), "utf8")).toContain("C-->D");

    const again = await request(app).post("/api/duplicate").set(json).send({ path: "Lab" });
    expect(again.body.path).toBe("Lab (copy 2)");
  });

  it("imports several text files into a folder without overwriting a collision", async () => {
    await writeNew("Lab/Notes.mmd", "already\n");
    const imported = await request(app)
      .post("/api/import")
      .set(json)
      .send({
        folder: "Lab",
        files: [
          { name: "Fresh.mmd", text: "flowchart LR\n  A-->B\n" },
          { name: "From Markdown.md", text: "flowchart LR\n  C-->D\n" },
          { name: "plain.txt", text: "flowchart LR\n  E-->F\n" },
          { name: "Notes.mmd", text: "replacement\n" },
        ],
      });
    expect(imported.status).toBe(200);
    expect(imported.body.results).toEqual([
      { name: "Fresh.mmd", status: "created", path: "Lab/Fresh.mmd" },
      { name: "From Markdown.md", status: "created", path: "Lab/From Markdown.mmd" },
      { name: "plain.txt", status: "created", path: "Lab/plain.mmd" },
      {
        name: "Notes.mmd",
        status: "collision",
        code: "collision",
        path: "Lab/Notes.mmd",
        suggestedPath: "Lab/Notes 2.mmd",
        error: "Something already exists at that path.",
      },
    ]);
    expect(await fs.readFile(path.join(dir, "Lab", "Notes.mmd"), "utf8")).toBe("already\n");
    expect(await fs.readFile(path.join(dir, "Lab", "Fresh.mmd"), "utf8")).toContain("A-->B");
    expect(await fs.readFile(path.join(dir, "Lab", "From Markdown.mmd"), "utf8")).toContain("C-->D");
    await expect(fs.access(path.join(dir, "Lab", "plain.txt"))).rejects.toThrow();

    const decided = await request(app)
      .post("/api/import")
      .set(json)
      .send({
        folder: "Lab",
        files: [
          { name: "Notes.mmd", text: "renamed\n", onCollision: "rename" },
          { name: "Fresh.mmd", text: "skipped\n", onCollision: "skip" },
        ],
      });
    expect(decided.status).toBe(200);
    expect(decided.body.results[0]).toMatchObject({ status: "renamed", path: "Lab/Notes 2.mmd" });
    expect(decided.body.results[1]).toMatchObject({ status: "skipped", path: "Lab/Fresh.mmd" });
    expect(await fs.readFile(path.join(dir, "Lab", "Notes 2.mmd"), "utf8")).toBe("renamed\n");
    expect(await fs.readFile(path.join(dir, "Lab", "Fresh.mmd"), "utf8")).toContain("A-->B");
  });

  it("replaces an imported name only when asked, and keeps the previous revision", async () => {
    const saved = await writeNew("Notes.mmd", "original\n");
    const replaced = await request(app)
      .post("/api/import")
      .set(json)
      .send({
        folder: "",
        files: [{ name: "Notes.mmd", text: "incoming\n", onCollision: "replace" }],
      });
    expect(replaced.status).toBe(200);
    expect(replaced.body.results[0]).toMatchObject({ status: "replaced", path: "Notes.mmd" });
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("incoming\n");
    const history = await request(app).get("/api/history").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(history.body.revisions.length).toBeGreaterThan(0);
    const revision = await request(app)
      .get("/api/history/revision")
      .query({ path: "Notes.mmd", id: history.body.revisions[0].id })
      .set("Host", HOST);
    expect(revision.body.content).toBe("original\n");
    expect(saved.path).toBe("Notes.mmd");
  });

  it("does not replace a locked diagram on import", async () => {
    await writeNew("Notes.mmd", "original\n");
    const lock = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-one" });
    expect(lock.status).toBe(200);
    const imported = await request(app)
      .post("/api/import")
      .set(json)
      .send({
        folder: "",
        files: [{ name: "Notes.mmd", text: "incoming\n", onCollision: "replace" }],
      });
    expect(imported.status).toBe(200);
    expect(imported.body.results[0].status).toBe("error");
    expect(imported.body.results[0].code).toBe("locked");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("original\n");
  });

  it("reports a bad file without blocking the rest of the import", async () => {
    const imported = await request(app)
      .post("/api/import")
      .set(json)
      .send({
        folder: "",
        files: [
          { name: "../.meta/secret.mmd", text: "flowchart LR\n  A-->B\n" },
          { name: "photo.png", text: "not-a-diagram" },
          { name: ".hidden.mmd", text: "flowchart LR\n  A-->B\n" },
          { name: "ok.mmd", text: "flowchart LR\n  A-->B\n" },
          { name: "binary.mmd", text: "bad\0bytes" },
        ],
      });
    expect(imported.status).toBe(200);
    expect(imported.body.results.find((item: { name: string }) => item.name === "ok.mmd").status).toBe(
      "created",
    );
    expect(imported.body.results.find((item: { name: string }) => item.name === "photo.png").status).toBe(
      "error",
    );
    expect(
      imported.body.results.find((item: { name: string }) => item.name === ".hidden.mmd").status,
    ).toBe("error");
    expect(imported.body.results.find((item: { name: string }) => item.name === "binary.mmd").status).toBe(
      "error",
    );
    expect(await fs.readFile(path.join(dir, "secret.mmd"), "utf8")).toContain("A-->B");
    await expect(fs.access(path.join(dir, ".meta", "secret.mmd"))).rejects.toThrow();
    const names = await fs.readdir(dir);
    // `.meta` is the search index, not an imported file. Nothing else hidden lands in the workspace.
    expect(names.filter((name) => name.endsWith(".png") || (name.startsWith(".") && name !== ".meta"))).toEqual(
      [],
    );
  });

  it("rejects an import into .meta, a missing folder, or a non-JSON body", async () => {
    await writeNew("Notes.mmd", "flowchart LR\n  A-->B\n");
    const hidden = await request(app)
      .post("/api/import")
      .set(json)
      .send({ folder: ".meta", files: [{ name: "X.mmd", text: "flowchart LR\n  A-->B\n" }] });
    expect(hidden.status).toBe(400);

    const missing = await request(app)
      .post("/api/import")
      .set(json)
      .send({ folder: "Missing", files: [{ name: "X.mmd", text: "flowchart LR\n  A-->B\n" }] });
    expect(missing.status).toBe(404);

    const ontoFile = await request(app)
      .post("/api/import")
      .set(json)
      .send({ folder: "Notes.mmd", files: [{ name: "X.mmd", text: "flowchart LR\n  A-->B\n" }] });
    expect(ontoFile.status).toBe(400);

    const form = await request(app)
      .post("/api/import")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("name=X.mmd");
    expect(form.status).toBe(415);
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toContain("A-->B");
  });

  it("rejects an import that is too large before writing anything", async () => {
    const oversized = await request(app)
      .post("/api/import")
      .set(json)
      .send({
        folder: "",
        files: [
          { name: "Big.mmd", text: "x".repeat(512 * 1024 + 1) },
          { name: "Small.mmd", text: "flowchart LR\n  A-->B\n" },
        ],
      });
    expect(oversized.status).toBe(200);
    expect(oversized.body.results[0]).toMatchObject({
      status: "error",
      error: "This file is larger than 512 KB.",
    });
    expect(oversized.body.results[1].status).toBe("created");

    const chunk = "y".repeat(500_000);
    const tooMuch = await request(app)
      .post("/api/import")
      .set(json)
      .send({
        folder: "",
        files: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: `Part${n}.mmd`, text: chunk })),
      });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.code).toBe("invalid");
    await expect(fs.access(path.join(dir, "Part1.mmd"))).rejects.toThrow();
  });

  it("keeps a safe diagram name when the uploaded name has extra path pieces", () => {
    expect(diagramNameFromImport("..\\..\\Notes.md")).toBe("Notes.mmd");
    expect(diagramNameFromImport("rack/Firewall Rules.TXT")).toBe("Firewall Rules.mmd");
    expect(() => diagramNameFromImport(".secret.mmd")).toThrow(/not allowed/);
    expect(() => diagramNameFromImport("photo.png")).toThrow(/\.mmd, \.md, and \.txt/);
  });
});
