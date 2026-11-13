import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { highlightSelectionMatches } from "@codemirror/search";
import { EditorState, Prec, type ChangeSpec } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type EditorView,
} from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import { mermaid } from "codemirror-lang-mermaid";
import { useMemo } from "react";
import { mermaidCompletionSource } from "../lib/mermaidCompletions";
import { commentEdit } from "../lib/mermaidComments";
import { lintMermaidDoc } from "../lib/mermaidLint";

function toggleMermaidComment(view: EditorView): boolean {
  const lineNumbers = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const from = view.state.doc.lineAt(range.from).number;
    let to = view.state.doc.lineAt(range.to).number;
    if (!range.empty && range.to === view.state.doc.line(to).from && to > from) to -= 1;
    for (let number = from; number <= to; number += 1) lineNumbers.add(number);
  }
  const ordered = [...lineNumbers].sort((a, b) => a - b);
  const edited = commentEdit(ordered.map((number) => view.state.doc.line(number).text));
  const changes: ChangeSpec[] = [];
  ordered.forEach((number, index) => {
    const line = view.state.doc.line(number);
    const next = edited[index] ?? line.text;
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
  });
  if (changes.length > 0) view.dispatch({ changes });
  return true;
}

type MermaidCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  "aria-label"?: string;
};

export function MermaidCodeEditor({
  value,
  onChange,
  readOnly = false,
  "aria-label": ariaLabel = "Mermaid source editor",
}: MermaidCodeEditorProps) {
  const extensions = useMemo(
    () => [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      history(),
      foldGutter(),
      highlightSelectionMatches(),
      mermaid(),
      oneDark,
      lintGutter(),
      linter(
        async (view) => lintMermaidDoc(view.state.doc.toString()),
        { delay: 400 },
      ),
      autocompletion({
        override: [mermaidCompletionSource],
        activateOnTyping: true,
        icons: true,
      }),
      keymap.of([
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      Prec.high(keymap.of([{ key: "Mod-/", run: toggleMermaidComment, preventDefault: true }])),
      EditorState.tabSize.of(2),
      EditorState.readOnly.of(readOnly),
    ],
    [readOnly],
  );

  return (
    <div className="mermaid-code-editor" aria-label={ariaLabel}>
      <CodeMirror
        value={value}
        height="100%"
        theme="dark"
        basicSetup={false}
        editable={!readOnly}
        readOnly={readOnly}
        extensions={extensions}
        onChange={onChange}
      />
    </div>
  );
}
