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
    <div className="space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-maroon-900">
          School of Computing PDF Reports
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Generate an authorized SOC-wide consultation report. Dates use request
          creation time in Asia/Manila.
        </p>
      </div>
      <form
        onSubmit={generate}
        className="space-y-5 rounded-2xl border bg-white p-6"
        aria-busy={busy}
      >
        <fieldset
          disabled={busy}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <legend className="mb-3 font-semibold">Report filters</legend>
          <label>
            Start date
            <input
              className="field mt-1"
              type="date"
              required
              value={filters.start}
              onChange={(e) => change("start", e.target.value)}
            />
          </label>
          <label>
            End date
            <input
              className="field mt-1"
              type="date"
              required
              value={filters.end}
              onChange={(e) => change("end", e.target.value)}
            />
          </label>
          <div>
            <label>
              Find faculty
              <input
                className="field mt-1"
                type="search"
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="mt-2 block">
              Faculty
              <select
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
            <p className="mt-1 text-xs text-slate-500">
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
          {[
            ["status", "Appointment status", APPOINTMENT_STATUSES],
            ["attendanceOutcome", "Attendance outcome", outcomes],
            ["mode", "Consultation mode", ["Online", "Face-to-Face"]],
          ].map(([key, label, values]) => (
            <label key={key}>
              {label}
              <select
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
        </fieldset>
        <p className="text-sm text-slate-600">
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
          <p role="alert" className="text-red-700">
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
