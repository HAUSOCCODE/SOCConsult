const STATUSES = ["Completed", "Cancelled", "Rejected", "Expired", "Attendance Review"];
const OUTCOMES = ["Completed", "Student No-show", "Faculty No-show"];
const MODES = ["Online", "Face-to-Face"];

export default function FacultyReportFilters({ filters, onChange, onClear, onSubmit, busy, error }) {
  return <form onSubmit={onSubmit} aria-busy={busy} aria-describedby={error ? "faculty-report-error" : undefined} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="mb-2 font-bold text-maroon-900">Report filters</legend>
      <Field label="Start Date"><input required type="date" className="field mt-1" value={filters.startDate} onChange={event => onChange("startDate", event.target.value)} /></Field>
      <Field label="End Date"><input required type="date" className="field mt-1" value={filters.endDate} onChange={event => onChange("endDate", event.target.value)} /></Field>
      <Field label="Appointment Status"><Select value={filters.status} values={STATUSES} onChange={value => onChange("status", value)} /></Field>
      <Field label="Attendance Outcome"><Select value={filters.attendanceOutcome} values={OUTCOMES} onChange={value => onChange("attendanceOutcome", value)} /></Field>
      <Field label="Consultation Mode"><Select value={filters.mode} values={MODES} onChange={value => onChange("mode", value)} /></Field>
    </fieldset>
    <p className="text-sm text-slate-600">Reports cover at most 366 days and contain only your historical consultation records. Appointment status and attendance outcome are reported separately.</p>
    <div className="flex flex-wrap gap-3"><button type="submit" className="btn-primary min-h-10" disabled={busy}>{busy ? "Generating PDF..." : "Generate PDF"}</button><button type="button" className="btn-secondary min-h-10" disabled={busy} onClick={onClear}>Clear Filters</button></div>
    {error && <p id="faculty-report-error" role="alert" className="break-words text-sm font-semibold text-red-700">{error}</p>}
  </form>;
}
function Field({ label, children }) { return <label className="min-w-0 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>; }
function Select({ value, values, onChange }) { return <select className="field mt-1" value={value} onChange={event => onChange(event.target.value)}><option value="">All</option>{values.map(item => <option key={item}>{item}</option>)}</select>; }
