import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSafePath } from "../src/paths.js";
import { makeTempDataDir } from "./helpers.js";

describe("resolveSafePath", () => {
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

  it("resolves a relative diagram path inside the data root", () => {
    expect(resolveSafePath("Examples/Sequence.mmd")).toBe(
      path.join(dir, "Examples", "Sequence.mmd"),
    );
  });

  it("treats an empty path as the data root", () => {
    expect(resolveSafePath("")).toBe(dir);
    expect(resolveSafePath(".")).toBe(dir);
  });

  it("rejects parent-directory escapes", () => {
    expect(() => resolveSafePath("..")).toThrow(/escapes data directory/);
    expect(() => resolveSafePath("../outside.mmd")).toThrow(/escapes data directory/);
    expect(() => resolveSafePath("folder/../../outside.mmd")).toThrow(/escapes data directory/);
    expect(() => resolveSafePath("..\\..\\outside.mmd")).toThrow(/escapes data directory/);
  });

  it("keeps a leading-slash absolute path inside the data root", () => {
    const resolved = resolveSafePath("/tmp/pwn.mmd");
    expect(resolved.startsWith(dir + path.sep)).toBe(true);
    expect(resolved).toBe(path.join(dir, "tmp", "pwn.mmd"));
  });

  it("rejects a null byte", () => {
    expect(() => resolveSafePath("safe\0.mmd")).toThrow(/Invalid path/);
  });

  it("rejects hidden bookkeeping paths", () => {
    expect(() => resolveSafePath(".meta")).toThrow(/Invalid path/);
    expect(() => resolveSafePath(".meta/trash/items/x")).toThrow(/Invalid path/);
    expect(() => resolveSafePath("Lab/.secret.mmd")).toThrow(/Invalid path/);
  });

  it("does not create a file outside the data root when a traversal is rejected", async () => {
    const outside = path.join(path.dirname(dir), "nerdgram-escaped.mmd");
    expect(() => resolveSafePath("../nerdgram-escaped.mmd")).toThrow(/escapes/);
    await expect(fs.access(outside)).rejects.toThrow();
  });
});
