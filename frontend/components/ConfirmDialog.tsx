"use client";

import { useEffect, useId, useRef } from "react";

export interface ConfirmProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/** In-page confirmation built on <dialog>; replaces window.confirm everywhere. */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel, busy }: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="stack">
        <h2 id={titleId}>{title}</h2>
        <p className="dim" style={{ margin: 0 }}>
          {body}
        </p>
        <div className="row">
          <button type="button" className="btn danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
          <button type="button" className="btn" onClick={onCancel} autoFocus>
            {cancelLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
