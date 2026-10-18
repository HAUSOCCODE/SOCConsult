import ResponsiveTable from "../../components/ResponsiveTable";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/apiClient";
import AttendanceReviewDetails from "../../components/attendance/AttendanceReviewDetails";
import { monitoringDate } from "../../components/dean/ConsultationDetailsDialog";

const triggers = { responses_conflict: "Responses differ", student_response_missing: "Student response missing", faculty_response_missing: "Faculty response missing", both_responses_missing: "Both responses missing" };
function ParticipantFilter({ role, value, onChange }) {
  const [search, setSearch] = useState(""), [data, setData] = useState(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError(false);
    const timer = setTimeout(() => api(`/dean/attendance-review/filter-options?${new URLSearchParams({ role, search, limit: "20" })}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); }).catch(() => { if (!controller.signal.aborted) setError(true); }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [role, search, retry]);
  const label = role === "student" ? "Student" : "Faculty";
  return <fieldset><legend className="font-semibold">{label}</legend><input className="field w-full" aria-label={`Find ${label}`} maxLength={100} value={search} placeholder="Search by name" onChange={event => setSearch(event.target.value)} /><select aria-describedby={error ? `review-${role}-options-error` : undefined} className="field mt-1 w-full" aria-label={label} value={value || ""} onChange={event => onChange(event.target.value)}><option value="">All {label}</option>{value && !data?.options.some(option => option.userId === value) && <option value={value}>Selected {label}</option>}{data?.options.map(option => <option key={option.userId} value={option.userId}>{option.name}</option>)}</select>{error ? <p id={`review-${role}-options-error`} role="alert">Options unavailable. <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : !data ? <p role="status">Loading options…</p> : data.hasMore ? <p>Refine the name search for more options.</p> : null}</fieldset>;
}
export default function AttendanceReview() {
  const { reviewId } = useParams(), navigate = useNavigate();
  const [params, setParams] = useSearchParams(), query = params.toString();
  const [filters, setFilters] = useState(() => Object.fromEntries(params));
  const [data, setData] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0), [details, setDetails] = useState(null);
  useEffect(() => { if (reviewId) setDetails(reviewId); }, [reviewId]);
  useEffect(() => { setFilters(Object.fromEntries(new URLSearchParams(query))); }, [query]);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    api(`/dean/attendance-review${query ? `?${query}` : ""}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (!controller.signal.aborted) setError(err.status === 400 ? "Invalid filters. Check the dates or reset filters." : "Unable to load attendance reviews."); });
    return () => controller.abort();
  }, [query, retry]);
  const change = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
  const apply = event => { event.preventDefault(); setParams(Object.fromEntries(Object.entries({ ...filters, page: "1" }).filter(([, value]) => value !== ""))); };
  const page = data?.pagination.page || 1;
  const paginate = next => { const updated = new URLSearchParams(params); updated.set("page", String(next)); setParams(updated); };
  return <div className="min-w-0 space-y-5"><header><h1 className="text-2xl font-bold text-maroon-900">Attendance Review</h1><p className="text-sm text-slate-500">Unresolved School of Computing attendance records. Times use Asia/Manila.</p></header>
    <form aria-describedby={error ? "review-filter-error" : undefined} onSubmit={apply} className="grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-3">
      <fieldset><legend className="font-semibold">Date placed under review — Asia/Manila</legend><div className="flex flex-col gap-2 sm:flex-row">{["start", "end"].map(key => <label key={key} className="min-w-0 capitalize">{key}<input className="field block w-full" type="date" required={Boolean(filters[key === "start" ? "end" : "start"])} value={filters[key] || ""} onChange={event => change(key, event.target.value)} /></label>)}</div></fieldset>
      {["student", "faculty"].map(role => <ParticipantFilter key={role} role={role} value={filters[`${role}Id`]} onChange={value => change(`${role}Id`, value)} />)}
      <label>Review trigger<select className="field block w-full" value={filters.reviewReason || ""} onChange={event => change("reviewReason", event.target.value)}><option value="">All triggers</option>{Object.entries(triggers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Sort<select className="field block w-full" value={filters.sort || "newest"} onChange={event => change("sort", event.target.value)}><option value="newest">Newest reviews first</option><option value="oldest">Oldest reviews first</option></select></label>
      <div className="flex flex-wrap items-end gap-3"><button type="submit" className="btn-primary">Apply filters</button><button type="button" className="btn-secondary" onClick={() => { setFilters({}); setParams({}); setRetry(n => n + 1); }}>Reset filters</button></div>
    </form>
    {error ? <p id="review-filter-error" role="alert">{error} <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : !data ? <p role="status">Loading attendance reviews…</p> : <>
      {!data.reviews.length ? <p role="status" className="rounded border bg-white p-6">{Object.keys(filters).some(key => !["page", "limit", "sort"].includes(key) && filters[key]) ? "No attendance reviews match these filters." : "No unresolved attendance reviews on this page."}</p> : <ResponsiveTable label="Attendance reviews" className="overflow-x-auto rounded border bg-white"><table className="w-full min-w-[1000px] text-left text-sm"><caption className="sr-only">Unresolved attendance reviews</caption><thead><tr>{["Student", "Faculty", "Confirmed schedule", "Subject/course", "Mode", "Trigger", "Placed under review", "State", "Action"].map(label => <th scope="col" className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{data.reviews.map(row => <tr className="border-t align-top" key={row.recordId}><td className="p-3">{row.studentName || "Unavailable"}</td><td className="p-3">{row.facultyName || "Unavailable"}</td><td className="p-3">{monitoringDate(row.startAt)} – {monitoringDate(row.endAt)}</td><td className="p-3">{row.subject}</td><td className="p-3">{row.mode}</td><td className="p-3">{triggers[row.reviewReason] || "Unavailable"}</td><td className="p-3">{monitoringDate(row.reviewStartedAt)}</td><td className="p-3">{row.state}</td><td className="p-3"><button type="button" className="btn-secondary" onClick={() => setDetails(row.recordId)}>Review details</button></td></tr>)}</tbody></table></ResponsiveTable>}
      <nav aria-label="Review pagination" className="flex flex-wrap justify-between gap-3"><p>{data.pagination.total} records · Page {page} of {Math.max(1, data.pagination.totalPages)}</p><div className="flex gap-3"><button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => paginate(page - 1)}>Previous</button><button type="button" className="btn-secondary" disabled={page >= data.pagination.totalPages} onClick={() => paginate(page + 1)}>Next</button></div></nav>
    </>}
    {details && <AttendanceReviewDetails key={details} recordId={details} onClose={() => { setDetails(null); if (reviewId) navigate("/dean/attendance-review", { replace: true }); }} onChanged={() => setRetry(n => n + 1)} />}
  </div>;
}
