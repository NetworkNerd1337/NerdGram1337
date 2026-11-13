import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicWriteText,
  decodeStorageKey,
  encodeStorageKey,
  evaluateWrite,
  hashContent,
  resolveAvailablePath,
  type DiskState,
} from "../src/storage.js";
import { makeTempDataDir } from "./helpers.js";

const sample = (hash: string, mtimeMs = 1_000): DiskState => ({
  exists: true,
  content: "old",
  mtimeMs,
  size: 3,
  hash,
});

describe("evaluateWrite", () => {
  const hash = hashContent("old");

  it("creates when the file is missing and there is no baseline", () => {
    expect(evaluateWrite({ exists: false }, { content: "new" })).toEqual({ action: "create" });
  });

  it("reports a missing file when the editor still has a baseline", () => {
    expect(
      evaluateWrite({ exists: false }, { content: "new", expectedHash: hash }),
    ).toEqual({ action: "reject", code: "missing" });
  });

  it("creates over a missing file when forced", () => {
    expect(
      evaluateWrite({ exists: false }, { content: "new", expectedHash: hash, force: true }),
    ).toEqual({ action: "create" });
  });

  it("does nothing when the bytes already match", () => {
    expect(
      evaluateWrite(sample(hash), { content: "old", expectedHash: "stale" }),
    ).toEqual({ action: "unchanged" });
  });

  it("refuses a blind overwrite", () => {
    expect(evaluateWrite(sample(hash), { content: "new" })).toEqual({
      action: "reject",
      code: "exists",
    });
  });

  it("overwrites when forced", () => {
    expect(evaluateWrite(sample(hash), { content: "new", force: true })).toEqual({
      action: "overwrite",
    });
  });

  it("trusts a matching hash ahead of a drifted mtime", () => {
    expect(
      evaluateWrite(sample(hash, 5_000), {
        content: "new",
        expectedHash: hash,
        expectedMtimeMs: 1,
      }),
    ).toEqual({ action: "overwrite" });
  });

  it("conflicts when the hash does not match", () => {
    expect(
      evaluateWrite(sample(hash, 5_000), {
        content: "new",
        expectedHash: hashContent("other"),
        expectedMtimeMs: 5_000,
      }),
    ).toEqual({ action: "reject", code: "conflict" });
  });

  it("uses mtime when the client did not send a hash", () => {
    expect(
      evaluateWrite(sample(hash, 5_000), { content: "new", expectedMtimeMs: 5_000 }),
    ).toEqual({ action: "overwrite" });
    expect(
      evaluateWrite(sample(hash, 5_000), { content: "new", expectedMtimeMs: 1 }),
    ).toEqual({ action: "reject", code: "conflict" });
  });
});

describe("resolveAvailablePath", () => {
  it("returns the desired path when it is free", async () => {
    await expect(resolveAvailablePath("Notes.mmd", () => false)).resolves.toBe("Notes.mmd");
  });

  it("adds a labeled suffix, then a number, for a taken path", async () => {
    const taken = new Set(["Lab/Notes.mmd", "Lab/Notes (copy).mmd"]);
    await expect(
      resolveAvailablePath("Lab/Notes.mmd", (candidate) => taken.has(candidate), { word: "copy" }),
    ).resolves.toBe("Lab/Notes (copy 2).mmd");
  });

  it("uses a numeric suffix when no word is given", async () => {
    const taken = new Set(["Folder"]);
    await expect(resolveAvailablePath("Folder", (candidate) => taken.has(candidate))).resolves.toBe(
      "Folder 2",
    );
  });
});

describe("storage keys and atomic writes", () => {
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

  it("round-trips a diagram path through a single path segment", () => {
    const key = encodeStorageKey("Lab/My Diagram.mmd");
    expect(key.includes("/")).toBe(false);
    expect(decodeStorageKey(key)).toBe("Lab/My Diagram.mmd");
  });

  it("replaces a file without leaving a temp file or changing the bytes", async () => {
    const target = path.join(dir, "Plain.mmd");
    const content = "flowchart LR\n  A-->B\n";
    await atomicWriteText(target, content);
    expect(await fs.readFile(target, "utf8")).toBe(content);
    const names = await fs.readdir(dir);
    expect(names.filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});
