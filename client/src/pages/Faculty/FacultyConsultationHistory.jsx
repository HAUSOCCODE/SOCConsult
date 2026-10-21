import { CalendarDays, Eye, FilterX, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import FacultyAppointmentDetailsModal from "../../components/appointments/FacultyAppointmentDetailsModal";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../../components/UI";
import { formatManilaDisplay } from "../../utils/formatDateTime";
import { formatPersonName } from "../../utils/formatPersonName";

const STATUSES = ["Completed", "Cancelled", "Rejected", "Expired", "Attendance Review"];
const OUTCOMES = ["Completed", "Student No-show", "Faculty No-show"];
const MODES = ["Online", "Face-to-Face"];
const EMPTY = { from: "", to: "", status: "", attendanceOutcome: "", mode: "", search: "" };
const safeMessage = error => error?.status === 400 ? "Review the selected history filters and try again."
  : error?.status === 401 ? "Your session has expired. Please sign in again."
    : error?.status === 403 ? "You don't have permission to access this content."
      : error?.status === 0 ? "Network connection interrupted. Check your connection and try again."
        : "We couldn't load consultation history. Please try again.";

export default function FacultyConsultationHistory() {
  const [draft, setDraft] = useState(EMPTY), [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState({ loading: false, error: "", appointment: null });
  const sequence = useRef(0), detailSequence = useRef(0);
  const dateError = draft.from && draft.to && draft.from > draft.to ? "Date From must be on or before Date To." : "";

  useEffect(() => {
    const current = ++sequence.current, controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), limit: "10" });
    Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
    setState(previous => ({ ...previous, loading: true, error: "" }));
    api(`/appointments/faculty-history?${query}`, { signal: controller.signal })
      .then(data => current === sequence.current && setState({ loading: false, data, error: "" }))
      .catch(error => error.name !== "AbortError" && current === sequence.current && setState({ loading: false, data: null, error: safeMessage(error) }));
    return () => controller.abort();
  }, [filters, page, revision]);

  const apply = event => { event.preventDefault(); if (!dateError) { setPage(1); setFilters({ ...draft, search: draft.search.trim() }); } };
  const clear = () => { setDraft(EMPTY); setFilters(EMPTY); setPage(1); };
  const closeDetails = () => { detailSequence.current += 1; setSelected(null); setDetail({ loading: false, error: "", appointment: null }); };
  const openDetails = async id => {
    const current = ++detailSequence.current;
    setSelected(id); setDetail({ loading: true, error: "", appointment: null });
    try {
      const response = await api(`/appointments/consultations/${id}`);
      if (current === detailSequence.current) setDetail({ loading: false, error: "", appointment: response.appointment || response });
    } catch (error) {
      if (current === detailSequence.current) setDetail({ loading: false, error: safeMessage(error), appointment: null });
    }
  };
  const consultations = state.data?.consultations || [], pagination = state.data?.pagination;
  const filtered = Object.values(filters).some(Boolean);

  return <div className="min-w-0 space-y-5 pb-16 md:pb-0">
    <header className="rounded-2xl border border-maroon-100 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-700">Faculty Records</p>
      <h1 className="mt-1 text-2xl font-bold text-maroon-900 sm:text-3xl">Consultation History</h1>
      <p className="mt-2 text-sm text-slate-600">Review your completed and closed personal consultations.</p>
    </header>
    <form onSubmit={apply} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="faculty-history-filters">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="faculty-history-filters" className="font-bold text-maroon-900">Filter history</h2><button type="button" onClick={clear} disabled={!Object.values(draft).some(Boolean) && !filtered} className="btn-secondary inline-flex min-h-10 items-center gap-2 disabled:opacity-50"><FilterX size={16} /> Clear Filters</button></div>
      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Date From"><input className="field" type="date" value={draft.from} onChange={e => setDraft(v => ({ ...v, from: e.target.value }))} /></Field>
        <Field label="Date To"><input className="field" type="date" value={draft.to} onChange={e => setDraft(v => ({ ...v, to: e.target.value }))} /></Field>
        <Field label="Appointment Status"><Select value={draft.status} onChange={status => setDraft(v => ({ ...v, status }))} empty="All historical statuses" values={STATUSES} /></Field>
        <Field label="Attendance Outcome"><Select value={draft.attendanceOutcome} onChange={attendanceOutcome => setDraft(v => ({ ...v, attendanceOutcome }))} empty="All outcomes" values={OUTCOMES} /></Field>
        <Field label="Consultation Mode"><Select value={draft.mode} onChange={mode => setDraft(v => ({ ...v, mode }))} empty="All modes" values={MODES} /></Field>
        <Field label="Student name or institutional ID"><div className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={16} /><input className="field pl-9" maxLength={100} value={draft.search} onChange={e => setDraft(v => ({ ...v, search: e.target.value }))} placeholder="Search Student" /></div></Field>
      </div>
      {dateError && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{dateError}</p>}
      <button type="submit" disabled={Boolean(dateError)} className="btn-primary mt-4 min-h-10 disabled:opacity-50">Apply Filters</button>
    </form>
    {state.loading && !state.data ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={() => setRevision(value => value + 1)} retryable={!state.error.includes("permission")} /> : consultations.length === 0 ? <EmptyState title={filtered ? "No historical consultations match the selected filters." : "No consultation history yet."} /> : <section className="space-y-3" aria-live="polite">
      {consultations.map(item => <HistoryItem key={item._id} item={item} onView={() => openDetails(item._id)} />)}
      <nav className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3" aria-label="Consultation history pagination"><button type="button" className="btn-secondary" disabled={pagination.page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><p className="text-sm font-semibold text-slate-700">Page {pagination.page} of {pagination.totalPages} · {pagination.total} records</p><button type="button" className="btn-secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(value => value + 1)}>Next</button></nav>
    </section>}
    {selected && detail.loading && <DetailState title="Loading consultation record..." onClose={closeDetails} />}
    {selected && detail.error && <DetailState title={detail.error} onClose={closeDetails} />}
    {selected && detail.appointment && <FacultyAppointmentDetailsModal personal appointment={detail.appointment} onClose={closeDetails} />}
  </div>;
}

function Field({ label, children }) { return <label className="min-w-0 text-sm font-bold text-slate-700"><span className="mb-1.5 block">{label}</span>{children}</label>; }
function Select({ value, onChange, empty, values }) { return <select className="field" value={value} onChange={e => onChange(e.target.value)}><option value="">{empty}</option>{values.map(item => <option key={item}>{item}</option>)}</select>; }
function when(value) { return value ? formatManilaDisplay(new Date(value), { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, "timestamp") : "Schedule unavailable"; }
function HistoryItem({ item, onView }) { return <article className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-center"><div className="min-w-0"><h2 className="break-words font-bold text-slate-900">{item.subject || "Consultation"}</h2><p className="mt-1 break-words text-sm text-slate-600">{formatPersonName(item.student) || "Student unavailable"}{item.student?.studentId || item.student?.institutionalId ? ` · ${item.student.studentId || item.student.institutionalId}` : ""}</p><p className="mt-2 flex items-start gap-2 text-sm text-slate-600"><CalendarDays size={15} className="mt-0.5 shrink-0" />{when(item.startAt)}</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Appointment Status</p><div className="mt-1"><StatusBadge appointment status={item.status} allowWrap compact /></div></div><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Attendance Outcome</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{item.finalAttendanceOutcome || "Not finalized"}</p><p className="mt-1 text-sm text-slate-600">{item.consultationMode}</p></div><button type="button" onClick={onView} className="btn-primary inline-flex min-h-10 items-center justify-center gap-2"><Eye size={16} /> View Details</button></article>; }
function DetailState({ title, onClose }) { return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><p className="text-sm text-slate-700">{title}</p><button type="button" className="btn-secondary mt-4" onClick={onClose}>Close</button></section></div>; }
