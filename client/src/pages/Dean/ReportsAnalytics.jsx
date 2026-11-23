import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { APPOINTMENT_STATUSES } from "../../utils/appointmentStatus";

import ReportNarrativePanel from "../../components/dean/ReportNarrativePanel";

const manilaDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const outcomes = ["Completed", "Student No-show", "Faculty No-show"];

export default function ReportsAnalytics() {
  const [filters, setFilters] = useState(() => {
    const end = manilaDate();
    return {
      start: `${end.slice(0, 7)}-01`,
      end,
      facultyId: "",
      status: "",
      attendanceOutcome: "",
      mode: "",
    };
  });
  const [search, setSearch] = useState("");
  const [faculty, setFaculty] = useState([]);
  const [optionsState, setOptionsState] = useState("loading");
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
  useEffect(() => {
    let active = true;
    setOptionsState("loading");
    const timer = setTimeout(() => {
      api(
        `/dean/consultations/filter-options?${new URLSearchParams({ role: "faculty", search, limit: "50" })}`,
      )
        .then((data) => {
          if (active) {
            setFaculty(data.options);
            setHasMore(data.hasMore);
            setOptionsState("ready");
          }
        })
        .catch(() => {
          if (active) setOptionsState("error");
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);
  const change = (key, value) => {
    ++generation.current;
    setFilters((current) => ({ ...current, [key]: value }));
    setError("");
    setMessage("");
  };
  const generate = async (event) => {
    event.preventDefault();
    if (pending.current) return;
    const start = Date.parse(`${filters.start}T00:00:00Z`),
      end = Date.parse(`${filters.end}T00:00:00Z`);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start ||
      (end - start) / 86400000 + 1 > 366
    ) {
      setError("Select a valid date range of at most 366 days.");
      return;
    }
    pending.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const input = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== ""),
      );
      const result = await api.download("/dean/reports/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (request !== generation.current) return;
      if (result.blob.type !== "application/pdf")
        throw new Error(
          "The report could not be downloaded. Please try again.",
        );
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `SOCConsult_Report_${input.start}_${input.end}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        result.total === 0
          ? "No consultations match these filters. An empty PDF was generated; download started."
          : "PDF generated successfully; download started.",
      );
    } catch (failure) {
      if (request !== generation.current) return;
      setError(
        deanUiError(failure, "pdf"),
      );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-maroon-900">
          Reports & Analytics
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          School of Computing consultation reporting. Choose one set of filters
          for your PDF report and SOC Insights.
        </p>
      </div>
      <form aria-describedby={error ? "report-filter-error" : undefined}
        onSubmit={generate}
        className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"
        aria-busy={busy}
      >
        <fieldset
          disabled={busy}
          aria-describedby={error ? "report-filter-error" : undefined} className="min-w-0 space-y-4"
        >
          <legend className="text-lg font-semibold text-slate-900">Report filters</legend>
          <p className="text-sm text-slate-600">Applies to both features below. Dates use request creation time in Asia/Manila (up to 366 days).</p>
          <div className="grid min-w-0 gap-4 text-sm font-medium text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
          <label>
            Start date
            <input aria-describedby={error ? "report-filter-error" : undefined}
              className="field mt-1"
              type="date"
              required
              value={filters.start}
              onChange={(e) => change("start", e.target.value)}
            />
          </label>
          <label>
            End date
            <input aria-describedby={error ? "report-filter-error" : undefined}
              className="field mt-1"
              type="date"
              required
              value={filters.end}
              onChange={(e) => change("end", e.target.value)}
            />
          </label>
          <div>
            <label className="block">
              Faculty
              <select aria-describedby={error ? "report-filter-error" : undefined}
                className="field mt-1"
                value={filters.facultyId}
                onChange={(e) => change("facultyId", e.target.value)}
              >
                <option value="">All faculty</option>
                {filters.facultyId &&
                  !faculty.some(
                    (item) => item.userId === filters.facultyId,
                  ) && (
                    <option value={filters.facultyId}>Selected faculty</option>
                  )}
                {faculty.map((item) => (
                  <option key={item.userId} value={item.userId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <details className="mt-2 text-xs font-normal text-slate-600">
              <summary className="cursor-pointer rounded py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-maroon-700">Search faculty directory</summary>
            <label>
              Faculty name
              <input aria-describedby={error ? "report-filter-error" : undefined}
                className="field mt-1 text-sm"
                type="search"
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            </details>
            <p className="mt-1 text-xs font-normal text-slate-500" role="status">
              {optionsState === "loading"
                ? "Loading faculty…"
                : optionsState === "error"
                  ? "Faculty options unavailable. Change the search to retry."
                  : hasMore
                    ? "Refine the search to find more faculty."
                    : faculty.length === 0
                      ? "No matching faculty."
                      : "Includes historical faculty and Dean providers."}
            </p>
          </div>
          </div>
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <summary className="cursor-pointer rounded text-sm font-semibold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-maroon-700">
              More filters{[filters.status, filters.attendanceOutcome, filters.mode].filter(Boolean).length > 0 && ` (${
                [filters.status, filters.attendanceOutcome, filters.mode].filter(Boolean).length
              } active)`}
            </summary>
            <div className="mt-4 grid min-w-0 gap-4 text-sm font-medium text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["status", "Appointment status", APPOINTMENT_STATUSES],
            ["attendanceOutcome", "Attendance outcome", outcomes],
            ["mode", "Consultation mode", ["Online", "Face-to-Face"]],
          ].map(([key, label, values]) => (
            <label key={key}>
              {label}
              <select aria-describedby={error ? "report-filter-error" : undefined}
                className="field mt-1"
                value={filters[key]}
                onChange={(e) => change(key, e.target.value)}
              >
                <option value="">All</option>
                {values.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ))}
            </div>
          </details>
        </fieldset>
        <div className="border-t border-slate-200 pt-5">
          <p className="insights-eyebrow">Academic report export</p>
          <h2 className="mt-1 font-display text-2xl text-maroon-900">PDF report</h2>
          <p className="mt-1 text-sm text-slate-600">Download an academic report with an executive overview, classification tables, and consultation records.</p>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Maximum 366 days and 1,000 records. Completed status alone does not
          establish attendance. Historical records are labeled separately.
          Counts are not Faculty rankings or disciplinary findings.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" type="submit" disabled={busy}>
            Generate PDF Report
          </button>
        </div>
        {busy && <p role="status">Generating PDF report…</p>}
        {error && (
          <p id="report-filter-error" role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-slate-700">
            {message}
          </p>
        )}
      </form>
      <ReportNarrativePanel filters={filters} />
    </div>
  );
}
