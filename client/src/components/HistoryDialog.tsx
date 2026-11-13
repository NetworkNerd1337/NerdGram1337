import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { FileWriteResult, RevisionSummary } from "../types";

type HistoryDialogProps = {
  path: string;
  lockToken: string | null;
  canRestore: boolean;
  onClose: () => void;
  onRestored: (file: FileWriteResult & { content: string }) => void;
};

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function HistoryDialog({
  path,
  lockToken,
  canRestore,
  onClose,
  onRestored,
}: HistoryDialogProps) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [retention, setRetention] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.history(path);
        if (cancelled) return;
        setRevisions(data.revisions);
        setRetention(data.retention);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load history");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const viewRevision = async (id: string) => {
    setSelected(id);
    setError(null);
    try {
      const revision = await api.historyRevision(path, id);
      setPreview(revision.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that revision");
    }
  };

  const restore = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const file = await api.restoreRevision(path, id, lockToken);
      onRestored(file);
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not restore that revision";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="history-title">Version history</h3>
        <p>
          Each save keeps the previous contents. The last {retention ?? 20} revisions
          are kept. Restoring saves the current text as a revision first.
        </p>
        {error && <div className="error-banner">{error}</div>}
        {revisions.length === 0 ? (
          <div className="empty-state">No earlier versions yet.</div>
        ) : (
          <ul className="history-list">
            {revisions.map((revision) => (
              <li key={revision.id} className="history-item">
                <div>
                  <strong>{formatStamp(revision.createdAt)}</strong>
                  <div className="history-meta">{revision.size} bytes</div>
                </div>
                <div className="history-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => void viewRevision(revision.id)}>
                    View
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canRestore || busy}
                    onClick={() => void restore(revision.id)}
                  >
                    Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <pre className="history-preview" aria-label="Revision preview">
            {preview}
          </pre>
        )}
        {!canRestore && revisions.length > 0 && (
          <p>This diagram is read-only in this window, so restore is unavailable.</p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
