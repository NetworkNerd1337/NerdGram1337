import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { highlightSelectionMatches } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import { mermaid } from "codemirror-lang-mermaid";
import { useMemo } from "react";
import { mermaidCompletionSource } from "../lib/mermaidCompletions";
import { lintMermaidDoc } from "../lib/mermaidLint";

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
