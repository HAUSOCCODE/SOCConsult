const labels = { verifiedCompleted: "Verified completed attendance", studentNoShow: "Finalized: Student No-show",
  facultyNoShow: "Finalized: Faculty No-show", historicalUnverifiedCompleted: "Historical Completed (unverified)", attendanceReview: "Attendance Review" };
export default function AttendanceSummary({ counts }) {
  if (!counts) return null;
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Attendance outcomes</h2>
    <dl className="mt-2 flex flex-wrap gap-4">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-sm text-slate-600">{label}</dt><dd className="font-semibold">{counts[key] ?? 0}</dd></div>)}</dl>
    <p className="mt-2 text-xs text-slate-500">Completed status means the workflow was finalized. Historical records do not verify attendance.</p>
  </section>;
}
