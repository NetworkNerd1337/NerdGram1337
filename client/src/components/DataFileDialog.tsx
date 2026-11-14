type DataFileDialogProps = {
  title: string;
  intro: string;
  files: readonly string[];
  primaryLabel: string;
  secondaryLabel: string;
  busy?: boolean;
  onClose: () => void;
  onPrimary: () => void;
  onSecondary: () => void;
};

/** Asks whether a sibling data file is copied, shared, trashed, or kept. */
export function DataFileDialog({
  title,
  intro,
  files,
  primaryLabel,
  secondaryLabel,
  busy = false,
  onClose,
  onPrimary,
  onSecondary,
}: DataFileDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-file-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onPrimary();
        }}
      >
        <h3 id="data-file-title">{title}</h3>
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
          <button type="button" className="btn btn-ghost" onClick={onSecondary} disabled={busy}>
            {secondaryLabel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {primaryLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
