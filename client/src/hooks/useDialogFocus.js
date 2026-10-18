import { useEffect, useRef } from "react";

// One stack for custom dialogs, native dialogs and drawers. Only the top layer
// handles keys, including when a confirmation is portalled inside a native dialog.
const layers = [];
let scrollLocks = 0;
let originalOverflow;
const controls = 'a[href], button, input, select, textarea, [tabindex]';
export function focusableControls(panel) {
  return [...panel.querySelectorAll(controls)].filter(element =>
    !element.disabled && element.tabIndex >= 0 &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
    element.getClientRects().length > 0,
  );
}

export default function useDialogFocus(ref, {
  open = true, onClose, busy = false, initialFocus, restoreTarget,
  lockScroll = true,
} = {}) {
  const latest = useRef({ onClose, busy, initialFocus, restoreTarget });
  latest.current = { onClose, busy, initialFocus, restoreTarget };
  useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return undefined;
    const previous = latest.current.restoreTarget || document.activeElement;
    const layer = { panel };
    layers.push(layer);
    if (lockScroll) {
      if (scrollLocks++ === 0) originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const focusInitial = () => {
      const target = latest.current.initialFocus?.current ||
        (typeof latest.current.initialFocus === "string" ? panel.querySelector(latest.current.initialFocus) : null);
      (target || focusableControls(panel)[0] || panel).focus();
    };
    focusInitial();
    const isTop = () => layers.at(-1) === layer;
    const keydown = event => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        // Prevent native cancel and parent listeners from closing a lower layer.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!latest.current.busy) latest.current.onClose?.();
      } else if (event.key === "Tab") {
        const items = focusableControls(panel);
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (!panel.contains(document.activeElement) || document.activeElement === panel) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const focusin = event => {
      if (isTop() && !panel.contains(event.target)) focusInitial();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      const wasTop = isTop();
      layers.splice(layers.indexOf(layer), 1);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      if (lockScroll && --scrollLocks === 0) document.body.style.overflow = originalOverflow;
      // A parent may become uninert in the same React commit.
      queueMicrotask(() => {
        if ((wasTop || !layers.length) && previous?.isConnected && !previous.closest?.('[inert], [hidden]') &&
          (!layers.length || layers.at(-1).panel.contains(previous))) previous.focus();
      });
    };
  }, [open, ref, lockScroll]);
  useEffect(() => {
    if (open && busy && layers.at(-1)?.panel === ref.current) ref.current?.focus();
  }, [open, busy, ref]);
}
