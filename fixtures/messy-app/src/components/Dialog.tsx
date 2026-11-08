import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/**
 * Blocking confirmation dialog. Traps focus inside itself and can only be
 * dismissed through its own buttons; backdrop click and Escape do nothing.
 * Looks almost identical to Modal, behaves nothing like it.
 */
export function Dialog({ open, title, description, confirmLabel = "Confirm", onConfirm, onCancel, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const focusables = panel.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])");
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || focusables.length === 0) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    panel.addEventListener("keydown", trap);
    return () => panel.removeEventListener("keydown", trap);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
      >
        <h2 id="dialog-title" className="text-lg font-semibold text-[#1f2937]">
          {title}
        </h2>
        {description && <p className="mt-[7px] text-sm text-[#6b7380]">{description}</p>}
        {children && <div className="mt-4 text-sm text-[#6b7280]">{children}</div>}
        <div className="mt-6 flex justify-end gap-[10px]">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
