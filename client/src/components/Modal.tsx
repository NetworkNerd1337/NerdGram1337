import type { FormEvent, ReactNode } from "react";

type ModalProps = {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  onClose: () => void;
  onConfirm: () => void;
};

export function Modal({
  title,
  children,
  confirmLabel = "Save",
  className,
  onClose,
  onConfirm,
}: ModalProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onConfirm();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className={className ? `modal ${className}` : "modal"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h3>{title}</h3>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
