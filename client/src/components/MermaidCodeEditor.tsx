import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { forceLinting, linter, lintGutter } from "@codemirror/lint";
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
import { useEffect, useMemo } from "react";
import { bindEditorView, editorSearchExtensions, getEditorView } from "../lib/editorCommands";
import { mermaidCompletionSource } from "../lib/mermaidCompletions";
import { commentEdit } from "../lib/mermaidComments";
import { undoLintFixOrHistory } from "../lib/lintActions";
import { LINT_RULES_EVENT, readLintRules } from "../lib/lintSettings";
import { LINT_DELAY_MS, lintMermaidDoc, toCodeMirrorDiagnostics, type ReportedDiagnostic } from "../lib/mermaidLint";

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

let diagnosticListener: ((diagnostics: ReportedDiagnostic[]) => void) | undefined;

type MermaidCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  diagramPaths?: readonly string[];
  sourcePath?: string;
  onDiagnostics?: (diagnostics: ReportedDiagnostic[]) => void;
  "aria-label"?: string;
};

export function MermaidCodeEditor({
  value,
  onChange,
  readOnly = false,
  diagramPaths,
  sourcePath = "",
  onDiagnostics,
  "aria-label": ariaLabel = "Mermaid source editor",
}: MermaidCodeEditorProps) {
  const pathsKey = diagramPaths?.join("\n") ?? "";

  useEffect(() => {
    diagnosticListener = onDiagnostics;
    return () => {
      if (diagnosticListener === onDiagnostics) diagnosticListener = undefined;
    };
  });

  useEffect(() => () => bindEditorView(null), []);

  useEffect(() => {
    const refresh = () => {
      const view = getEditorView();
      if (view) forceLinting(view);
    };
    window.addEventListener(LINT_RULES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LINT_RULES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

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
      ...editorSearchExtensions(),
      mermaid(),
      oneDark,
      lintGutter(),
      linter(
        async (view) => {
          const text = view.state.doc.toString();
          const items = await lintMermaidDoc(text, {
            rules: readLintRules(),
            diagramPaths: pathsKey ? pathsKey.split("\n") : undefined,
            sourcePath,
          });
          if (view.state.doc.toString() !== text) return [];
          diagnosticListener?.(items);
          return toCodeMirrorDiagnostics(items);
        },
        { delay: LINT_DELAY_MS },
      ),
      autocompletion({
        override: [
          (context) =>
            mermaidCompletionSource(context, {
              diagramPaths: pathsKey ? pathsKey.split("\n") : [],
              sourcePath,
            }),
        ],
        activateOnTyping: true,
        icons: true,
      }),
      keymap.of([
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      Prec.high(keymap.of([{ key: "Mod-z", run: undoLintFixOrHistory, preventDefault: true }])),
      Prec.high(keymap.of([{ key: "Mod-/", run: toggleMermaidComment, preventDefault: true }])),
      EditorState.tabSize.of(2),
      EditorState.readOnly.of(readOnly),
    ],
    [pathsKey, readOnly, sourcePath],
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
        onCreateEditor={(view) => bindEditorView(view)}
      />
    </div>
  );
}
