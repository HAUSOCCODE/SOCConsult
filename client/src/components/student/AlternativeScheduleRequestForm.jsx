import { useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { Modal } from "../UI";
import { formatPersonName } from "../../utils/formatPersonName";
import { safeStudentError } from "../../utils/studentUiErrors";

const initial = { subject: "", reason: "", startAt: "", endAt: "", mode: "Face-to-Face" };
const timestamp = value => value ? `${value}:00+08:00` : "";
const validationMessages = {
  INVALID_FACULTY: "This Faculty member is no longer available for consultation requests.",
  INVALID_SUBJECT: "Please enter a consultation subject.",
  INVALID_REASON: "Please enter a reason for the consultation.",
  INVALID_YEAR_LEVEL: "Your Student profile contains an invalid year level. Please update your profile or contact the Dean.",
  INVALID_DURATION: "Choose a preferred time between 5 minutes and 4 hours.",
  INVALID_SCHEDULE: "Please choose valid preferred start and end times.",
  PAST_SCHEDULE: "Please choose a future consultation time.",
  INVALID_SCHEDULE_ORDER: "The preferred end time must be after the start time.",
  INVALID_MODE: "Please choose a valid consultation mode.",
  DUPLICATE_SCHEDULE_REQUEST: "You already have a pending schedule request with this Faculty member.",
  SCHEDULE_CONFLICT: "This request conflicts with an existing consultation.",
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
    const startAt = timestamp(form.startAt), endAt = timestamp(form.endAt);
    const duration = Math.floor((new Date(endAt) - new Date(startAt)) / 60000);
    if (!form.subject.trim()) {
      setError("Please enter a consultation subject.");
      inFlight.current = false; setBusy(false); return;
    }
    if (!form.reason.trim()) {
      setError("Please enter a reason for the consultation.");
      inFlight.current = false; setBusy(false); return;
    }
    if (!form.startAt || !form.endAt || !Number.isFinite(new Date(startAt).getTime()) || !Number.isFinite(new Date(endAt).getTime())) {
      setError("Please choose valid preferred start and end times.");
      inFlight.current = false; setBusy(false); return;
    }
    if (new Date(startAt) <= new Date()) {
      setError("Please choose a future consultation time.");
      inFlight.current = false; setBusy(false); return;
    }
    if (new Date(endAt) <= new Date(startAt)) {
      setError("The preferred end time must be after the start time.");
      inFlight.current = false; setBusy(false); return;
    }
    if (!Number.isInteger(duration) || duration < 5 || duration > 240) {
      setError("Choose a preferred time between 5 minutes and 4 hours.");
      inFlight.current = false; setBusy(false); return;
    }
    try {
      const body = new FormData();
      Object.entries({ facultyId: provider._id, subject: form.subject.trim(), reason: form.reason.trim(),
        estimatedDurationMinutes: duration,
        startAt, endAt, mode: form.mode })
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
      <div className="grid gap-3 sm:grid-cols-2"><label className="font-semibold">Preferred start — Asia/Manila<input className="field mt-1 w-full" type="datetime-local" required value={form.startAt} onChange={e => change("startAt", e.target.value)} /></label><label className="font-semibold">Preferred end — Asia/Manila<input className="field mt-1 w-full" type="datetime-local" required value={form.endAt} onChange={e => change("endAt", e.target.value)} /></label></div>
      <label className="block font-semibold">Preferred Consultation Mode<select className="field mt-1 w-full" value={form.mode} onChange={e => change("mode", e.target.value)}><option>Face-to-Face</option><option>Online</option></select></label>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Sending..." : "Send Schedule Request"}</button></div>
    </form>
  </Modal>;
}
