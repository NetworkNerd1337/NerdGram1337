import { Modal } from "./Modal";

type EditorLockBannerProps = {
  note: string;
  readOnly: boolean;
  dirty: boolean;
  copyNote: string | null;
  onTakeOver: () => void;
  onSaveCopy: () => void;
};

export function EditorLockBanner({
  note,
  readOnly,
  dirty,
  copyNote,
  onTakeOver,
  onSaveCopy,
}: EditorLockBannerProps) {
  return (
    <div className="editor-banner" role="status">
      <div>{note}</div>
      {readOnly ? (
        <div className="editor-banner-actions">
          <button type="button" className="btn btn-primary" onClick={onTakeOver}>
            Take over editing
          </button>
          {dirty ? (
            <button type="button" className="btn btn-ghost" onClick={onSaveCopy}>
              Save a copy
            </button>
          ) : null}
        </div>
      ) : null}
      {copyNote ? <div>{copyNote}</div> : null}
    </div>
  );
}

export function TakeoverDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title="Take over editing?"
      confirmLabel="Take over editing"
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <p className="dialog-note">
        This replaces the lock if the other window has stopped refreshing it. A window that is still
        editing keeps the lock, and this one stays read-only.
      </p>
    </Modal>
  );
}
