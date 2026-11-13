import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { ImportCollisionChoice, ImportDraft } from "../lib/importDrafts";
import { MAX_IMPORT_FILES } from "../lib/importDrafts";
import { parseMermaid } from "../lib/mermaidRender";
import { collectPaths, explainOrganizeError, nextAvailablePath } from "../lib/organize";
import { displayName, joinPath } from "../lib/paths";
import type { ImportFileResult, TreeNode } from "../types";
import { FolderPicker } from "./FolderPicker";

type ImportDialogProps = {
  tree: TreeNode[];
  folder: string;
  drafts: ImportDraft[];
  onFolderChange: (folder: string) => void;
  onClose: () => void;
  onDone: (message: string, close: boolean) => void;
};

type Planned = {
  draft: ImportDraft;
  path: string;
  conflict: boolean;
  suggested: string | null;
};

function planImports(
  folder: string,
  drafts: ImportDraft[],
  taken: Set<string>,
  choices: Record<string, ImportCollisionChoice | "">,
): Planned[] {
  const reserved = new Set<string>();
  return drafts.map((draft) => {
    if (draft.error || !draft.diagramName) {
      return { draft, path: "", conflict: false, suggested: null };
    }
    const path = joinPath(folder, draft.diagramName);
    const isTaken = (candidate: string) => taken.has(candidate) || reserved.has(candidate);
    const conflict = isTaken(path);
    const choice = choices[draft.id];
    if (!conflict) {
      reserved.add(path);
      return { draft, path, conflict, suggested: null };
    }
    const suggested = nextAvailablePath(path, isTaken);
    if (choice === "rename" && suggested) reserved.add(suggested);
    if (choice === "replace") reserved.add(path);
    return { draft, path, conflict, suggested };
  });
}

export function ImportDialog({
  tree,
  folder,
  drafts,
  onFolderChange,
  onClose,
  onDone,
}: ImportDialogProps) {
  const [rows, setRows] = useState(drafts);
  const [choices, setChoices] = useState<Record<string, ImportCollisionChoice | "">>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = useMemo(() => collectPaths(tree), [tree]);
  const planned = useMemo(
    () => planImports(folder, rows, taken, choices),
    [folder, rows, taken, choices],
  );
  const parseKey = useMemo(
    () => rows.map((draft) => `${draft.id}\n${draft.text}`).join("\n---\n"),
    [rows],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const draft of rows) {
        if (draft.error) continue;
        if (!draft.text.trim()) {
          next[draft.id] = "This file is empty. You can still import it and edit it later.";
          continue;
        }
        try {
          await parseMermaid(draft.text);
        } catch {
          next[draft.id] = "This may not render until you fix it in the editor. You can still import it.";
        }
      }
      if (!cancelled) setWarnings(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, parseKey]);

  const pendingChoice = planned.some(
    (item) => item.conflict && !item.draft.error && !choices[item.draft.id],
  );
  const sendable = planned.filter((item) => !item.draft.error && item.draft.diagramName);
  const tooMany = sendable.length > MAX_IMPORT_FILES;

  const setAll = (choice: ImportCollisionChoice) => {
    setChoices((current) => {
      const next = { ...current };
      for (const item of planned) {
        if (item.conflict) next[item.draft.id] = choice;
      }
      return next;
    });
  };

  const submit = async () => {
    if (pendingChoice || sendable.length === 0 || tooMany) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importFiles(
        folder,
        sendable.map((item) => ({
          name: item.draft.sourceName,
          text: item.draft.text,
          onCollision: item.conflict ? (choices[item.draft.id] as ImportCollisionChoice) : undefined,
        })),
      );
      const failed = result.results.filter(
        (item) => item.status === "error" || item.status === "collision",
      );
      if (failed.length > 0) {
        const failedIds = new Set<string>();
        sendable.forEach((entry, index) => {
          const status = result.results[index]?.status;
          if (status === "error" || status === "collision" || !status) failedIds.add(entry.draft.id);
        });
        setRows((current) => current.filter((draft) => draft.error || failedIds.has(draft.id)));
        setError(failed.map((item) => `${item.name}: ${item.error || "Could not import."}`).join(" "));
        onDone(summarize(result.results), false);
        return;
      }
      onDone(summarize(result.results), true);
    } catch (err) {
      setError(explainOrganizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <form
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <h3 id="import-dialog-title">Import diagrams</h3>
        <p>
          Text files only: .mmd, .md, or .txt, up to 512 KB each. They are copied into the folder
          you pick. A name that is already there is never replaced unless you choose Replace.
        </p>
        <FolderPicker tree={tree} value={folder} onChange={onFolderChange} />
        <div className="import-list">
          {planned.map((item) => (
            <div key={item.draft.id} className="import-row">
              <strong>{item.draft.sourceName}</strong>
              {item.draft.error ? <p className="import-error">{item.draft.error}</p> : null}
              {!item.draft.error && item.path ? (
                <p className="import-meta">Saves as {item.path}</p>
              ) : null}
              {warnings[item.draft.id] ? <p className="import-warning">{warnings[item.draft.id]}</p> : null}
              {item.conflict ? (
                <label>
                  This name is taken
                  <select
                    aria-label={`What to do with ${item.draft.sourceName}`}
                    value={choices[item.draft.id] ?? ""}
                    onChange={(event) =>
                      setChoices((current) => ({
                        ...current,
                        [item.draft.id]: event.target.value as ImportCollisionChoice | "",
                      }))
                    }
                  >
                    <option value="">Choose…</option>
                    <option value="rename">
                      Rename to {item.suggested ? displayName(item.suggested) : "a free name"}
                    </option>
                    <option value="skip">Skip</option>
                    <option value="replace">Replace the existing diagram</option>
                  </select>
                </label>
              ) : null}
            </div>
          ))}
        </div>
        {planned.some((item) => item.conflict) ? (
          <div className="import-bulk">
            <button type="button" className="btn btn-ghost" onClick={() => setAll("rename")}>
              Rename all
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAll("skip")}>
              Skip all
            </button>
          </div>
        ) : null}
        {tooMany ? <p className="import-error">Import up to {MAX_IMPORT_FILES} files at a time.</p> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || pendingChoice || sendable.length === 0 || tooMany}
          >
            {sendable.length === 0 ? "Nothing to import" : `Import ${sendable.length}`}
          </button>
        </div>
      </form>
    </div>
  );
}

function summarize(results: ImportFileResult[]): string {
  const saved = results.filter(
    (item) => item.status === "created" || item.status === "renamed" || item.status === "replaced",
  ).length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  const failed = results.filter((item) => item.status === "error" || item.status === "collision").length;
  const parts = [`Imported ${saved} diagram${saved === 1 ? "" : "s"}`];
  if (skipped > 0) parts.push(`skipped ${skipped}`);
  if (failed > 0) parts.push(`${failed} could not be imported`);
  return `${parts.join(", ")}.`;
}
