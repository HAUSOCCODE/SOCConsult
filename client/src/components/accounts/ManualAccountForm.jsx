import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api } from "../../api/apiClient";
import ConfirmDialog from "../ConfirmDialog";

const emptyForm = { institutional_id: "", first_name: "", middle_name: "", last_name: "", official_email: "", role: "student" };
const fields = [
  ["institutional_id", "Institutional ID"], ["first_name", "First name"],
  ["middle_name", "Middle name (optional)"], ["last_name", "Last name"],
  ["official_email", "Official email"],
];
export default function ManualAccountForm({ onClose, onSuccess }) {
  const [form, setForm] = useState({ ...emptyForm });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dialogRef = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector("input")?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus?.(); };
  }, []);
  useEffect(() => {
    if (confirming) return undefined;
    const keydown = (event) => {
      if (event.key === "Escape" && !inFlight.current) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll("input:not(:disabled), select:not(:disabled), button:not(:disabled)") || [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [confirming, onClose]);
  const review = (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    const nextErrors = {};
    for (const [field] of fields) {
      if (field !== "middle_name" && !form[field].trim()) nextErrors[field] = "This field is required.";
    }
    if (new TextEncoder().encode(form.institutional_id.trim()).length > 72)
      nextErrors.institutional_id = "Institutional ID must be 72 UTF-8 bytes or fewer.";
    setErrors(nextErrors);
    setError("");
    if (!Object.keys(nextErrors).length) setConfirming(true);
  };
  const create = async () => {
    if (inFlight.current || !confirming) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/dean/users", { method: "POST", body: JSON.stringify(form) });
      if (!mounted.current) return;
      setForm({ ...emptyForm });
      setConfirming(false);
      onSuccess();
    } catch (requestError) {
      if (!mounted.current) return;
      setErrors(requestError.errors || {});
      if (requestError.code === "PROVISIONING_SETUP_UNAVAILABLE")
        setError("Account creation is temporarily unavailable until account provisioning setup is completed.");
      else if (requestError.code === "ACCOUNT_CREATION_UNCERTAIN")
        setError("Unable to confirm account creation. Refresh the user list before trying again.");
      else
        setError(deanUiError(requestError, "create"));
      setConfirming(false);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return createPortal(
    <>
      <div inert={confirming} aria-hidden={confirming || undefined} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3 sm:p-4"
        onMouseDown={(event) => event.target === event.currentTarget && !inFlight.current && !confirming && onClose()}>
        <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
          className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl font-bold text-maroon-900">Create User Manually</h2>
            <button type="button" disabled={busy || confirming} onClick={() => { if (!inFlight.current) onClose(); }} aria-label="Close manual account form"
              className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100"><X size={20} /></button>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            The official email will be the username. The institutional ID will be the initial password.
            The account will be active immediately. The user can change the password later.
          </p>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {errors.name && <p role="alert" className="mt-3 text-sm text-red-700">{errors.name}</p>}
          <form onSubmit={review}>
            <fieldset disabled={busy || confirming} className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
              {fields.map(([field, label]) => (
                <label key={field} className="min-w-0 text-sm font-semibold text-slate-700">
                  {label}
                  <input className="field mt-2 w-full" type={field === "official_email" ? "email" : "text"}
                    required={field !== "middle_name"} value={form[field]}
                    maxLength={field.includes("name") ? 80 : field === "official_email" ? 254 : undefined}
                    aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${titleId}-${field}-error` : undefined}
                    onChange={(event) => { setForm({ ...form, [field]: event.target.value }); setErrors({ ...errors, [field]: undefined }); }} />
                  {errors[field] && <span id={`${titleId}-${field}-error`} className="mt-1 block text-xs text-red-700">{errors[field]}</span>}
                </label>
              ))}
              <label className="min-w-0 text-sm font-semibold text-slate-700">Role
                <select className="field mt-2 w-full" value={form.role}
                  aria-invalid={Boolean(errors.role)} aria-describedby={errors.role ? `${titleId}-role-error` : undefined}
                  onChange={(event) => { setForm({ ...form, role: event.target.value }); setErrors({ ...errors, role: undefined }); }}>
                  <option value="student">Student</option><option value="faculty">Faculty</option>
                </select>
                {errors.role && <span id={`${titleId}-role-error`} className="mt-1 block text-xs text-red-700">{errors.role}</span>}
              </label>
            </fieldset>
            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
              <button type="button" disabled={busy || confirming} className="btn-secondary" onClick={() => { if (!inFlight.current) onClose(); }}>Cancel</button>
              <button type="submit" disabled={busy || confirming} className="btn-primary">Review and Create</button>
            </div>
          </form>
        </section>
      </div>
      <ConfirmDialog open={confirming} title="Create this account?" variant="primary" confirmLabel="Create Account"
        message="Create one active account with the entered information?"
        supportingText="The official email is the username. The institutional ID is the initial password. The account is activated immediately and the user can change the password later."
        loading={busy} loadingLabel="Creating..." onConfirm={create} onCancel={() => { if (!inFlight.current) setConfirming(false); }} />
    </>, document.body,
  );
}
