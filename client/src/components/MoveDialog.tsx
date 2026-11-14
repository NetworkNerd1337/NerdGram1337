import { useMemo, useState } from "react";
import { api, ApiError } from "../api";
import {
  collectPaths,
  destinationPath,
  explainOrganizeError,
  moveBlockReason,
  nextAvailablePath,
} from "../lib/organize";
import { dataMoveSentence } from "../lib/dataFiles";
import { basename, displayName } from "../lib/paths";
import type { TreeNode } from "../types";
import { AffectedLinksDialog } from "./AffectedLinksDialog";
import { FolderPicker } from "./FolderPicker";

type MoveDialogProps = {
  itemPath: string;
  isFolder: boolean;
  tree: TreeNode[];
  initialFolder: string;
  onClose: () => void;
  onMoved: (from: string, to: string, detail?: string) => void;
};

function startingFolder(itemPath: string, isFolder: boolean, preferred: string): string {
  if (!moveBlockReason(itemPath, isFolder, preferred)) return preferred;
  if (!moveBlockReason(itemPath, isFolder, "")) return "";
  return preferred;
}

export function MoveDialog({
  itemPath,
  isFolder,
  tree,
  initialFolder,
  onClose,
  onMoved,
}: MoveDialogProps) {
  const [folder, setFolder] = useState(() => startingFolder(itemPath, isFolder, initialFolder));
  const [error, setError] = useState<string | null>(null);
  const [suggestedPath, setSuggestedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkFiles, setLinkFiles] = useState<string[] | null>(null);
  const [pending, setPending] = useState<null | { kind: "move" } | { kind: "rename"; to: string }>(null);
  const taken = useMemo(() => collectPaths(tree), [tree]);
  const blocked = moveBlockReason(itemPath, isFolder, folder);
  const dest = destinationPath(itemPath, folder);
  const collision = !blocked && taken.has(dest);
  const clientSuggestion = collision ? nextAvailablePath(dest, (candidate) => taken.has(candidate), "copy") : null;
  const renameTarget = suggestedPath || clientSuggestion;
  const label = displayName(itemPath) || basename(itemPath);

  const moveAsCopy = async () => {
    if (!renameTarget) {
      setError("No free name is available in that folder.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.rename(itemPath, renameTarget);
      onMoved(itemPath, result.path, dataMoveSentence(result.dataFiles ?? []));
    } catch (err) {
      if (err instanceof ApiError && err.code === "links") {
        setPending({ kind: "rename", to: renameTarget });
        setLinkFiles(err.files ?? []);
        return;
      }
      if (err instanceof ApiError && err.code === "collision" && err.suggestedPath) {
        setSuggestedPath(err.suggestedPath);
      }
      setError(explainOrganizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const moveHere = async () => {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.move(itemPath, folder);
      onMoved(itemPath, result.path, dataMoveSentence(result.dataFiles ?? []));
    } catch (err) {
      if (err instanceof ApiError && err.code === "links") {
        setPending({ kind: "move" });
        setLinkFiles(err.files ?? []);
        return;
      }
      if (err instanceof ApiError && err.code === "collision") {
        if (err.suggestedPath) setSuggestedPath(err.suggestedPath);
        setError("Something already exists at that path. You can move it under a new name.");
        return;
      }
      setError(explainOrganizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmLinks = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        pending.kind === "rename"
          ? await api.rename(itemPath, pending.to, true)
          : await api.move(itemPath, folder, true);
      setLinkFiles(null);
      setPending(null);
      onMoved(itemPath, result.path, dataMoveSentence(result.dataFiles ?? []));
    } catch (err) {
      setError(explainOrganizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    {linkFiles ? (
      <AffectedLinksDialog
        title="Update diagram links?"
        intro="These diagrams have click links that point here. Moving updates those links."
        files={linkFiles}
        confirmLabel="Move and update links"
        busy={busy}
        onClose={() => {
          if (busy) return;
          setLinkFiles(null);
          setPending(null);
        }}
        onConfirm={() => void confirmLinks()}
      />
    ) : null}
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (collision) void moveAsCopy();
          else void moveHere();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h3 id="move-dialog-title">Move “{label}”</h3>
        <p id="move-dialog-help">
          Choose a folder. Arrow keys move through the list. You can also drag this item onto a
          folder. Trash is not a destination.
        </p>
        <FolderPicker
          tree={tree}
          value={folder}
          onChange={(path) => {
            setFolder(path);
            setSuggestedPath(null);
            setError(null);
          }}
          disabledReason={(path) => moveBlockReason(itemPath, isFolder, path)}
        />
        {blocked ? <p className="dialog-note">{blocked}</p> : null}
        {collision ? (
          <p className="dialog-note">
            <strong>{basename(itemPath)}</strong> is already in that folder. Nothing is overwritten.
            {renameTarget ? ` Move it as ${basename(renameTarget)} instead, or pick another folder.` : null}
          </p>
        ) : null}
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {collision ? (
            <button type="submit" className="btn btn-primary" disabled={busy || !renameTarget}>
              {renameTarget ? `Move as ${basename(renameTarget)}` : "No free name"}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={busy || Boolean(blocked)}>
              Move here
            </button>
          )}
        </div>
      </form>
    </div>
    </>
  );
}
