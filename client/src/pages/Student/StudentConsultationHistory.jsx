import { CalendarDays, Eye, FilterX, MapPin, Monitor } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import StudentAppointmentDetailsModal from "../../components/appointments/StudentAppointmentDetailsModal";
import Pagination from "../../components/Pagination";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../../components/UI";
import { formatPersonName } from "../../utils/formatPersonName";

const HISTORY_STATUSES = ["Completed", "Rejected", "Cancelled", "Expired", "Attendance Review"];
const MODES = ["Online", "Face-to-Face"];
const EMPTY_FILTERS = { from: "", to: "", faculty: "", status: "", mode: "" };
const MANILA_DATE = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" });
const MANILA_TIME = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
const validDate = value => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

export default function StudentConsultationHistory() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [retry, setRetry] = useState(0);
  const requestSequence = useRef(0);
  const dateError = filters.from && filters.to && filters.from > filters.to
    ? "From date must be on or before To date."
    : "";

  useEffect(() => {
    if (dateError) return undefined;
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page) });
    Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
    setError("");
    setLoading(true);
    api(`/appointments/student-history?${query}`, { signal: controller.signal })
      .then(response => {
        if (sequence === requestSequence.current) {
          setData(response);
          setLoading(false);
        }
      })
      .catch(requestError => {
        if (requestError.name !== "AbortError" && sequence === requestSequence.current) {
          setError(requestError.message || "Unable to load consultation history.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [dateError, filters, page, retry]);

  const updateFilter = (name, value) => {
    setFilters(current => ({ ...current, [name]: value }));
    setPage(1);
  };
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const consultations = Array.isArray(data?.consultations) ? data.consultations : [];
  const providers = useMemo(() => Array.isArray(data?.providers) ? [...data.providers].sort((a, b) =>
    formatPersonName(a).localeCompare(formatPersonName(b))) : [], [data?.providers]);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="w-full min-w-0 space-y-5 pb-16 md:pb-0">
      <header className="rounded-2xl border border-maroon-100 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-700">Consultation Records</p>
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-maroon-900 sm:text-[30px]">Consultation History</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Review your completed and closed consultation records. History is read-only.</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="history-filters-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="history-filters-title" className="font-bold text-maroon-900">Filter history</h2>
          <button type="button" onClick={clearFilters} disabled={!filtered} className="btn-secondary inline-flex min-h-10 items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"><FilterX size={16} /> Clear filters</button>
        </div>
        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Filter label="From"><input type="date" value={filters.from} onChange={event => updateFilter("from", event.target.value)} className="field" /></Filter>
          <Filter label="To"><input type="date" value={filters.to} onChange={event => updateFilter("to", event.target.value)} className="field" /></Filter>
          <Filter label="Faculty / Provider"><select value={filters.faculty} onChange={event => updateFilter("faculty", event.target.value)} className="field"><option value="">All providers</option>{providers.map(provider => <option key={provider._id} value={provider._id}>{formatPersonName(provider) || "Consultation Provider"}</option>)}</select></Filter>
          <Filter label="Status"><select value={filters.status} onChange={event => updateFilter("status", event.target.value)} className="field"><option value="">All statuses</option>{HISTORY_STATUSES.map(status => <option key={status}>{status}</option>)}</select></Filter>
          <Filter label="Consultation mode"><select value={filters.mode} onChange={event => updateFilter("mode", event.target.value)} className="field"><option value="">All modes</option>{MODES.map(mode => <option key={mode}>{mode}</option>)}</select></Filter>
        </div>
        {dateError && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{dateError}</p>}
      </section>

      {dateError ? null : loading ? <Loading /> : error ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} /> : (
        <section aria-live="polite">
          {consultations.length === 0 ? <EmptyState title={filtered ? "No historical consultations match the selected filters." : "No consultation history yet."} /> : <HistoryResults consultations={consultations} onView={setSelected} />}
          {data?.pagination?.total > 0 && <div className="mt-4 overflow-hidden rounded-xl border border-slate-200"><Pagination currentPage={data.pagination.page} totalItems={data.pagination.total} itemsPerPage={data.pagination.pageSize} itemLabel="consultation records" onPageChange={setPage} /></div>}
        </section>
      )}
      {selected && <StudentAppointmentDetailsModal appointment={selected} readOnly historyMode onClose={() => setSelected(null)} />}
    </div>
  );
}

function Filter({ label, children }) {
  return <label className="min-w-0 text-sm font-bold text-slate-700"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function HistoryResults({ consultations, onView }) {
  return <>
    <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-maroon-800 text-xs uppercase tracking-wide text-white"><tr><th className="w-[17%] px-4 py-3">Date & Time</th><th className="w-[20%] px-4 py-3">Subject or Course</th><th className="w-[19%] px-4 py-3">Faculty / Provider</th><th className="w-[15%] px-4 py-3">Mode</th><th className="w-[17%] px-4 py-3">Status</th><th className="w-[12%] px-4 py-3">Action</th></tr></thead>
        <tbody className="divide-y divide-slate-200">{consultations.map(consultation => <HistoryTableRow key={consultation._id} consultation={consultation} onView={onView} />)}</tbody>
      </table>
    </div>
    <div className="grid min-w-0 gap-3 md:hidden">{consultations.map(consultation => <HistoryCard key={consultation._id} consultation={consultation} onView={onView} />)}</div>
  </>;
}

function schedule(consultation) {
  const start = validDate(consultation.startAt), end = validDate(consultation.endAt);
  return start ? `${MANILA_DATE.format(start)} · ${MANILA_TIME.format(start)}${end ? ` – ${MANILA_TIME.format(end)}` : ""}` : "Schedule not available";
}
function provider(consultation) { return formatPersonName(consultation.faculty) || "Consultation Provider"; }
function HistoryTableRow({ consultation, onView }) {
  const ModeIcon = consultation.consultationMode === "Face-to-Face" ? MapPin : Monitor;
  return <tr className="align-middle hover:bg-slate-50"><td className="break-words px-4 py-3 text-slate-600">{schedule(consultation)}</td><td className="break-words px-4 py-3 font-semibold text-slate-900">{consultation.subject || "Consultation"}</td><td className="break-words px-4 py-3 text-slate-700">{provider(consultation)}</td><td className="px-4 py-3"><span className="flex min-w-0 items-center gap-2"><ModeIcon size={15} className="shrink-0 text-maroon-700" /><span className="break-words">{consultation.consultationMode || "Not provided"}</span></span></td><td className="px-4 py-3"><StatusBadge appointment status={consultation.status} compact allowWrap /></td><td className="px-4 py-3"><button type="button" onClick={() => onView(consultation)} className="btn-action-sm inline-flex items-center gap-1.5"><Eye size={15} /> Details</button></td></tr>;
}
function HistoryCard({ consultation, onView }) {
  return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="break-words font-bold text-slate-900">{consultation.subject || "Consultation"}</h2><p className="mt-1 break-words text-sm text-slate-600">{provider(consultation)}</p></div><StatusBadge appointment status={consultation.status} compact allowWrap /></div><p className="mt-3 flex items-start gap-2 break-words text-sm text-slate-600"><CalendarDays size={15} className="mt-0.5 shrink-0 text-maroon-700" />{schedule(consultation)}</p><p className="mt-2 text-sm text-slate-600">{consultation.consultationMode || "Mode not provided"}</p><button type="button" onClick={() => onView(consultation)} className="btn-primary mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2"><Eye size={16} /> View Details</button></article>;
}
