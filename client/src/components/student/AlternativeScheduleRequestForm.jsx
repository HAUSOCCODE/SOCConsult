import { useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { Modal } from "../UI";
import { formatPersonName } from "../../utils/formatPersonName";
import { safeStudentError } from "../../utils/studentUiErrors";

const initial = { subject: "", reason: "", requestedConsultationDate: "", mode: "Face-to-Face" };
const todayInManila = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const validationMessages = {
  INVALID_FACULTY: "This Faculty member is no longer available for consultation requests.",
  INVALID_SUBJECT: "Please enter a consultation subject.",
  INVALID_REASON: "Please enter a reason for the consultation.",
  INVALID_YEAR_LEVEL: "Your Student profile contains an invalid year level. Please update your profile or contact the Dean.",
  INVALID_REQUESTED_DATE: "Please choose a valid preferred consultation date.",
  PAST_REQUESTED_DATE: "Please choose today or a future consultation date.",
  INVALID_MODE: "Please choose a valid consultation mode.",
  DUPLICATE_SCHEDULE_REQUEST: "You already have a pending schedule request with this Faculty member.",
};
const requestErrorMessage = error => validationMessages[error?.code] ||
  safeStudentError(error, "Unable to send the alternative schedule request. Please try again later.");

export default function AlternativeScheduleRequestForm({ provider, onClose, onSuccess }) {
  const [form, setForm] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    if (!form.subject.trim()) { setError("Please enter a consultation subject."); inFlight.current = false; setBusy(false); return; }
    if (!form.reason.trim()) { setError("Please enter a reason for the consultation."); inFlight.current = false; setBusy(false); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.requestedConsultationDate) || form.requestedConsultationDate < todayInManila()) {
      setError("Please choose today or a future consultation date."); inFlight.current = false; setBusy(false); return;
    }
    try {
      const body = new FormData();
      Object.entries({ facultyId: provider._id, subject: form.subject.trim(), reason: form.reason.trim(),
        requestedConsultationDate: form.requestedConsultationDate, mode: form.mode })
        .forEach(([key, value]) => body.append(key, value));
      const data = await api("/schedule-requests", { method: "POST", body });
      await onSuccess?.(data);
    } catch (requestError) {
      setError(requestErrorMessage(requestError));
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <Modal onClose={() => !busy && onClose()} title="Request Another Schedule">
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-slate-600">Faculty: <strong>{formatPersonName(provider)}</strong>. This is a request, not a confirmed booking.</p>
      <label className="block font-semibold">Consultation subject<input className="field mt-1 w-full" required maxLength={150} value={form.subject} onChange={e => change("subject", e.target.value)} /></label>
      <label className="block font-semibold">Reason and scheduling explanation<textarea className="field mt-1 w-full" required maxLength={1000} rows={4} value={form.reason} onChange={e => change("reason", e.target.value)} /></label>
      <label className="block font-semibold">Preferred consultation date<input className="field mt-1 w-full" type="date" min={todayInManila()} required value={form.requestedConsultationDate} onChange={e => change("requestedConsultationDate", e.target.value)} /></label>
      <label className="block font-semibold">Preferred Consultation Mode<select className="field mt-1 w-full" value={form.mode} onChange={e => change("mode", e.target.value)}><option>Face-to-Face</option><option>Online</option></select></label>
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Your Faculty member will review your requested date and determine the consultation time based on their availability.</p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Sending..." : "Send Schedule Request"}</button></div>
    </form>
  </Modal>;
}
