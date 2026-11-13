// @vitest-environment happy-dom
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { lintDiagram } from "../../server/src/diagramLint.ts";
import { applyLintFix, undoLintFixOrHistory } from "../src/lib/lintActions";

describe("editor quick fixes", () => {
  it("undoes a jump with the undo key and a rename with editor history", () => {
    const source = "flowchart LR\n  A[One]\n  A[Two]\n";
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: source, extensions: [history()] }),
    });
    const diagnostics = lintDiagram(source);
    const jump = diagnostics.flatMap((item) => item.fixes).find((item) => item.id === "jump-to-definition");
    const rename = diagnostics.flatMap((item) => item.fixes).find((item) => item.id === "rename-duplicate");
    expect(jump && rename).toBeTruthy();
    if (!jump || !rename) return;

    applyLintFix(view, jump);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("A");
    expect(undoLintFixOrHistory(view)).toBe(true);
    expect(view.state.selection.main.from).toBe(0);

    applyLintFix(view, rename);
    expect(view.state.doc.toString()).toContain("A2[Two]");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);

    view.destroy();
  });
});