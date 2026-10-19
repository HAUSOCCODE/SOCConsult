import { useRef, useState } from "react";
import ConfirmDialog from "../ConfirmDialog";
import { safeStudentError } from "../../utils/studentUiErrors";

const OUTCOMES = [
  { value: "Completed", description: "The consultation took place as scheduled." },
  { value: "Student No-show", description: "I was unable to attend the consultation." },
  { value: "Faculty No-show", description: "The Faculty member was unable to attend the consultation." },
];

export const ATTENDANCE_REASON_LIMIT = 500;
export const ATTENDANCE_NOTICE =
  "Your attendance response will be stored separately from the Faculty member’s response. The final consultation outcome will be determined by the system based on both submissions.";

export default function StudentAttendanceResponseForm({ onSubmit }) {
  const [outcome, setOutcome] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submissionGuard = useRef(false);

  const requestConfirmation = (event) => {
    event.preventDefault();
    if (!outcome) {
      setError("Select one attendance response before continuing.");
      return;
    }
    setError("");
    setConfirming(true);
  };
  const submit = async () => {
    if (submissionGuard.current || !outcome) return;
    submissionGuard.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({ outcome, reason: reason.trim() });
      setConfirming(false);
    } catch (requestError) {
      setConfirming(false);
      setError(safeStudentError(requestError, "Unable to submit your attendance response. Refresh the consultation before trying again."));
    } finally {
      submissionGuard.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section className="min-w-0 rounded-xl border border-gold-300 bg-gold-50 p-4 sm:p-5" aria-labelledby="student-attendance-heading">
      <h3 id="student-attendance-heading" className="font-bold text-maroon-900">Submit Attendance Response</h3>
      <p className="mt-2 break-words rounded-lg border border-maroon-200 bg-white p-3 text-sm leading-6 text-slate-700">{ATTENDANCE_NOTICE}</p>
      <form className="mt-4 min-w-0 space-y-4" onSubmit={requestConfirmation}>
        <fieldset disabled={submitting} className="min-w-0 space-y-2">
          <legend className="mb-2 text-sm font-bold text-slate-800">Choose one response</legend>
          {OUTCOMES.map((option) => (
            <label key={option.value} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition hover:border-maroon-300 focus-within:ring-2 focus-within:ring-maroon-200">
              <input type="radio" name="student-attendance-outcome" value={option.value} checked={outcome === option.value} onChange={() => { setOutcome(option.value); setError(""); }} className="mt-1 h-4 w-4 shrink-0 accent-maroon-800" />
              <span className="min-w-0"><strong className="block break-words text-sm text-slate-900">{option.value}</strong><span className="mt-0.5 block break-words text-sm leading-5 text-slate-600">{option.description}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="block min-w-0 text-sm font-bold text-slate-800">
          Reason or explanation (Optional)
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={submitting} maxLength={ATTENDANCE_REASON_LIMIT} rows={4} className="field mt-2 min-h-24 w-full resize-y" placeholder="Add context if helpful" />
          <span className="mt-1 block text-right text-xs font-normal text-slate-500">{reason.length}/{ATTENDANCE_REASON_LIMIT}</span>
        </label>
        {error && <p role="alert" className="break-words rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary min-h-10 w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">Submit Attendance Response</button>
      </form>
      <ConfirmDialog open={confirming} title="Submit Attendance Response" message="Submit this attendance response? You will not be able to change it after submission." supportingText={`Selected response: ${outcome}`} confirmLabel="Submit Response" cancelLabel="Go Back" loadingLabel="Submitting..." variant="primary" loading={submitting} onCancel={() => !submitting && setConfirming(false)} onConfirm={submit} />
    </section>
  );
}
