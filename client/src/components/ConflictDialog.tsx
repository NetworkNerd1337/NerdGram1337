type ConflictDialogProps = {
  mine: string;
  disk: string;
  onReload: () => void;
  onOverwrite: () => void;
  onKeep: () => void;
};

export function ConflictDialog({
  mine,
  disk,
  onReload,
  onOverwrite,
  onKeep,
}: ConflictDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onKeep}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="conflict-title">This diagram changed on disk</h3>
        <p>
          Autosave is paused. The copy in the editor and the copy on disk are
          both shown below. Nothing is overwritten until you choose.
        </p>
        <div className="compare-grid">
          <div>
            <strong>Your copy</strong>
            <pre>{mine || " "}</pre>
          </div>
          <div>
            <strong>On disk</strong>
            <pre>{disk || " "}</pre>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onKeep}>
            Keep mine unsaved
          </button>
          <button type="button" className="btn btn-ghost" onClick={onReload}>
            Reload from disk
          </button>
          <button type="button" className="btn btn-primary" onClick={onOverwrite}>
            Overwrite with mine
          </button>
        </div>
      </div>
    </div>
  );
}
