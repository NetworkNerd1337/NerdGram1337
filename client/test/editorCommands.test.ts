import { describe, expect, it } from "vitest";
import { searchKeymap } from "@codemirror/search";
import {
  editorSearchKeymap,
  FIND_SHORTCUT,
  GO_TO_LINE_SHORTCUT,
  isBlockedEditorShortcut,
} from "../src/lib/editorCommands";

describe("editor find and go-to-line shortcuts", () => {
  it("keeps CodeMirror find and go-to-line and drops shortcuts the browser or the app already use", () => {
    const keys = editorSearchKeymap.map((binding) => binding.key);
    expect(keys).toContain(FIND_SHORTCUT);
    expect(keys).toContain(GO_TO_LINE_SHORTCUT);
    expect(searchKeymap.some((binding) => binding.key === "Mod-f")).toBe(true);
    for (const key of keys) {
      expect(isBlockedEditorShortcut(key)).toBe(false);
    }
    expect(isBlockedEditorShortcut("Mod-d")).toBe(true);
    expect(isBlockedEditorShortcut("Mod-/")).toBe(true);
    expect(isBlockedEditorShortcut("F5")).toBe(true);
    expect(isBlockedEditorShortcut("Mod-Shift-Enter")).toBe(true);
    expect(isBlockedEditorShortcut("Mod-l")).toBe(true);
  });
});
