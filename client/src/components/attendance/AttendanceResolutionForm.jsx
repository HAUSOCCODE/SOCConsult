import { useRef, useState } from "react";
import ConfirmDialog from "../ConfirmDialog";
import { api } from "../../api/apiClient";

export const resolutionLabels = {
  confirm_completed: "Confirm Completed",
  confirm_student_no_show: "Confirm Student No-show",
  confirm_faculty_no_show: "Confirm Faculty No-show",
  leave_under_review: "Leave Under Review",
};
export default function AttendanceResolutionForm({ recordId, version, onSaved, onStale, onBusy }) {
  const [action, setAction] = useState(""), [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [stale, setStale] = useState(false);
  const submitting = useRef(false);
  const form = useRef(null);
  async function submit() {
    if (submitting.current || stale || !action || !reason.trim()) return;
    submitting.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const result = await api(`/dean/attendance-review/${recordId}/actions`, { method: "POST", body: JSON.stringify({ action, reason: reason.trim(), expectedVersion: version }) });
      setConfirm(false); onSaved(result);
    } catch (err) {
      setConfirm(false);
      if (err.status === 409) { setStale(true); setError("This review changed or was resolved. Refresh the details before continuing."); }
      else setError(err.status === 400 ? err.message : "The action could not be confirmed. Refresh the details before retrying.");
      if (err.status !== 400) setStale(true);
    } finally { submitting.current = false; setBusy(false); onBusy(false); }
  }
  function request(event) {
    event.preventDefault();
    if (submitting.current || stale || !action || !reason.trim()) return;
    if (action === "leave_under_review") void submit(); else setConfirm(true);
  }
  return <form ref={form} onSubmit={request} className="space-y-3 rounded border p-4">
    <h3 className="font-bold">Record Dean review</h3>
    <p className="text-sm">Choose a resolution after reviewing the available information. Original participant responses remain unchanged.</p>
    <fieldset disabled={busy || stale} className="space-y-3">
      <label className="block">Action<select required className="field mt-1 w-full" value={action} onChange={event => setAction(event.target.value)}><option value="">Select an action</option>{Object.entries(resolutionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block">Resolution reason (required)<textarea required maxLength={500} rows={4} className="field mt-1 w-full" value={reason} onChange={event => setReason(event.target.value)} /></label>
      <p className="text-xs">{reason.length}/500 characters. The reason is retained in the protected review record.</p>
      <button type="submit" disabled={!action || !reason.trim() || busy || stale} className="btn-primary">{busy ? "Saving review…" : "Submit review"}</button>
    </fieldset>
    {error && <p role="alert">{error} {stale && <button className="underline" type="button" disabled={busy} onClick={onStale}>Refresh details</button>}</p>}
    <ConfirmDialog portalTarget={form.current?.closest("dialog")} open={confirm} title="Confirm final attendance decision" message={`Record “${resolutionLabels[action] || ""}”? This final decision cannot be replaced.`} supportingText={reason.trim()} confirmLabel="Record final decision" loading={busy} onConfirm={submit} onCancel={() => { if (!submitting.current) setConfirm(false); }} />
  </form>;
}
