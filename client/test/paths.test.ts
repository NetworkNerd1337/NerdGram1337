import { describe, expect, it } from "vitest";
import { basename, displayName, ensureMmd, joinPath, parentPath } from "../src/lib/paths";

describe("diagram paths", () => {
  it("joins folder and file names", () => {
    expect(joinPath("", "Welcome.mmd")).toBe("Welcome.mmd");
    expect(joinPath("Examples/", "/Sequence.mmd")).toBe("Examples/Sequence.mmd");
  });

  it("splits parents and display names", () => {
    expect(parentPath("Examples/Sequence.mmd")).toBe("Examples");
    expect(parentPath("Welcome.mmd")).toBe("");
    expect(basename("Examples/Sequence.mmd")).toBe("Sequence.mmd");
    expect(displayName("Examples/Sequence.mmd")).toBe("Sequence");
  });

  it("adds the .mmd extension once", () => {
    expect(ensureMmd("Welcome")).toBe("Welcome.mmd");
    expect(ensureMmd("Welcome.mmd")).toBe("Welcome.mmd");
    expect(ensureMmd("  ")).toBe("Untitled.mmd");
  });
});
