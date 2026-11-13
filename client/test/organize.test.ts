import { describe, expect, it } from "vitest";
import {
  destinationPath,
  diagramNameFromImport,
  dropMoveState,
  moveBlockReason,
  nextAvailablePath,
  relocatedFolder,
} from "../src/lib/organize";

describe("move targets", () => {
  it("rejects the current folder, a folder moved into itself, and a descendant", () => {
    expect(moveBlockReason("Lab/Notes.mmd", false, "Lab")).toMatch(/already in this folder/);
    expect(moveBlockReason("Lab/Notes.mmd", false, "Archive")).toBeNull();
    expect(moveBlockReason("Lab/Notes.mmd", false, "")).toBeNull();
    expect(moveBlockReason("Lab", true, "Lab")).toMatch(/itself/);
    expect(moveBlockReason("Lab", true, "Lab/Nested")).toMatch(/itself/);
    expect(moveBlockReason("Lab", true, "Archive")).toBeNull();
    expect(moveBlockReason("Lab", true, "")).toMatch(/already in this folder/);
    expect(moveBlockReason("Lab/Nested", true, "")).toBeNull();
  });

  it("rejects a drop that would overwrite, and follows a moved folder", () => {
    const taken = new Set(["Archive/Notes.mmd", "Lab"]);
    expect(dropMoveState({ path: "Notes.mmd", type: "file" }, "Archive", taken).ok).toBe(false);
    expect(dropMoveState({ path: "Notes.mmd", type: "file" }, "Other", taken)).toEqual({ ok: true });
    expect(dropMoveState({ path: "Lab", type: "folder" }, "Lab/Nested", taken).ok).toBe(false);
    expect(destinationPath("Lab/Notes.mmd", "")).toBe("Notes.mmd");
    expect(destinationPath("Lab/Notes.mmd", "Archive")).toBe("Archive/Notes.mmd");
    expect(relocatedFolder("Lab/Nested", "Lab", "Archive/Lab", true)).toBe("Archive/Lab/Nested");
    expect(relocatedFolder("Other", "Lab", "Archive/Lab", true)).toBe("Other");
    expect(relocatedFolder("Lab", "Lab/Notes.mmd", "Notes.mmd", false)).toBe("Lab");
  });
});

describe("collision-safe names", () => {
  it("uses Name (copy) for duplicates and Name 2 for imports", () => {
    const taken = new Set(["Notes.mmd", "Notes (copy).mmd"]);
    expect(nextAvailablePath("Notes.mmd", (candidate) => taken.has(candidate), "copy")).toBe(
      "Notes (copy 2).mmd",
    );
    expect(
      nextAvailablePath("Lab/Notes.mmd", (candidate) => candidate === "Lab/Notes.mmd"),
    ).toBe("Lab/Notes 2.mmd");
    expect(nextAvailablePath("Lab", (candidate) => candidate === "Lab", "copy")).toBe("Lab (copy)");
    expect(nextAvailablePath("Fresh.mmd", () => false, "copy")).toBe("Fresh.mmd");
  });

  it("keeps import names inside one path segment", () => {
    expect(diagramNameFromImport("..\\..\\Notes.md")).toEqual({ name: "Notes.mmd" });
    expect(diagramNameFromImport("rack/Firewall Rules.TXT")).toEqual({ name: "Firewall Rules.mmd" });
    expect(diagramNameFromImport(".hidden.mmd").error).toMatch(/not allowed/);
    expect(diagramNameFromImport("photo.png").error).toMatch(/\.mmd, \.md, and \.txt/);
  });
});
