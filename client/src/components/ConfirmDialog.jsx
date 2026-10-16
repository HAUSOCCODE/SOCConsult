import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function ConfirmDialog({
  open,
  title,
  message,
  supportingText,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loadingLabel,
  variant = "danger",
  loading = false,
  onConfirm,
  onCancel,
  inputLabel,
  inputValue = "",
  onInputChange,
  inputPlaceholder,
  inputMaxLength = 500,
  portalTarget,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    document.body.style.overflow = "hidden";
    dialog?.querySelector("textarea, button")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !loading) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll("button:not(:disabled), textarea:not(:disabled)")];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [loading, open]);

  if (!open) return null;
  const confirmClass =
    variant === "danger"
      ? "bg-red-700 hover:bg-red-800 focus-visible:ring-red-200"
      : "bg-maroon-800 hover:bg-maroon-900 focus-visible:ring-maroon-200";

  return createPortal(
    <div
      className="fixed inset-0 z-[11000] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-slate-950/55 p-3 sm:p-4"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !loading && onCancel()
      }
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="min-w-0 text-xl font-bold text-maroon-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close confirmation dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-maroon-200 disabled:opacity-50"
          >
            <X size={19} />
          </button>
        </div>
        <div id={descriptionId} className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          <p>{message}</p>
          {supportingText && <p>{supportingText}</p>}
        </div>
        {inputLabel && (
          <label className="mt-5 block text-sm font-semibold text-slate-700">
            {inputLabel}
            <textarea
              value={inputValue}
              onChange={(event) => onInputChange?.(event.target.value)}
              disabled={loading}
              maxLength={inputMaxLength}
              rows={4}
              placeholder={inputPlaceholder}
              className="field mt-2 min-h-24 resize-y"
            />
          </label>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 min-[420px]:flex-row min-[420px]:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary h-11 w-full min-[420px]:w-auto"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex h-11 w-full items-center justify-center rounded-lg px-5 text-sm font-bold text-white transition focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60 min-[420px]:w-auto ${confirmClass}`}
          >
            {loading ? loadingLabel || `${confirmLabel}ing...` : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    portalTarget || document.body,
  );
}
