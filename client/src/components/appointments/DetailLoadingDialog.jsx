import { useRef } from "react";
import { createPortal } from "react-dom";
import useDialogFocus from "../../hooks/useDialogFocus";

export default function DetailLoadingDialog({ children, onClose, opener, title = "Consultation details" }) {
  const ref = useRef(null);
  useDialogFocus(ref, { onClose, restoreTarget: opener });
  return createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-3">
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="loading-detail-title" className="max-h-[90dvh] w-full max-w-xl overflow-auto rounded-xl bg-white p-5">
      <h2 id="loading-detail-title" className="text-xl font-bold">{title}</h2>
      <div className="mt-4 space-y-3" role="status">{children}</div>
    </section>
  </div>, document.body);
}
