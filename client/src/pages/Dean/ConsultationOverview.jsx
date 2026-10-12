import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, Loading } from "../../components/UI";
export default function ConsultationOverview() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    setItems(null);
    api("/dean/appointments")
      .then((d) =>
        setItems(Array.isArray(d?.appointments) ? d.appointments : []),
      )
      .catch(() => setError("Unable to load consultations. Please try again."));
  };
  useEffect(load, []);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <Loading />;
  const statuses = [
    "Pending",
    "Awaiting Faculty Schedule",
    "Approved",
    "Rescheduled",
    "Completed",
    "Cancelled",
    "Rejected",
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-maroon-900">
          Consultation Overview
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          System-wide consultation statistics from MongoDB.
        </p>
      </div>
      {items.length === 0 && <EmptyState title="No consultations found." />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statuses.map((status) => (
          <div key={status} className="rounded-2xl border bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">{status}</p>
            <p className="mt-2 text-3xl font-bold text-maroon-900">
              {items.filter((x) => x.status === status).length}
            </p>
          </div>
        ))}
      </div>
      <div className="min-w-0 rounded-2xl border bg-white p-4 sm:p-6">
        <h2 className="font-bold">Consultation Status Distribution</h2>
        <div className="mt-5 space-y-4">
          {statuses.map((status) => {
            const count = items.filter((x) => x.status === status).length;
            const width = items.length
              ? Math.round((count / items.length) * 100)
              : 0;
            return (
              <div key={status}>
                <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                  <span>{status}</span>
                  <span>
                    {count} ({width}%)
                  </span>
                </div>
                <div className="h-2 rounded bg-slate-100">
                  <div
                    className="h-2 rounded bg-maroon-700"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
