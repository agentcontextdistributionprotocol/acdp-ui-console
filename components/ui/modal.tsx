'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { C } from '@/lib/colors';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // `onClose` is read through a ref, and is deliberately NOT a dependency of the
  // effect below.
  //
  // Callers pass an inline arrow, so its identity changes on every render of the
  // owning component. With it in the dep list, each such render tore this effect
  // down and re-ran it — and the teardown calls `previouslyFocused?.focus?.()`,
  // which moves focus OUT of the open dialog, while the re-run moves it to the
  // dialog's FIRST focusable (the header "Close dialog" button). A keyboard or
  // screen-reader operator was therefore thrown off whatever control they had
  // tabbed to every time the dialog re-rendered — measured at four focus moves
  // across a single confirm click and its error arrival in the witness-ack
  // dialog, landing on "Close dialog" three times.
  //
  // The effect's real dependency is `open`: it installs a keydown listener and a
  // one-shot focus timer, neither of which needs rebuilding when the close
  // callback's identity changes. The ref keeps Escape calling the CURRENT
  // callback without making the subscription depend on it.
  // Synced in its own effect rather than assigned during render: writing
  // `ref.current` in a render body is what `react-hooks/refs` refuses, and it
  // is genuinely unsafe under a re-render that never commits. This effect has
  // no dependency array, so it runs after every commit — always before any
  // keydown the handler below could see.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog.
    const focusTimer = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialogRef.current)?.focus();
    }, 0);

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap focus within the dialog.
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handler);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal anim-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex' }}
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
