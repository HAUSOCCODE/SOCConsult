import { useRef, useState } from "react";
import { api } from "../../api/apiClient";
import ConfirmDialog from "../ConfirmDialog";

const OUTCOMES = [
  { value: "Completed", description: "The consultation took place as scheduled." },
  { value: "Student No-show", description: "The Student was unable to attend the consultation." },
  { value: "Faculty No-show", description: "I was unable to attend the consultation." },
];

export const FACULTY_ATTENDANCE_REASON_LIMIT = 500;

const safeMessage = (error) => {
  if (!error?.status) return "Network connection interrupted. Refresh the consultation before trying again.";
  if (error.status === 401) return "Your session has expired. Please sign in again.";
  if ([403, 404].includes(error.status)) return "This consultation is unavailable or you do not have permission to update it.";
  if (error.status === 409) return "The attendance record changed or your response was already submitted. Refreshing the consultation is required.";
  if (error.status === 400) return "Review the attendance response and try again.";
  return "Unable to submit your attendance response. Refresh the consultation before trying again.";
};

export default function FacultyAttendanceForm({ appointmentId, onSubmitted }) {
  const [outcome, setOutcome] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const requestConfirmation = (event) => {
    event.preventDefault();
    if (!outcome) return setError("Select one attendance outcome before continuing.");
    setError("");
    setConfirming(true);
  };

  const submit = async () => {
    if (pending.current || !outcome) return;
    pending.current = true;
    setSubmitting(true);
    setError("");
    try {
      await api(`/appointments/${appointmentId}/attendance-responses`, {
        method: "POST",
        body: JSON.stringify({ outcome, ...(reason.trim() && { reason: reason.trim() }) }),
      });
      setConfirming(false);
      await onSubmitted?.({ success: true });
    } catch (requestError) {
      setConfirming(false);
      setError(safeMessage(requestError));
      if ([404, 409].includes(requestError?.status)) await onSubmitted?.({ success: false });
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };

  return <section className="min-w-0 rounded-xl border border-gold-300 bg-gold-50 p-4 sm:p-5" aria-labelledby="faculty-attendance-heading">
    <h3 id="faculty-attendance-heading" className="font-bold text-maroon-900">Submit Attendance Response</h3>
    <p className="mt-2 text-sm leading-6 text-slate-700">Report your own attendance outcome. The system determines the final consultation status from both participant responses.</p>
    <form className="mt-4 min-w-0 space-y-4" onSubmit={requestConfirmation}>
      <fieldset disabled={submitting} className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-bold text-slate-800">Attendance outcome</legend>
        {OUTCOMES.map(option => <label key={option.value} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-maroon-300 focus-within:ring-2 focus-within:ring-maroon-200">
          <input type="radio" name="faculty-attendance-outcome" value={option.value} checked={outcome === option.value} onChange={() => { setOutcome(option.value); setError(""); }} className="mt-1 h-4 w-4 shrink-0 accent-maroon-800" />
          <span className="min-w-0"><strong className="block break-words text-sm text-slate-900">{option.value}</strong><span className="mt-0.5 block break-words text-sm leading-5 text-slate-600">{option.description}</span></span>
        </label>)}
      </fieldset>
      <label className="block min-w-0 text-sm font-bold text-slate-800">Reason or explanation (Optional)
        <textarea value={reason} onChange={event => setReason(event.target.value)} disabled={submitting} maxLength={FACULTY_ATTENDANCE_REASON_LIMIT} rows={4} className="field mt-2 min-h-24 w-full resize-y" placeholder="Add context if helpful" />
        <span className="mt-1 block text-right text-xs font-normal text-slate-500">{reason.length}/{FACULTY_ATTENDANCE_REASON_LIMIT}</span>
      </label>
      {error && <p role="alert" className="break-words rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={submitting} className="btn-primary min-h-10 w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{submitting ? "Submitting..." : "Submit Attendance Response"}</button>
    </form>
    <ConfirmDialog open={confirming} title="Submit Attendance Response" message="Submit this attendance response? You will not be able to change it after submission." supportingText={`Selected outcome: ${outcome}`} confirmLabel="Submit Response" cancelLabel="Go Back" loadingLabel="Submitting..." variant="primary" loading={submitting} onCancel={() => !pending.current && setConfirming(false)} onConfirm={submit} />
  </section>;
}
