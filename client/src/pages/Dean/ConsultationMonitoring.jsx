import ResponsiveTable from "../../components/ResponsiveTable";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/apiClient";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../../utils/appointmentStatus";
import { formatManilaDate, formatManilaTime } from "../../utils/formatDateTime";
import { StatusBadge } from "../../components/UI";
import ConsultationDetailsDialog from "../../components/dean/ConsultationDetailsDialog";

function ParticipantFilter({ role, value, onChange }) {
  const [search, setSearch] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError(false);
    const timer = setTimeout(() => {
      api(`/dean/consultations/filter-options?${new URLSearchParams({ role, search, limit: "20" })}`, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) setResult(data); })
        .catch(() => { if (!controller.signal.aborted) setError(true); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [role, search, retry]);
  const label = role === "faculty" ? "Faculty" : "Student";
  return <fieldset className="min-w-0 space-y-2 text-sm"><legend className="font-semibold text-slate-700">{label}</legend>
    <input aria-label={`Find ${label}`} className="field" placeholder={`Find ${label.toLowerCase()} by name`} maxLength={100} value={search} onChange={event => setSearch(event.target.value)} />
    <select aria-describedby={error ? `monitoring-${role}-options-error` : undefined} aria-label={label} className="field" value={value || ""} onChange={event => onChange(event.target.value)}>
      <option value="">All {label}</option>{value && !result?.options.some(option => option.userId === value) && <option value={value}>Selected {label.toLowerCase()}</option>}
      {result?.options.map(option => <option key={option.userId} value={option.userId}>{option.name}{option.role === "dean" ? " (Dean)" : ""}</option>)}
    </select>
    {error ? <p id={`monitoring-${role}-options-error`} role="alert" className="text-xs text-red-700">Unable to load {label.toLowerCase()} options. <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : !result ? <p role="status" className="text-xs text-slate-500">Loading options…</p> : result.hasMore ? <p className="text-xs text-slate-500">More participants available. Refine the name search.</p> : null}
  </fieldset>;
}

function Schedule({ row }) {
  if (!row.startAt) return "Not scheduled";
  const sameDay = row.endAt && formatManilaDate(row.startAt) === formatManilaDate(row.endAt);
  return <span className="whitespace-nowrap">{formatManilaDate(row.startAt)}<span className="block text-xs text-slate-600">{formatManilaTime(row.startAt)}{row.endAt ? ` – ${sameDay ? "" : `${formatManilaDate(row.endAt)} `}${formatManilaTime(row.endAt)}` : ""}</span></span>;
}

export default function ConsultationMonitoring() {
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const [search, setSearch] = useState(params.get("search") || "");
  const [dates, setDates] = useState({ start: params.get("start") || "", end: params.get("end") || "" });
  const [dateError, setDateError] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [details, setDetails] = useState(null);
  const searchTimer = useRef(null);
  const querySearch = params.get("search") || "";
  const queryStart = params.get("start") || "";
  const queryEnd = params.get("end") || "";
  useEffect(() => { setSearch(querySearch); }, [querySearch]);
  useEffect(() => { setDates({ start: queryStart, end: queryEnd }); }, [queryStart, queryEnd]);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    api(`/dean/consultations${query ? `?${query}` : ""}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (!controller.signal.aborted) setError(err.status === 400 ? "Invalid filters. Check the request dates and filter values." : "Unable to load consultations. Please try again."); });
    return () => controller.abort();
  }, [query, retry]);
  const update = changes => {
    const next = new URLSearchParams(params);
    if (search.trim()) next.set("search", search.trim());
    else next.delete("search");
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    next.set("page", "1");
    setParams(next);
  };
  const changeSearch = value => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => update({ search: value.trim() }), 300);
  };
  const changeDate = (key, value) => {
    const next = { ...dates, [key]: value };
    setDates(next);
    if (!next.start && !next.end) { setDateError(""); update({ start: "", end: "" }); return; }
    if (!next.start || !next.end) {
      if (params.has("start") || params.has("end")) {
        setDates({ start: "", end: "" });
        setDateError("");
        update({ start: "", end: "" });
      } else setDateError("Choose both start and end dates.");
      return;
    }
    const days = (Date.parse(`${next.end}T00:00:00Z`) - Date.parse(`${next.start}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > 365) { setDateError("Choose a date range of up to 366 days, with the start before the end."); return; }
    setDateError("");
    update(next);
  };
  const activeFilters = [...params.keys()].some(key => !["page", "limit", "sort"].includes(key));
  const advancedFilters = ["facultyId", "studentId", "start", "end", "mode", "sort"].some(key => params.has(key));
  const page = data?.pagination.page || 1;
  const paginate = next => { const updated = new URLSearchParams(params); updated.set("page", String(next)); setParams(updated); };
  const view = row => <button type="button" className="btn-action-sm whitespace-nowrap" onClick={() => setDetails(row.recordId)}>View Details</button>;
  return <div className="w-full min-w-0 space-y-5 pb-16">
    <header><h1 className="text-2xl font-bold text-maroon-900">Consultation Monitoring</h1><p className="mt-1 text-sm text-slate-600">Read-only School of Computing consultation records. Times are shown in Asia/Manila.</p></header>
    <section aria-label="Consultation filters" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <label className="text-sm font-semibold text-slate-700">Search consultations<input type="search" maxLength={150} className="field mt-2" placeholder="Record ID, subject, or participant name" value={search} onChange={event => changeSearch(event.target.value)} /></label>
      <label className="text-sm font-semibold text-slate-700">Appointment status<select className="field mt-2" value={params.get("status") || ""} onChange={event => update({ status: event.target.value })}><option value="">All statuses</option>{APPOINTMENT_STATUSES.map(status => <option key={status}>{status}</option>)}{LEGACY_APPOINTMENT_STATUSES.map(status => <option key={status} value={status}>{status} (Legacy)</option>)}</select></label>
      <details className="sm:col-span-2"><summary className="w-fit cursor-pointer text-sm font-medium text-maroon-800">More filters{advancedFilters ? " · Active" : ""}</summary>
        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <ParticipantFilter role="faculty" value={params.get("facultyId")} onChange={value => update({ facultyId: value })} />
          <ParticipantFilter role="student" value={params.get("studentId")} onChange={value => update({ studentId: value })} />
          <fieldset className="space-y-2 text-sm"><legend className="font-semibold text-slate-700">Request date · Asia/Manila</legend><div className="flex gap-2"><label className="min-w-0 flex-1 text-slate-600">Start<input aria-label="Request start date" type="date" className="field mt-1" value={dates.start} onChange={event => changeDate("start", event.target.value)} /></label><label className="min-w-0 flex-1 text-slate-600">End<input aria-label="Request end date" type="date" className="field mt-1" value={dates.end} onChange={event => changeDate("end", event.target.value)} /></label></div>{dateError && <p role="alert" className="text-xs text-red-700">{dateError}</p>}</fieldset>
          <label className="text-sm font-semibold text-slate-700">Consultation mode<select className="field mt-2" value={params.get("mode") || ""} onChange={event => update({ mode: event.target.value })}><option value="">All modes</option><option>Online</option><option>Face-to-Face</option></select></label>
          <label className="text-sm font-semibold text-slate-700">Sort<select className="field mt-2" value={params.get("sort") || "newest"} onChange={event => update({ sort: event.target.value })}><option value="newest">Newest requests first</option><option value="oldest">Oldest requests first</option></select></label>
        </div>
      </details>
    </section>
    <section aria-label="Consultation records" aria-busy={!data && !error}>
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">{error} <button type="button" className="ml-2 underline" onClick={() => setRetry(n => n + 1)}>Retry</button></div> : !data ? <p role="status" className="py-10 text-center text-sm text-slate-600">Loading consultations…</p> : <>
        {!data.consultations.length ? <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">{activeFilters ? "No consultations match these filters." : page > 1 ? "No consultations on this page." : "No consultations found."}</p> : <>
          <div className="space-y-3 lg:hidden">{data.consultations.map(row => <article key={row.recordId} className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold text-slate-900">{row.subject || "Subject not recorded"}</h2><p className="mt-1 text-slate-600">{row.studentName || "Student unavailable"} · {row.facultyName || "Faculty unavailable"}</p></div><div className="text-right"><StatusBadge status={row.status || "Unavailable"} allowWrap compact />{row.legacy && <span className="mt-1 block text-xs text-slate-500">Legacy</span>}</div></div><p className="mt-3 text-slate-700"><Schedule row={row} /></p><div className="mt-3">{view(row)}</div></article>)}</div>
          <ResponsiveTable label="Consultation monitoring" className="hidden overflow-x-auto rounded-xl border border-slate-200 lg:block"><table className="w-full min-w-[900px] bg-white text-left text-sm"><caption className="sr-only">School of Computing consultations — read-only</caption><thead className="bg-maroon-800 text-white"><tr>{["Student", "Faculty", "Subject/course", "Schedule", "Status", "View"].map(label => <th key={label} scope="col" className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{data.consultations.map(row => <tr key={row.recordId} className="border-t border-slate-200 align-middle"><td className="max-w-[11rem] px-3 py-3 font-medium text-slate-900">{row.studentName || "Unavailable"}</td><td className="max-w-[11rem] px-3 py-3">{row.facultyName || "Unavailable"}</td><td className="min-w-[12rem] max-w-[18rem] break-words px-3 py-3">{row.subject || "Not recorded"}</td><td className="min-w-[11rem] px-3 py-3"><Schedule row={row} /></td><td className="min-w-[10rem] px-3 py-3"><StatusBadge status={row.status || "Unavailable"} allowWrap compact />{row.legacy && <span className="mt-1 block text-xs text-slate-500">Legacy</span>}</td><td className="px-3 py-3">{view(row)}</td></tr>)}</tbody></table></ResponsiveTable>
        </>}
        <nav aria-label="Consultation pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p>{data.pagination.total} records · Page {page} of {Math.max(1, data.pagination.totalPages)}</p><div className="flex gap-2"><button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => paginate(page - 1)}>Previous</button><button type="button" className="btn-secondary" disabled={page >= data.pagination.totalPages} onClick={() => paginate(page + 1)}>Next</button></div></nav>
      </>}
    </section>
    {details && <ConsultationDetailsDialog key={details} recordId={details} onClose={() => setDetails(null)} />}
  </div>;
}
