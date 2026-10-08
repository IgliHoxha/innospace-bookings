import type { ReactNode } from "react";

/** A yes/no prompt over the page. A click outside it counts as "No". */
export default function ConfirmDialog({
  title,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2>{title}</h2>
        <p>{children}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            No
          </button>
          <button className={danger ? "btn danger" : "btn"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
