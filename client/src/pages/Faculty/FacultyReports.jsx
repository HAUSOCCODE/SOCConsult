import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import FacultyReportFilters from "../../components/reports/FacultyReportFilters";
import { safeUiError } from "../../utils/safeUiErrors";

const manilaDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const initialFilters = () => { const endDate = manilaDate(); return { startDate: `${endDate.slice(0, 7)}-01`, endDate, status: "", attendanceOutcome: "", mode: "" }; };
const safeError = error => error?.status === 400 ? "Select a valid date range of at most 366 days and valid report filters."
  : error?.status === 404 ? "No consultation records match the selected report filters."
    : error?.status === 401 ? "Your session has expired. Please sign in again."
      : error?.status === 403 ? "You don't have permission to generate this report."
        : error?.status === 413 ? "The report is too large. Narrow the selected filters."
          : safeUiError(error, "The report could not be generated. Please try again.");

export default function FacultyReports() {
  const [filters, setFilters] = useState(initialFilters), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const inFlight = useRef(false), mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const change = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setError(""); setMessage(""); };
  const clear = () => { setFilters(initialFilters()); setError(""); setMessage(""); };
  const generate = async event => {
    event.preventDefault(); if (inFlight.current) return;
    const start = Date.parse(`${filters.startDate}T00:00:00Z`), end = Date.parse(`${filters.endDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / 86400000 + 1 > 366) { setError("Select a valid date range of at most 366 days."); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const body = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ""));
      const result = await api.download("/faculty/reports/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (result.blob.type !== "application/pdf") throw Object.assign(new Error(), { status: 503 });
      const url = URL.createObjectURL(result.blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = result.filename || `faculty-consultation-report-${filters.startDate}-to-${filters.endDate}.pdf`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (mounted.current) setMessage(`PDF generated successfully for ${result.total} consultation record${result.total === 1 ? "" : "s"}.`);
    } catch (failure) { if (mounted.current) setError(safeError(failure)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="min-w-0 space-y-5 pb-16 md:pb-0"><header className="rounded-2xl border border-maroon-100 bg-white p-5 shadow-sm sm:p-6"><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-700">Faculty Records</p><h1 className="mt-1 text-2xl font-bold text-maroon-900 sm:text-3xl">Faculty Reports</h1><p className="mt-2 text-sm text-slate-600">Generate a PDF report of your consultation history.</p></header><FacultyReportFilters filters={filters} onChange={change} onClear={clear} onSubmit={generate} busy={busy} error={error} />{busy && <p role="status" className="text-sm text-slate-700">Generating PDF...</p>}{message && <p role="status" className="break-words rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}</div>;
}
