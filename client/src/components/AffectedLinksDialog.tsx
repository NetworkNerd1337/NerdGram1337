type AffectedLinksDialogProps = {
  title: string;
  intro: string;
  files: readonly string[];
  confirmLabel: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Lists the diagrams a rename, move, or delete would affect. */
export function AffectedLinksDialog({
  title,
  intro,
  files,
  confirmLabel,
  busy = false,
  onClose,
  onConfirm,
}: AffectedLinksDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="affected-links-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onConfirm();
        }}
      >
        <h3 id="affected-links-title">{title}</h3>
        <p>{intro}</p>
        <ul className="affected-links">
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
