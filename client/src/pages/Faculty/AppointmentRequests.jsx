import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { EmptyState } from "../../components/UI";
import FacultyScheduleDetailsModal from "../../components/appointments/FacultyScheduleDetailsModal";
import { useToast } from "../../context/ToastContext";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
} from "lucide-react";

const date = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
const time = (value) =>
  new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

export default function AppointmentRequests() {
  const toast = useToast();
  const [schedules, setSchedules] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const refreshFailureShown = useRef(false);

  const loadSchedules = useCallback(
    async ({ background = false } = {}) => {
      try {
        const data = await api("/availability/request-schedules");
        setSchedules(Array.isArray(data?.schedules) ? data.schedules : []);
        refreshFailureShown.current = false;
      } catch {
        setSchedules((current) => current || []);
        if (!refreshFailureShown.current) {
          toast.error("Unable to refresh appointment requests.");
          refreshFailureShown.current = true;
        }
      }
    },
    [toast],
  );

  const loadDetails = useCallback(async (id, { background = false } = {}) => {
    if (!background) setDetailsLoading(true);
    setDetailsError("");
    try {
      const data = await api(`/availability/${id}/details`);
      setDetails(data);
    } catch (error) {
      setDetailsError(
        error.message || "Unable to load requests for this schedule.",
      );
    } finally {
      if (!background) setDetailsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadSchedules({ background: true });
    if (selectedId) await loadDetails(selectedId, { background: true });
  }, [loadDetails, loadSchedules, selectedId]);

  useEffect(() => {
    void loadSchedules();
    const interval = window.setInterval(() => void refresh(), 20000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadSchedules, refresh]);

  useEffect(() => {
    if (
      schedules &&
      selectedId &&
      !schedules.some((schedule) => schedule._id === selectedId)
    ) {
      setSelectedId("");
      setDetails(null);
      setDetailsError("");
    }
  }, [schedules, selectedId]);

  const update = async (appointment, status, extra = {}) => {
    try {
      const data = await api(`/appointments/${appointment._id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status, ...extra }),
      });
      status === "Rejected"
        ? toast.info("Appointment request rejected.")
        : toast.success(
            status === "Approved"
              ? "Appointment approved successfully."
              : data.message,
          );
      const minutes = appointment.estimatedDurationMinutes || 0;
      setDetails((current) =>
        current
          ? {
              ...current,
              pendingRequests: (current.pendingRequests || []).filter(
                (item) => item._id !== appointment._id,
              ),
              approvedStudents:
                status === "Approved"
                  ? [
                      ...(current.approvedStudents || []),
                      { ...appointment, ...data.appointment, status },
                    ]
                  : current.approvedStudents || [],
              rejectedRequests:
                status === "Rejected"
                  ? [
                      ...(current.rejectedRequests || []),
                      { ...appointment, ...data.appointment, status },
                    ]
                  : current.rejectedRequests || [],
            }
          : current,
      );
      setSchedules((current) =>
        current?.map((schedule) =>
          schedule._id === selectedId
            ? {
                ...schedule,
                pendingCount: Math.max(0, (schedule.pendingCount || 0) - 1),
                approvedCount:
                  (schedule.approvedCount || 0) +
                  (status === "Approved" ? 1 : 0),
                rejectedCount:
                  (schedule.rejectedCount || 0) +
                  (status === "Rejected" ? 1 : 0),
                pendingEstimatedMinutes: Math.max(
                  0,
                  (schedule.pendingEstimatedMinutes || 0) - minutes,
                ),
                approvedEstimatedMinutes:
                  (schedule.approvedEstimatedMinutes || 0) +
                  (status === "Approved" ? minutes : 0),
                totalEstimatedMinutes: Math.max(
                  0,
                  (schedule.totalEstimatedMinutes || 0) -
                    (status === "Rejected" ? minutes : 0),
                ),
              }
            : schedule,
        ),
      );
      void refresh();
      return true;
    } catch (error) {
      toast.error(error.message || "Unable to update the appointment.");
      return false;
    }
  };

  const reschedule = async (appointment) => {
    try {
      const data = await api(
        `/availability/${selectedId}/appointments/${appointment._id}/request-reschedule`,
        {
          method: "PUT",
          body: JSON.stringify({}),
        },
      );
      toast.success(data.message);
      await refresh();
      return true;
    } catch (error) {
      toast.error(error.message || "Unable to reschedule appointment.");
      return false;
    }
  };

  const openSchedule = (schedule) => {
    setSelectedId(schedule._id);
    setDetails(null);
    void loadDetails(schedule._id);
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-maroon-900">
          Appointment Requests
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Select a published schedule to manage its student requests.
        </p>
      </div>
      {schedules === null ? (
        <p className="py-10 text-center text-sm font-semibold text-maroon-800">
          Loading schedules...
        </p>
      ) : schedules.length === 0 ? (
        <EmptyState
          title="No active request schedules"
          text="Upcoming schedules created in Manage Availability will appear here."
        />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          {schedules.map((schedule) => (
            <article
              key={schedule._id}
              onClick={() => openSchedule(schedule)}
              className="w-full min-w-0 cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-colors duration-150 hover:border-maroon-300"
            >
              <header className="flex min-w-0 flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-maroon-50 text-maroon-800">
                    <CalendarDays size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="break-words text-[15px] font-bold leading-6 text-maroon-900 sm:text-base">
                      {date(schedule.startAt)}
                    </h2>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      Published consultation schedule
                    </p>
                  </div>
                </div>
              <p className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                <Clock3 size={15} className="text-maroon-700" aria-hidden="true" />
                {time(schedule.startAt)} – {time(schedule.endAt)}
              </p>
              </header>
              <div className="space-y-4 p-4 sm:p-5">
              <dl className="grid min-w-0 grid-cols-3 gap-2.5">
                <Count
                  label="Pending"
                  value={schedule.pendingCount || 0}
                  color="text-amber-700"
                />
                <Count
                  label="Approved"
                  value={schedule.approvedCount || 0}
                  color="text-green-700"
                />
                <Count
                  label="Rejected"
                  value={schedule.rejectedCount || 0}
                  color="text-red-700"
                />
              </dl>
              <dl className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 2xl:grid-cols-4">
                <Metric
                  label="Capacity"
                  value={`${schedule.capacityMinutes || 0} min`}
                />
                <Metric
                  label="Pending Time"
                  value={`${schedule.pendingEstimatedMinutes || 0} min`}
                />
                <Metric
                  label="Approved Time"
                  value={`${schedule.approvedEstimatedMinutes || 0} min`}
                />
                <Metric
                  label="Total Time"
                  value={`${schedule.totalEstimatedMinutes || 0} min`}
                />
              </dl>
              </div>
              <footer className="flex w-full items-center justify-center border-t border-slate-200 bg-slate-50/70 p-3">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openSchedule(schedule);
                  }}
                  aria-label={`View appointment requests for ${date(schedule.startAt)}`}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-maroon-800 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-maroon-900 focus:outline-none focus:ring-2 focus:ring-maroon-400 focus:ring-offset-2 sm:w-auto"
                >
                  View Requests
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      {selectedId && (
        <FacultyScheduleDetailsModal
          details={details}
          loading={detailsLoading}
          error={detailsError}
          onRetry={() => loadDetails(selectedId)}
          onApprove={(item) => update(item, "Approved")}
          onReject={(item, note) => update(item, "Rejected", { note })}
          onReschedule={reschedule}
          onClose={() => {
            setSelectedId("");
            setDetails(null);
            setDetailsError("");
          }}
        />
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0 bg-slate-50 px-3 py-2.5">
      <dt
        className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500"
        title={label}
      >
        {label}
      </dt>
      <dd className="mt-1 text-sm font-bold text-slate-900">{value}</dd>
    </div>
  );
}

function Count({ label, value, color }) {
  return (
    <div
      className={`min-w-0 rounded-xl border px-2.5 py-2.5 sm:px-3 ${label === "Pending" ? "border-amber-200 bg-amber-50/70" : label === "Approved" ? "border-green-200 bg-green-50/70" : "border-red-200 bg-red-50/70"}`}
    >
      <dt
        className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-600"
        title={label}
      >
        {label}
      </dt>
      <dd className={`mt-1 text-xl font-extrabold ${color}`}>{value}</dd>
    </div>
  );
}
