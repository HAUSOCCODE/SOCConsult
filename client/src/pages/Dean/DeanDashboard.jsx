import AttendanceSummary from "../../components/appointments/AttendanceSummary";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import { Loading, ErrorState } from "../../components/UI";

const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not yet scheduled";
export default function DeanDashboard() {
  const [selection, setSelection] = useState(null);
  const [draft, setDraft] = useState({ start: "", end: "" });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = selection ? `?${new URLSearchParams(selection)}` : "";
    api(`/dashboard/dean${query}`, { signal: controller.signal })
      .then((response) => {
        if (!active) return;
        setData(response);
        if (!selection)
          setDraft({ start: response.range.start, end: response.range.end });
      })
      .catch(() => {
        if (active) setError("Unable to load the dashboard. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selection, retry]);
  return (
    <div className="min-w-0 space-y-6 pb-16">
      <header className="rounded-2xl bg-[#72182A] p-6 text-white">
        <h1 className="text-2xl font-bold sm:text-3xl">
          Dean Management Dashboard
        </h1>
        <p className="mt-2 text-sm">
          School of Computing account and consultation summaries.
        </p>
      </header>
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSelection({ ...draft });
        }}
      >
        <label className="text-sm font-semibold">
          Start date
          <input
            aria-label="Start date"
            type="date"
            required
            value={draft.start}
            onChange={(event) =>
              setDraft({ ...draft, start: event.target.value })
            }
            className="mt-1 block rounded-lg border p-2"
          />
        </label>
        <label className="text-sm font-semibold">
          End date
          <input
            aria-label="End date"
            type="date"
            required
            min={draft.start}
            value={draft.end}
            onChange={(event) =>
              setDraft({ ...draft, end: event.target.value })
            }
            className="mt-1 block rounded-lg border p-2"
          />
        </label>
        <button className="btn-primary" disabled={!draft.start || !draft.end}>
          Apply range
        </button>
        <p className="w-full text-xs text-slate-500">
          Asia/Manila · Maximum 366 inclusive days. Account totals are current
          totals.
        </p>
      </form>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : (
        data && (
          <>
            <p role="status" className="sr-only">Dashboard updated for {data.range.start} to {data.range.end}.</p>
            <section aria-label="Current account totals">
              <h2 className="font-bold text-maroon-900">
                Current account totals
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                As of {dateLabel(data.accounts.asOf)} · Asia/Manila
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Card
                  label="Active Student accounts"
                  value={data.accounts.activeStudents}
                />
                <Card
                  label="Active Faculty accounts"
                  value={data.accounts.activeFaculty}
                />
              </div>
            </section>
            <section aria-label="Consultation statistics">
              <h2 className="font-bold text-maroon-900">
                Appointments requested during this period
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {data.range.start} to {data.range.end} · Asia/Manila
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Card
                  label="Total appointments"
                  value={data.consultations.total}
                />
                <Card
                  label="Pending requests"
                  value={data.consultations.byStatus.pending}
                />
                <Card
                  label="Finalized records (all outcomes)"
                  value={data.consultations.byStatus.completed}
                />
              </div>
              {data.consultations.total === 0 && (
                <p className="mt-3 text-sm text-slate-500">
                  No appointments were requested during this period.
                </p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Statistics reflect the consultation statuses currently recorded
                by SOCConsult.
              </p>
            </section>
            <section className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="font-bold text-maroon-900">
                  Latest completed imports
                </h2>
                <Link
                  className="text-sm font-semibold text-maroon-800"
                  to="/dean/import"
                >
                  CSV Import
                </Link>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Latest {data.limits.recentImports} completed batches across all
                dates.
              </p>
              {data.recentImports.length === 0 ? (
                <p role="status" className="py-4 text-sm text-slate-500">
                  No completed imports yet.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">Reference</th>
                        <th className="p-2">Completed (Manila)</th>
                        <th className="p-2">Successful rows</th>
                        <th className="p-2">Failed rows</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentImports.map((batch) => (
                        <tr key={batch.importId} className="border-t">
                          <td className="p-2 break-all">{batch.importId}</td>
                          <td className="p-2">
                            {dateLabel(batch.completedAt)}
                          </td>
                          <td className="p-2">{batch.successfulRows}</td>
                          <td className="p-2">{batch.failedRows}</td>
                          <td className="p-2">{batch.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="rounded-xl border bg-white p-4">
              <h2 className="font-bold text-maroon-900">
                Recent consultation activity
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Latest {data.limits.recentConsultations} updated records
                requested {data.range.start} to {data.range.end} · Asia/Manila.
              </p>
              {data.recentConsultations.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">
                  No consultation activity for this period.
                </p>
              ) : (
                <ul className="mt-3 divide-y">
                  {data.recentConsultations.map((record) => (
                    <li key={record.reference} className="py-3 text-sm">
                      <p className="font-semibold text-slate-800">
                        {record.subject} · {record.status}
                      </p>
                      <p className="mt-1 text-slate-600">
                        {record.studentName || "Student unavailable"} ·{" "}
                        {record.facultyName || "Faculty unavailable"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Scheduled: {dateLabel(record.scheduledAt)} · Updated:{" "}
                        {dateLabel(record.updatedAt)} · Asia/Manila
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                className="mt-3 inline-block text-sm font-semibold text-maroon-800"
                to="/dean/consultations"
              >
                Consultation Monitoring
              </Link>
            </section>
          </>
        )
      )}
      <nav
        aria-label="Management shortcuts"
        className="rounded-xl border bg-white p-4"
      >
        <h2 className="font-bold text-maroon-900">Management shortcuts</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {[
            ["User Accounts", "/dean/users"],
            ["Consultation Monitoring", "/dean/consultations"],
            ["Attendance Review", "/dean/attendance-review"],
            ["Reports", "/dean/reports"],
          ].map(([label, path]) => (
            <Link key={path} className="btn-secondary" to={path}>
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
function Card({ label, value }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-600">{label}</p>
      <p className="mt-2 text-3xl font-bold text-maroon-900">{value}</p>
    </article>
  );
}
