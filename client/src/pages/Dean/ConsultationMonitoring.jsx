import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/apiClient";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../../utils/appointmentStatus";
import ConsultationDetailsDialog, { monitoringDate } from "../../components/dean/ConsultationDetailsDialog";

function ParticipantFilter({ role, value, onChange }) {
  const [search, setSearch] = useState(""), [result, setResult] = useState(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(false);
    const timer = setTimeout(() => {
      api(`/dean/consultations/filter-options?${new URLSearchParams({ role, search, limit: "20" })}`, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) setResult(data); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [role, search, retry]);
  const label = role === "faculty" ? "Faculty" : "Student";
  return <fieldset className="min-w-0 space-y-1"><legend className="font-semibold">{label}</legend>
    <input aria-label={`Find ${label}`} className="w-full rounded border p-2" placeholder={`Find ${label.toLowerCase()} by name`} maxLength={100} value={search} onChange={event => setSearch(event.target.value)} />
    <select aria-label={label} className="w-full rounded border p-2" value={value || ""} onChange={event => onChange(event.target.value)}>
      <option value="">All {label}</option>{value && !result?.options.some(option => option.userId === value) && <option value={value}>Selected {label.toLowerCase()}</option>}
      {result?.options.map(option => <option key={option.userId} value={option.userId}>{option.name}{option.role === "dean" ? " (Dean)" : ""}</option>)}
    </select>
    {error ? <p role="alert">Unable to load options. <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : !result ? <p role="status">Loading options…</p> : result.hasMore ? <p className="text-xs">More participants available. Refine the name search.</p> : null}
  </fieldset>;
}
export default function ConsultationMonitoring() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(() => Object.fromEntries(params));
  const [data, setData] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0), [details, setDetails] = useState(null);
  const query = params.toString();
  useEffect(() => { setFilters(Object.fromEntries(new URLSearchParams(query))); }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(""); setDetails(null);
    api(`/dean/consultations${query ? `?${query}` : ""}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (!controller.signal.aborted) setError(err.status === 400 ? "Invalid filters. Check the request dates and filter values, or reset filters." : "Unable to load consultations. Please try again."); });
    return () => controller.abort();
  }, [query, retry]);
  const change = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
  const apply = event => { event.preventDefault(); setParams(Object.fromEntries(Object.entries({ ...filters, page: "1" }).filter(([, value]) => value !== ""))); };
  const reset = () => { setFilters({}); setParams({}); setRetry(n => n + 1); };
  const activeFilters = Object.keys(Object.fromEntries(params)).some(key => !["page", "limit", "sort"].includes(key));
  const page = data?.pagination.page || 1;
  const paginate = next => { const updated = new URLSearchParams(params); updated.set("page", String(next)); setParams(updated); };
  return <div className="min-w-0 space-y-5">
    <header><h1 className="text-2xl font-bold text-maroon-900">Consultation Monitoring</h1><p className="text-sm text-slate-500">Read-only School of Computing consultation records. Times use Asia/Manila.</p></header>
    <form onSubmit={apply} className="grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="font-semibold">Search<input type="search" maxLength={150} className="block w-full rounded border p-2 font-normal" placeholder="Record ID, subject, or participant name" value={filters.search || ""} onChange={event => change("search", event.target.value)} /></label>
      <fieldset><legend className="font-semibold">Request date — Asia/Manila</legend><div className="flex gap-2"><label className="min-w-0">Start<input aria-label="Request start date" type="date" className="block w-full rounded border p-2" required={!!filters.end} value={filters.start || ""} onChange={event => change("start", event.target.value)} /></label><label className="min-w-0">End<input aria-label="Request end date" type="date" className="block w-full rounded border p-2" required={!!filters.start} value={filters.end || ""} onChange={event => change("end", event.target.value)} /></label></div></fieldset>
      <ParticipantFilter role="faculty" value={filters.facultyId} onChange={value => change("facultyId", value)} />
      <ParticipantFilter role="student" value={filters.studentId} onChange={value => change("studentId", value)} />
      <label className="font-semibold">Appointment status<select className="block w-full rounded border p-2 font-normal" value={filters.status || ""} onChange={event => change("status", event.target.value)}><option value="">All statuses</option>{APPOINTMENT_STATUSES.map(status => <option key={status}>{status}</option>)}{LEGACY_APPOINTMENT_STATUSES.map(status => <option key={status} value={status}>{status} (Legacy)</option>)}</select></label>
      <label className="font-semibold">Consultation mode<select className="block w-full rounded border p-2 font-normal" value={filters.mode || ""} onChange={event => change("mode", event.target.value)}><option value="">All modes</option><option>Online</option><option>Face-to-Face</option></select></label>
      <label className="font-semibold">Attendance Outcome<select disabled aria-describedby="attendance-filter-help" className="block w-full rounded border bg-slate-100 p-2"><option>Unavailable</option></select><span id="attendance-filter-help" className="text-xs font-normal">Attendance filtering will be available after attendance records are implemented.</span></label>
      <label className="font-semibold">Sort<select className="block w-full rounded border p-2" value={filters.sort || "newest"} onChange={event => change("sort", event.target.value)}><option value="newest">Newest requests first</option><option value="oldest">Oldest requests first</option></select></label>
      <div className="flex items-end gap-3"><button className="btn-primary" type="submit">Apply filters</button><button className="btn-secondary" type="button" onClick={reset}>Reset filters</button></div>
    </form>
    {error ? <div role="alert" className="rounded border p-5">{error} <button type="button" className="btn-secondary" onClick={() => setRetry(n => n + 1)}>Retry</button></div> : !data ? <p role="status">Loading consultations…</p> : <>
      {!data.consultations.length ? <p role="status" className="rounded border bg-white p-6">{activeFilters ? "No consultations match these filters." : page > 1 ? "No consultations on this page." : "No consultations found."}</p> : <div className="overflow-x-auto rounded border bg-white"><table className="w-full min-w-[1250px] text-left text-sm"><caption className="sr-only">School of Computing consultations — read-only</caption><thead className="bg-maroon-800 text-white"><tr>{["Record ID", "Student", "Faculty", "Subject/course", "Current/requested schedule", "Mode", "Status", "Created", "Updated", "Action"].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>{data.consultations.map(row => <tr key={row.recordId} className="border-t align-top">
        <td className="break-all p-3 font-mono text-xs">{row.recordId}</td><td className="p-3">{row.studentName || "Unavailable"}</td><td className="p-3">{row.facultyName || "Unavailable"}</td><td className="max-w-xs break-words p-3">{row.subject}</td><td className="p-3">{row.startAt ? `${monitoringDate(row.startAt)} – ${monitoringDate(row.endAt)}` : "Not scheduled"}</td><td className="p-3">{row.mode || "Unavailable"}</td><td className="p-3"><span className={`inline-block rounded border px-2 py-1 ${row.legacy ? "bg-amber-50" : "bg-slate-50"}`}>{row.status}{row.legacy ? " (Legacy)" : ""}</span><p className="mt-1 text-xs">{row.attendance?.finalOutcome || (row.status === "Completed" ? "Attendance not verified" : "Outcome unresolved")}</p></td><td className="p-3">{monitoringDate(row.createdAt)}</td><td className="p-3">{monitoringDate(row.updatedAt)}</td><td className="p-3"><button type="button" className="btn-secondary" onClick={() => setDetails(row.recordId)}>View Details</button></td>
      </tr>)}</tbody></table></div>}
      <nav aria-label="Consultation pagination" className="flex flex-wrap items-center justify-between gap-3"><p>{data.pagination.total} records · Page {page} of {Math.max(1, data.pagination.totalPages)}</p><div className="flex gap-3"><button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => paginate(page - 1)}>Previous</button><button type="button" className="btn-secondary" disabled={page >= data.pagination.totalPages} onClick={() => paginate(page + 1)}>Next</button></div></nav>
    </>}
    {details && <ConsultationDetailsDialog key={details} recordId={details} onClose={() => setDetails(null)} />}
  </div>;
}
