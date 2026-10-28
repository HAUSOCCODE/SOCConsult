import { formatManilaDateTime } from "../../utils/formatDateTime";
const formatTimestamp = value => formatManilaDateTime(value, "Not available");

export default function AttendanceResponseSummary({ attendance }) {
  if (!attendance) return null;
  const own = attendance.ownResponse;
  const facultyOutcome = attendance.outcomes?.faculty;
  const review = attendance.status === "Attendance Review";

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="attendance-summary-heading">
      <h3 id="attendance-summary-heading" className="font-bold text-maroon-900">Attendance Response</h3>
      {review && <p className="mt-3 break-words rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><strong>Attendance Review.</strong> The submitted attendance responses require review.</p>}
      {attendance.status === "Completed" && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">The attendance workflow has been finalized by the system.</p>}
      {attendance.status === "Expired" && <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">This consultation is no longer accepting attendance responses.</p>}
      {own ? (
        <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          <Detail label="Your response" value={own.outcome} />
          <Detail label="Submitted" value={formatTimestamp(own.submittedAt)} />
          {own.reason && <Detail label="Your reason" value={own.reason} wide />}
          {attendance.waiting && <Detail label="Current state" value="Your response is submitted. The system is waiting for the attendance workflow to finish." wide />}
          {attendance.finalOutcome && <Detail label="Final outcome" value={attendance.finalOutcome} wide />}
          {facultyOutcome && <Detail label="Faculty response" value={facultyOutcome} wide />}
        </dl>
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-600">No Student attendance response is available for this consultation.</p>
      )}
    </section>
  );
}

function Detail({ label, value, wide = false }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-800">{value || "Not provided"}</dd></div>;
}
