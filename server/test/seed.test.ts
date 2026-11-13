import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedEmptyDataDir } from "../src/seed.js";
import { makeTempDataDir } from "./helpers.js";

describe("sample seed", () => {
  let cleanup = async () => {};

  afterEach(async () => {
    await cleanup();
    cleanup = async () => {};
  });

  it("copies the samples into an empty data directory and does not overwrite later", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    expect(await seedEmptyDataDir()).toBe(true);
    const welcome = path.join(temp.dir, "Welcome.mmd");
    const original = await fs.readFile(welcome, "utf8");
    expect(original.length).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(temp.dir, "Examples", "Sequence.mmd"), "utf8")).toContain("sequence");
    await fs.writeFile(welcome, "flowchart LR\n  Edited\n");
    expect(await seedEmptyDataDir()).toBe(false);
    expect(await fs.readFile(welcome, "utf8")).toContain("Edited");
  });
});
