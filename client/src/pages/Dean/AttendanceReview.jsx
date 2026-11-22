import ResponsiveTable from "../../components/ResponsiveTable";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/apiClient";
import { formatManilaDate, formatManilaDateTime } from "../../utils/formatDateTime";
import AttendanceReviewDetails from "../../components/attendance/AttendanceReviewDetails";

export const reviewTriggers = {
  responses_conflict: "Responses differ",
  student_response_missing: "Student response missing",
  faculty_response_missing: "Faculty response missing",
  both_responses_missing: "Both responses missing",
  initiator_report_disputed: "Initiator report disputed",
};

function ParticipantFilter({ role, value, onChange }) {
  const [search, setSearch] = useState(""), [data, setData] = useState(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError(false);
    const timer = setTimeout(() => api(`/dean/attendance-review/filter-options?${new URLSearchParams({ role, search, limit: "20" })}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); }).catch(() => { if (!controller.signal.aborted) setError(true); }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [role, search, retry]);
  const label = role === "student" ? "Student" : "Faculty";
  return <fieldset className="min-w-0 space-y-2 text-sm"><legend className="font-semibold text-slate-700">{label}</legend>
    <input className="field" aria-label={`Find ${label}`} maxLength={100} value={search} placeholder="Find by name" onChange={event => setSearch(event.target.value)} />
    <select aria-describedby={error ? `review-${role}-options-error` : undefined} className="field" aria-label={label} value={value || ""} onChange={event => onChange(event.target.value)}>
      <option value="">All {label.toLowerCase()}</option>{value && !data?.options.some(option => option.userId === value) && <option value={value}>Selected {label.toLowerCase()}</option>}{data?.options.map(option => <option key={option.userId} value={option.userId}>{option.name}</option>)}
    </select>
    {error ? <p id={`review-${role}-options-error`} role="alert" className="text-xs text-red-700">Options unavailable. <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : !data ? <p role="status" className="text-xs text-slate-500">Loading options…</p> : data.hasMore ? <p className="text-xs text-slate-500">Refine the name search for more options.</p> : null}
  </fieldset>;
}

export default function AttendanceReview() {
  const { reviewId } = useParams(), navigate = useNavigate();
  const [params, setParams] = useSearchParams(), query = params.toString();
  const [search, setSearch] = useState(""), [term, setTerm] = useState("");
  const [dates, setDates] = useState({ start: params.get("start") || "", end: params.get("end") || "" }), [dateError, setDateError] = useState("");
  const [data, setData] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0), [details, setDetails] = useState(null);
  useEffect(() => { if (reviewId) setDetails(reviewId); }, [reviewId]);
  useEffect(() => { const timer = setTimeout(() => setTerm(search.trim().toLocaleLowerCase()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setDates({ start: params.get("start") || "", end: params.get("end") || "" }); }, [query]);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    api(`/dean/attendance-review${query ? `?${query}` : ""}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (!controller.signal.aborted) setError(err.status === 400 ? "Invalid filters. Check the review dates and filter values." : "Unable to load attendance reviews."); });
    return () => controller.abort();
  }, [query, retry]);
  const update = changes => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    next.set("page", "1"); setParams(next);
  };
  const changeDate = (key, value) => {
    const next = { ...dates, [key]: value }; setDates(next);
    if (!next.start && !next.end) { setDateError(""); update({ start: "", end: "" }); return; }
    if (!next.start || !next.end) { setDateError("Choose both start and end dates."); if (params.has("start") || params.has("end")) update({ start: "", end: "" }); return; }
    const days = (Date.parse(`${next.end}T00:00:00Z`) - Date.parse(`${next.start}T00:00:00Z`)) / 86400000;
    if (!Number.isFinite(days) || days < 0 || days > 365) { setDateError("Choose a date range of up to 366 days, with the start before the end."); return; }
    setDateError(""); update(next);
  };
  const advanced = ["start", "end", "studentId", "facultyId", "reviewReason", "sort"].some(key => params.has(key));
  const page = data?.pagination.page || 1;
  const rows = (data?.reviews || []).filter(row => !term || [row.studentName, row.facultyName, row.subject, reviewTriggers[row.reviewReason]].some(value => String(value || "").toLocaleLowerCase().includes(term)));
  const paginate = next => { const updated = new URLSearchParams(params); updated.set("page", String(next)); setParams(updated); };
  const review = row => <button type="button" className="btn-action-sm whitespace-nowrap" aria-label={`Review ${row.subject || "consultation"} for ${row.studentName || "student"}`} onClick={() => setDetails(row.recordId)}>Review</button>;
  return <div className="w-full min-w-0 space-y-5 pb-16">
    <header><h1 className="text-2xl font-bold text-maroon-900">Attendance Review</h1><p className="mt-1 text-sm text-slate-600">Unresolved attendance records. Times are shown in Asia/Manila.</p></header>
    <section aria-label="Attendance review filters" className="rounded-xl border border-slate-200 bg-white p-4">
      <label className="block max-w-xl text-sm font-semibold text-slate-700">Search this page<input type="search" maxLength={150} className="field mt-2" placeholder="Student, faculty, subject, or reason" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <p className="mt-1 text-xs text-slate-500">Searches the current page of reviews. Use More filters to narrow the full queue.</p>
      <details className="mt-4"><summary className="w-fit cursor-pointer text-sm font-medium text-maroon-800">More filters{advanced ? " · Active" : ""}</summary>
        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <fieldset className="space-y-2 text-sm"><legend className="font-semibold text-slate-700">Review date · Asia/Manila</legend><div className="flex gap-2"><label className="min-w-0 flex-1 text-slate-600">Start<input aria-label="Review start date" type="date" className="field mt-1" value={dates.start} onChange={event => changeDate("start", event.target.value)} /></label><label className="min-w-0 flex-1 text-slate-600">End<input aria-label="Review end date" type="date" className="field mt-1" value={dates.end} onChange={event => changeDate("end", event.target.value)} /></label></div>{dateError && <p role="alert" className="text-xs text-red-700">{dateError}</p>}</fieldset>
          <ParticipantFilter role="student" value={params.get("studentId")} onChange={value => update({ studentId: value })} />
          <ParticipantFilter role="faculty" value={params.get("facultyId")} onChange={value => update({ facultyId: value })} />
          <label className="text-sm font-semibold text-slate-700">Review reason<select className="field mt-2" value={params.get("reviewReason") || ""} onChange={event => update({ reviewReason: event.target.value })}><option value="">All reasons</option>{Object.entries(reviewTriggers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">Sort<select className="field mt-2" value={params.get("sort") || "newest"} onChange={event => update({ sort: event.target.value })}><option value="newest">Newest reviews first</option><option value="oldest">Oldest reviews first</option></select></label>
        </div>
      </details>
    </section>
    <section aria-label="Attendance reviews" aria-busy={!data && !error}>
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">{error} <button type="button" className="ml-2 underline" onClick={() => setRetry(n => n + 1)}>Retry</button></div> : !data ? <p role="status" className="py-10 text-center text-sm text-slate-600">Loading attendance reviews…</p> : <>
        {!rows.length ? <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">{term && data.reviews.length ? "No reviews on this page match your search." : advanced ? "No attendance reviews match these filters." : page > 1 ? "No attendance reviews on this page." : "No unresolved attendance reviews."}</p> : <>
          <div className="space-y-3 lg:hidden">{rows.map(row => <article key={row.recordId} className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><h2 className="break-words font-semibold text-slate-900">{row.subject || "Subject not recorded"}</h2><p className="mt-1 text-slate-700">{row.studentName || "Student unavailable"} · {row.facultyName || "Faculty unavailable"}</p><p className="mt-2 text-slate-600">{reviewTriggers[row.reviewReason] || "Reason unavailable"} · {formatManilaDate(row.reviewStartedAt)}</p><div className="mt-3">{review(row)}</div></article>)}</div>
          <ResponsiveTable label="Attendance reviews" className="hidden overflow-x-auto rounded-xl border border-slate-200 lg:block"><table className="w-full min-w-[780px] bg-white text-left text-sm"><caption className="sr-only">Unresolved attendance reviews</caption><thead className="bg-maroon-800 text-white"><tr>{["Student", "Faculty", "Subject/course", "Review reason", "Review date", "Action"].map(label => <th scope="col" className="px-3 py-3 font-semibold" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr className="border-t border-slate-200 align-middle" key={row.recordId}><td className="min-w-[9rem] max-w-[12rem] px-3 py-3 font-medium text-slate-900">{row.studentName || "Unavailable"}</td><td className="min-w-[9rem] max-w-[12rem] px-3 py-3">{row.facultyName || "Unavailable"}</td><td className="min-w-[12rem] max-w-[20rem] break-words px-3 py-3">{row.subject || "Not recorded"}</td><td className="min-w-[11rem] px-3 py-3">{reviewTriggers[row.reviewReason] || "Unavailable"}</td><td className="whitespace-nowrap px-3 py-3" title={formatManilaDateTime(row.reviewStartedAt)}>{formatManilaDate(row.reviewStartedAt)}</td><td className="px-3 py-3">{review(row)}</td></tr>)}</tbody></table></ResponsiveTable>
        </>}
        <nav aria-label="Review pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p>{data.pagination.total} records · Page {page} of {Math.max(1, data.pagination.totalPages)}</p><div className="flex gap-2"><button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => paginate(page - 1)}>Previous</button><button type="button" className="btn-secondary" disabled={page >= data.pagination.totalPages} onClick={() => paginate(page + 1)}>Next</button></div></nav>
      </>}
    </section>
    {details && <AttendanceReviewDetails key={details} recordId={details} onClose={() => { setDetails(null); if (reviewId) navigate("/dean/attendance-review", { replace: true }); }} onChanged={() => setRetry(n => n + 1)} />}
  </div>;
}
