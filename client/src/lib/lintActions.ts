import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { LintFix } from "../../../server/src/diagramLint.ts";

type JumpMark = {
  doc: string;
  from: number;
  to: number;
  jumpedFrom: number;
  jumpedTo: number;
};

const jumpMarks: JumpMark[] = [];

/** Apply a quick fix. Text edits join the editor undo stack. A jump can be undone with the same undo key. */
export function applyLintFix(view: EditorView, fix: LintFix): boolean {
  if (fix.edits.length > 0) {
    jumpMarks.length = 0;
    view.focus();
    view.dispatch({ changes: fix.edits, userEvent: "input" });
    return true;
  }
  if (!fix.jump) return false;
  const current = view.state.selection.main;
  jumpMarks.push({
    doc: view.state.doc.toString(),
    from: current.from,
    to: current.to,
    jumpedFrom: fix.jump.from,
    jumpedTo: fix.jump.to,
  });
  view.focus();
  view.dispatch({
    selection: { anchor: fix.jump.from, head: fix.jump.to },
    scrollIntoView: true,
  });
  return true;
}

/**
 * Undo a jump back to the previous cursor when the document has not changed.
 * Otherwise this is the normal editor undo, so a rename, a removed class, or
 * a created class comes back with Ctrl+Z (Cmd+Z on a Mac).
 */
export function undoLintFixOrHistory(view: EditorView): boolean {
  const top = jumpMarks.at(-1);
  if (top && top.doc === view.state.doc.toString()) {
    const selection = view.state.selection.main;
    if (selection.from === top.jumpedFrom && selection.to === top.jumpedTo) {
      jumpMarks.pop();
      view.dispatch({
        selection: { anchor: top.from, head: top.to },
        scrollIntoView: true,
      });
      return true;
    }
  }
  return undo(view);
}
