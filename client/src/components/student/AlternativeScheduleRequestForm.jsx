import { useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { Modal } from "../UI";
import { formatPersonName } from "../../utils/formatPersonName";
import { safeStudentError } from "../../utils/studentUiErrors";
import AvailableTimeSlots from "../appointments/AvailableTimeSlots";
import { validateAvailableTimeSlots } from "../../utils/availableTimeSlots";

const initial = { subject: "", reason: "", requestedConsultationDate: "", availableTimeSlots: [{ startTime: "", endTime: "" }], mode: "Face-to-Face" };
const todayInManila = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const validationMessages = {
  INVALID_FACULTY: "This Faculty member is no longer available for consultation requests.",
  INVALID_SUBJECT: "Please enter a consultation subject.",
  INVALID_REASON: "Please enter a reason for the consultation.",
  INVALID_YEAR_LEVEL: "Your Student profile contains an invalid year level. Please update your profile or contact the Dean.",
  INVALID_REQUESTED_DATE: "Please choose a valid preferred consultation date.",
  INVALID_REQUESTED_TIME: "Please choose a valid preferred consultation time.",
  PAST_REQUESTED_SCHEDULE: "Please choose a future preferred consultation date and time.",
  INVALID_AVAILABLE_TIME_SLOTS: "Enter at least one available time slot.",
  INVALID_AVAILABLE_TIME_SLOT: "Enter a valid start and end time for every slot.",
  INVALID_AVAILABLE_TIME_SLOT_ORDER: "Every time slot must end after it starts.",
  PAST_AVAILABLE_TIME_SLOT: "Available times must not already be in the past.",
  DUPLICATE_AVAILABLE_TIME_SLOT: "Remove duplicate time slots.",
  OVERLAPPING_AVAILABLE_TIME_SLOTS: "Available time slots must not overlap.",
  INVALID_MODE: "Please choose a valid consultation mode.",
  DUPLICATE_SCHEDULE_REQUEST: "You already have a pending schedule request with this Faculty member.",
};
const requestErrorMessage = error => validationMessages[error?.code] ||
  safeStudentError(error, "Unable to send the alternative schedule request. Please try again later.");

export default function AlternativeScheduleRequestForm({ provider, onClose, onSuccess }) {
  const [form, setForm] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(""), [slotErrors, setSlotErrors] = useState([]);
  const inFlight = useRef(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setSlotErrors([]);
    if (!form.subject.trim()) { setError("Please enter a consultation subject."); inFlight.current = false; setBusy(false); return; }
    if (!form.reason.trim()) { setError("Please enter a reason for the consultation."); inFlight.current = false; setBusy(false); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.requestedConsultationDate) || form.requestedConsultationDate < todayInManila()) {
      setError("Please choose today or a future consultation date."); inFlight.current = false; setBusy(false); return;
    }
    const slotValidation = validateAvailableTimeSlots(form.availableTimeSlots, { date: form.requestedConsultationDate });
    if (!slotValidation.valid) { setSlotErrors(slotValidation.errors); setError(slotValidation.message || "Review the highlighted available time slots."); inFlight.current = false; setBusy(false); return; }
    try {
      const body = new FormData();
      Object.entries({ facultyId: provider._id, subject: form.subject.trim(), reason: form.reason.trim(),
        requestedConsultationDate: form.requestedConsultationDate,
        availableTimeSlots: JSON.stringify(form.availableTimeSlots), mode: form.mode })
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
      <AvailableTimeSlots value={form.availableTimeSlots} onChange={value => { change("availableTimeSlots", value); setSlotErrors([]); }} errors={slotErrors} disabled={busy} idPrefix="student-availability" />
      <label className="block font-semibold">Preferred Consultation Mode<select className="field mt-1 w-full" value={form.mode} onChange={e => change("mode", e.target.value)}><option>Face-to-Face</option><option>Online</option></select></label>
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Your preferred date and available times will be reviewed by the Faculty. They are not a confirmed booking.</p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Sending..." : "Send Schedule Request"}</button></div>
    </form>
  </Modal>;
}
