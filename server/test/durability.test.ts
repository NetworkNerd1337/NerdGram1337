import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { REVISION_RETENTION, encodeStorageKey } from "../src/storage.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function makeApp() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

const json = {
  Host: HOST,
  "Content-Type": "application/json",
};

type Saved = { path: string; mtimeMs: number; hash: string; content: string };

describe("trash, history, conflicts, and locks", () => {
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

  async function writeNew(filePath: string, content: string): Promise<Saved> {
    const res = await request(app).put("/api/file").set(json).send({ path: filePath, content });
    expect(res.status).toBe(200);
    return { path: res.body.path, mtimeMs: res.body.mtimeMs, hash: res.body.hash, content };
  }

  async function writeNext(saved: Saved, content: string, extra: Record<string, unknown> = {}) {
    const res = await request(app)
      .put("/api/file")
      .set(json)
      .send({
        path: saved.path,
        content,
        expectedMtimeMs: saved.mtimeMs,
        expectedHash: saved.hash,
        ...extra,
      });
    return res;
  }

  it("soft-deletes a diagram, hides it from the tree, and restores it with its favorite", async () => {
    const content = "flowchart LR\n  A-->B\n";
    await writeNew("Notes.mmd", content);
    await request(app).post("/api/favorites/toggle").set(json).send({ path: "Notes.mmd" });

    const removed = await request(app).delete("/api/item").query({ path: "Notes.mmd" }).set(json);
    expect(removed.status).toBe(204);
    await expect(fs.access(path.join(dir, "Notes.mmd"))).rejects.toThrow();

    const tree = await request(app).get("/api/tree").set("Host", HOST);
    expect(JSON.stringify(tree.body)).not.toContain("Notes.mmd");
    expect(JSON.stringify(tree.body)).not.toContain(".meta");

    const listed = await request(app).get("/api/trash").set("Host", HOST);
    expect(listed.body.items).toHaveLength(1);
    const item = listed.body.items[0];
    expect(item).toMatchObject({
      originalPath: "Notes.mmd",
      type: "file",
      favorites: ["Notes.mmd"],
    });
    const payload = await fs.readFile(
      path.join(dir, ".meta", "trash", "items", item.id, "payload.mmd"),
      "utf8",
    );
    expect(payload).toBe(content);

    const favorites = await request(app).get("/api/favorites").set("Host", HOST);
    expect(favorites.body.favorites).toEqual([]);

    const restored = await request(app).post("/api/trash/restore").set(json).send({ id: item.id });
    expect(restored.status).toBe(200);
    expect(restored.body.path).toBe("Notes.mmd");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe(content);
    const favoritesAgain = await request(app).get("/api/favorites").set("Host", HOST);
    expect(favoritesAgain.body.favorites).toEqual(["Notes.mmd"]);
    const trashAgain = await request(app).get("/api/trash").set("Host", HOST);
    expect(trashAgain.body.items).toEqual([]);
  });

  it("trashes a folder as one unit and restores the whole tree", async () => {
    await writeNew("Lab/One.mmd", "flowchart LR\n  A-->B\n");
    await writeNew("Lab/Nested/Two.mmd", "flowchart LR\n  C-->D\n");
    await fs.writeFile(path.join(dir, "Lab", "notes.txt"), "keep me");
    await request(app).post("/api/favorites/toggle").set(json).send({ path: "Lab/One.mmd" });

    const removed = await request(app).delete("/api/item").query({ path: "Lab" }).set(json);
    expect(removed.status).toBe(204);
    await expect(fs.access(path.join(dir, "Lab"))).rejects.toThrow();

    const listed = await request(app).get("/api/trash").set("Host", HOST);
    expect(listed.body.items).toEqual([
      expect.objectContaining({ originalPath: "Lab", type: "folder", favorites: ["Lab/One.mmd"] }),
    ]);

    const restored = await request(app)
      .post("/api/trash/restore")
      .set(json)
      .send({ id: listed.body.items[0].id });
    expect(restored.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Lab", "One.mmd"), "utf8")).toContain("A-->B");
    expect(await fs.readFile(path.join(dir, "Lab", "Nested", "Two.mmd"), "utf8")).toContain("C-->D");
    expect(await fs.readFile(path.join(dir, "Lab", "notes.txt"), "utf8")).toBe("keep me");
    const favorites = await request(app).get("/api/favorites").set("Host", HOST);
    expect(favorites.body.favorites).toEqual(["Lab/One.mmd"]);
  });

  it("offers a copy path when restore would collide, and replace moves the occupant to trash", async () => {
    const original = "flowchart LR\n  old-->v\n";
    await writeNew("Notes.mmd", original);
    await request(app).delete("/api/item").query({ path: "Notes.mmd" }).set(json);
    await writeNew("Notes.mmd", "flowchart LR\n  new-->v\n");
    const listed = await request(app).get("/api/trash").set("Host", HOST);
    const id = listed.body.items[0].id;

    const blocked = await request(app).post("/api/trash/restore").set(json).send({ id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("collision");
    expect(blocked.body.suggestedPath).toBe("Notes (restored).mmd");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toContain("new-->v");

    const copied = await request(app)
      .post("/api/trash/restore")
      .set(json)
      .send({ id, path: blocked.body.suggestedPath });
    expect(copied.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Notes (restored).mmd"), "utf8")).toBe(original);

    await writeNew("Other.mmd", original);
    await request(app).delete("/api/item").query({ path: "Other.mmd" }).set(json);
    await writeNew("Other.mmd", "flowchart LR\n  occupant-->v\n");
    const second = await request(app).get("/api/trash").set("Host", HOST);
    const other = second.body.items.find((item: { originalPath: string }) => item.originalPath === "Other.mmd");
    const replaced = await request(app)
      .post("/api/trash/restore")
      .set(json)
      .send({ id: other.id, overwrite: true });
    expect(replaced.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Other.mmd"), "utf8")).toBe(original);
    const after = await request(app).get("/api/trash").set("Host", HOST);
    expect(after.body.items.map((item: { originalPath: string }) => item.originalPath)).toContain(
      "Other.mmd",
    );
  });

  it("purges one item and can empty the trash", async () => {
    await writeNew("A.mmd", "flowchart LR\n  A-->B\n");
    await writeNew("B.mmd", "flowchart LR\n  C-->D\n");
    await request(app).delete("/api/item").query({ path: "A.mmd" }).set(json);
    await request(app).delete("/api/item").query({ path: "B.mmd" }).set(json);
    const listed = await request(app).get("/api/trash").set("Host", HOST);
    const first = listed.body.items[0];
    const purged = await request(app).delete("/api/trash/item").query({ id: first.id }).set(json);
    expect(purged.status).toBe(204);
    await expect(
      fs.access(path.join(dir, ".meta", "trash", "items", first.id)),
    ).rejects.toThrow();

    const emptied = await request(app).post("/api/trash/empty").set(json).send({});
    expect(emptied.body.purged).toBe(1);
    const left = await request(app).get("/api/trash").set("Host", HOST);
    expect(left.body.items).toEqual([]);
  });

  it("keeps the previous bytes as a revision and caps how many are kept", async () => {
    let saved = await writeNew("Rev.mmd", "revision-0\n");
    expect(await fs.readFile(path.join(dir, "Rev.mmd"), "utf8")).toBe("revision-0\n");

    const same = await writeNext(saved, "revision-0\n");
    expect(same.status).toBe(200);
    expect(same.body.unchanged).toBe(true);
    let history = await request(app).get("/api/history").query({ path: "Rev.mmd" }).set("Host", HOST);
    expect(history.body.retention).toBe(REVISION_RETENTION);
    expect(history.body.revisions).toEqual([]);

    for (let n = 1; n <= REVISION_RETENTION + 1; n += 1) {
      const next = await writeNext(saved, `revision-${n}\n`);
      expect(next.status).toBe(200);
      saved = {
        path: next.body.path,
        mtimeMs: next.body.mtimeMs,
        hash: next.body.hash,
        content: `revision-${n}\n`,
      };
    }

    history = await request(app).get("/api/history").query({ path: "Rev.mmd" }).set("Host", HOST);
    expect(history.body.revisions).toHaveLength(REVISION_RETENTION);
    const contents = await Promise.all(
      history.body.revisions.map(async (revision: { id: string }) => {
        const read = await request(app)
          .get("/api/history/revision")
          .query({ path: "Rev.mmd", id: revision.id })
          .set("Host", HOST);
        expect(read.status).toBe(200);
        return read.body.content as string;
      }),
    );
    expect(contents).not.toContain("revision-0\n");
    expect(contents).toContain("revision-1\n");
    expect(await fs.readFile(path.join(dir, "Rev.mmd"), "utf8")).toBe(
      `revision-${REVISION_RETENTION + 1}\n`,
    );
    expect(createHash("sha256").update(`revision-${REVISION_RETENTION + 1}\n`).digest("hex")).toBe(
      saved.hash,
    );
  });

  it("restores a revision without losing the version it replaces", async () => {
    let saved = await writeNew("Rev.mmd", "one\n");
    saved = await (async () => {
      const next = await writeNext(saved, "two\n");
      expect(next.status).toBe(200);
      return { path: "Rev.mmd", mtimeMs: next.body.mtimeMs, hash: next.body.hash, content: "two\n" };
    })();
    const third = await writeNext(saved, "three\n");
    expect(third.status).toBe(200);

    const history = await request(app).get("/api/history").query({ path: "Rev.mmd" }).set("Host", HOST);
    const one = await findRevision("Rev.mmd", "one\n");
    const restored = await request(app)
      .post("/api/history/restore")
      .set(json)
      .send({ path: "Rev.mmd", id: one.id });
    expect(restored.status).toBe(200);
    expect(restored.body.content).toBe("one\n");
    expect(await fs.readFile(path.join(dir, "Rev.mmd"), "utf8")).toBe("one\n");

    const replaced = await findRevision("Rev.mmd", "three\n");
    expect(replaced.id).not.toBe(one.id);
    const forward = await request(app)
      .post("/api/history/restore")
      .set(json)
      .send({ path: "Rev.mmd", id: replaced.id });
    expect(forward.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Rev.mmd"), "utf8")).toBe("three\n");
    expect(history.body.revisions.length).toBeGreaterThan(0);
  });

  async function findRevision(filePath: string, content: string) {
    const history = await request(app).get("/api/history").query({ path: filePath }).set("Host", HOST);
    for (const revision of history.body.revisions) {
      const read = await request(app)
        .get("/api/history/revision")
        .query({ path: filePath, id: revision.id })
        .set("Host", HOST);
      if (read.body.content === content) return revision as { id: string };
    }
    throw new Error(`missing revision ${content}`);
  }

  it("keeps revision history when a diagram is renamed or moved", async () => {
    let saved = await writeNew("Lab/Core.mmd", "before\n");
    const next = await writeNext(saved, "after\n");
    expect(next.status).toBe(200);

    const renamed = await request(app)
      .patch("/api/rename")
      .set(json)
      .send({ from: "Lab/Core.mmd", to: "Lab/Edge.mmd" });
    expect(renamed.status).toBe(200);
    const afterRename = await findRevision("Lab/Edge.mmd", "before\n");
    expect(afterRename.id).toBeTruthy();
    const oldHistory = await request(app)
      .get("/api/history")
      .query({ path: "Lab/Core.mmd" })
      .set("Host", HOST);
    expect(oldHistory.body.revisions).toEqual([]);

    const moved = await request(app)
      .post("/api/move")
      .set(json)
      .send({ from: "Lab/Edge.mmd", toFolder: "Archive" });
    expect(moved.status).toBe(200);
    expect(moved.body.path).toBe("Archive/Edge.mmd");
    await findRevision("Archive/Edge.mmd", "before\n");

    const renamedFolder = await request(app)
      .patch("/api/rename")
      .set(json)
      .send({ from: "Archive", to: "Kept" });
    expect(renamedFolder.status).toBe(200);
    await findRevision("Kept/Edge.mmd", "before\n");
  });

  it("follows history into the trash and back", async () => {
    let saved = await writeNew("Notes.mmd", "before\n");
    const next = await writeNext(saved, "after\n");
    expect(next.status).toBe(200);
    await request(app).delete("/api/item").query({ path: "Notes.mmd" }).set(json);
    const whileTrashed = await request(app)
      .get("/api/history")
      .query({ path: "Notes.mmd" })
      .set("Host", HOST);
    expect(whileTrashed.body.revisions).toEqual([]);

    const listed = await request(app).get("/api/trash").set("Host", HOST);
    await request(app).post("/api/trash/restore").set(json).send({ id: listed.body.items[0].id });
    await findRevision("Notes.mmd", "before\n");
  });

  it("does not overwrite a diagram that changed on disk unless forced", async () => {
    const saved = await writeNew("Notes.mmd", "loaded\n");
    await fs.writeFile(path.join(dir, "Notes.mmd"), "external\n");

    const blind = await request(app)
      .put("/api/file")
      .set(json)
      .send({ path: "Notes.mmd", content: "editor\n" });
    expect(blind.status).toBe(409);
    expect(blind.body.code).toBe("exists");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("external\n");

    const conflict = await writeNext(saved, "editor\n");
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("conflict");
    expect(conflict.body.current.content).toBe("external\n");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("external\n");

    const forced = await writeNext(saved, "editor\n", { force: true });
    expect(forced.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("editor\n");
    await findRevision("Notes.mmd", "external\n");

    await fs.rm(path.join(dir, "Notes.mmd"));
    const missing = await writeNext(saved, "editor\n");
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe("missing");
  });

  it("lets the hash win when the file was touched but the bytes are the same", async () => {
    const saved = await writeNew("Notes.mmd", "loaded\n");
    const conflict = await request(app).put("/api/file").set(json).send({
      path: "Notes.mmd",
      content: "edited\n",
      expectedHash: saved.hash,
      expectedMtimeMs: 1,
    });
    expect(conflict.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("edited\n");
  });

  it("gives one tab the lock and blocks every other writer until it is released or stale", async () => {
    await writeNew("Notes.mmd", "loaded\n");
    const first = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-one" });
    expect(first.status).toBe(200);
    expect(first.body.token).toBeTruthy();
    expect(first.body.heartbeatEveryMs).toBeGreaterThan(0);

    const second = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-two" });
    expect(second.status).toBe(423);
    expect(second.body.code).toBe("locked");

    const readable = await request(app).get("/api/file").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(readable.status).toBe(200);

    const denied = await request(app)
      .put("/api/file")
      .set(json)
      .send({
        path: "Notes.mmd",
        content: "stolen\n",
        expectedHash: readable.body.hash,
        lockToken: "someone-else",
      });
    expect(denied.status).toBe(423);
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe("loaded\n");

    const held = await request(app).put("/api/file").set(json).send({
      path: "Notes.mmd",
      content: "saved\n",
      expectedHash: readable.body.hash,
      lockToken: first.body.token,
    });
    expect(held.status).toBe(200);

    const beat = await request(app)
      .post("/api/lock/heartbeat")
      .set(json)
      .send({ path: "Notes.mmd", token: first.body.token });
    expect(beat.status).toBe(200);

    const sameTab = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-one" });
    expect(sameTab.status).toBe(200);
    expect(sameTab.body.token).toBe(first.body.token);

    const lockedDelete = await request(app).delete("/api/item").query({ path: "Notes.mmd" }).set(json);
    expect(lockedDelete.status).toBe(423);
    const lockedRename = await request(app)
      .patch("/api/rename")
      .set(json)
      .send({ from: "Notes.mmd", to: "Other.mmd" });
    expect(lockedRename.status).toBe(423);

    const released = await request(app)
      .post("/api/lock/release")
      .set(json)
      .send({ path: "Notes.mmd", token: first.body.token });
    expect(released.status).toBe(204);
    const taken = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-two" });
    expect(taken.status).toBe(200);
  });

  it("lets a new session take a lock after the heartbeat expires or the holder process is gone", async () => {
    await writeNew("Notes.mmd", "loaded\n");
    const first = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-one" });
    const lockPath = path.join(dir, ".meta", "locks", `${encodeStorageKey("Notes.mmd")}.json`);
    const record = JSON.parse(await fs.readFile(lockPath, "utf8")) as { heartbeatAt: string; pid: number };
    record.heartbeatAt = new Date(Date.now() - 120_000).toISOString();
    record.pid = process.pid;
    await fs.writeFile(lockPath, JSON.stringify(record));

    const stolen = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-two" });
    expect(stolen.status).toBe(200);
    expect(stolen.body.token).not.toBe(first.body.token);
    const oldWrite = await request(app).put("/api/file").set(json).send({
      path: "Notes.mmd",
      content: "old-tab\n",
      force: true,
      lockToken: first.body.token,
    });
    expect(oldWrite.status).toBe(423);

    const dead = JSON.parse(await fs.readFile(lockPath, "utf8")) as { heartbeatAt: string; pid: number };
    dead.pid = 2_147_483_646;
    dead.heartbeatAt = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify(dead));
    const recovered = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Notes.mmd", sessionId: "tab-three" });
    expect(recovered.status).toBe(200);
  });

  it("refuses a folder change while a diagram inside it is open", async () => {
    await writeNew("Lab/One.mmd", "flowchart LR\n  A-->B\n");
    const lock = await request(app)
      .post("/api/lock")
      .set(json)
      .send({ path: "Lab/One.mmd", sessionId: "tab-one" });
    expect(lock.status).toBe(200);
    const removed = await request(app).delete("/api/item").query({ path: "Lab" }).set(json);
    expect(removed.status).toBe(423);
    expect(await fs.readFile(path.join(dir, "Lab", "One.mmd"), "utf8")).toContain("A-->B");
  });

  it("rejects a hidden path, a cross-origin lock, and a non-JSON lock request", async () => {
    const hidden = await request(app)
      .put("/api/file")
      .set(json)
      .send({ path: ".secret.mmd", content: "flowchart LR\n  A-->B\n" });
    expect(hidden.status).toBe(400);
    await expect(fs.access(path.join(dir, ".secret.mmd"))).rejects.toThrow();

    const cross = await request(app)
      .post("/api/trash/empty")
      .set("Host", HOST)
      .set("Origin", "https://evil.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Content-Type", "application/json")
      .send({});
    expect(cross.status).toBe(403);

    const form = await request(app)
      .post("/api/lock")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("path=Notes.mmd");
    expect(form.status).toBe(415);
  });

  it("refuses to rename onto an existing diagram", async () => {
    await writeNew("A.mmd", "flowchart LR\n  A-->B\n");
    await writeNew("B.mmd", "flowchart LR\n  C-->D\n");
    const renamed = await request(app).patch("/api/rename").set(json).send({ from: "A.mmd", to: "B.mmd" });
    expect(renamed.status).toBe(409);
    expect(renamed.body.code).toBe("collision");
    expect(await fs.readFile(path.join(dir, "B.mmd"), "utf8")).toContain("C-->D");
  });
});
