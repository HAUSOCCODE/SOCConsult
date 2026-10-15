import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { EmptyState } from "../../components/UI";
import FacultyScheduleDetailsModal from "../../components/appointments/FacultyScheduleDetailsModal";
import OneTimeScheduleRequests from "../../components/appointments/OneTimeScheduleRequests";
import { useToast } from "../../context/ToastContext";
import { CalendarDays, ChevronRight, Clock3 } from "lucide-react";

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
            status === "Confirmed"
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
                status === "Confirmed"
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
                  (status === "Confirmed" ? 1 : 0),
                rejectedCount:
                  (schedule.rejectedCount || 0) +
                  (status === "Rejected" ? 1 : 0),
                pendingEstimatedMinutes: Math.max(
                  0,
                  (schedule.pendingEstimatedMinutes || 0) - minutes,
                ),
                approvedEstimatedMinutes:
                  (schedule.approvedEstimatedMinutes || 0) +
                  (status === "Confirmed" ? minutes : 0),
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

  const openSchedule = (schedule) => {
    setSelectedId(schedule._id);
    setDetails(null);
    void loadDetails(schedule._id);
  };

  return (
    <div className="w-full min-w-0 space-y-5 sm:space-y-6">
      <div className="w-full min-w-0 max-w-[850px]">
        <h1 className="break-words text-2xl font-bold tracking-tight text-maroon-900 sm:text-[30px] sm:leading-9">
          Appointment Requests
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-[15px]">
          Review student schedule requests or select a published schedule to
          manage its bookings.
        </p>
      </div>
      <OneTimeScheduleRequests />
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
        <div className="appointment-schedule-list mx-auto grid w-full min-w-0 max-w-[1100px] grid-cols-1 gap-3">
          {schedules.map((schedule) => (
            <article
              key={schedule._id}
              onClick={() => openSchedule(schedule)}
              className="appointment-schedule-card grid w-full min-w-0 cursor-pointer rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-colors duration-150 hover:border-maroon-300"
            >
              <header className="appointment-schedule-info grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-2 border-b border-slate-200 px-3 py-3 sm:px-4 sm:py-3.5">
                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-maroon-50 text-maroon-800 sm:h-10 sm:w-10">
                    <CalendarDays size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="break-words text-sm font-bold leading-5 text-maroon-900 sm:text-base">
                      {date(schedule.startAt)}
                    </h2>
                    <p className="mt-0.5 break-words text-[11px] font-medium text-slate-500 sm:text-xs">
                      Published consultation schedule
                    </p>
                  </div>
                </div>
                <p className="col-span-2 inline-flex h-8 w-fit max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700">
                  <Clock3
                    size={15}
                    className="text-maroon-700"
                    aria-hidden="true"
                  />
                  {time(schedule.startAt)} – {time(schedule.endAt)}
                </p>
              </header>
              <div className="contents">
                <div className="appointment-schedule-status min-w-0 border-b border-slate-200 px-3 py-2.5 sm:px-4">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Status
                  </p>
                  <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-1.5">
                    <Count
                      label="Pending"
                      value={schedule.pendingCount || 0}
                      color="text-amber-700"
                    />
                    <Count
                      label="Confirmed"
                      value={schedule.approvedCount || 0}
                      color="text-green-700"
                    />
                    <Count
                      label="Rejected"
                      value={schedule.rejectedCount || 0}
                      color="text-red-700"
                    />
                  </dl>
                </div>
                <div className="appointment-schedule-time min-w-0 border-b border-slate-200 px-3 py-2.5 sm:px-4">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Time
                  </p>
                  <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
                    <Metric
                      label="Capacity"
                      value={`${schedule.capacityMinutes || 0} min`}
                    />
                    <Metric
                      label="Pending Time"
                      value={`${schedule.pendingEstimatedMinutes || 0} min`}
                    />
                    <Metric
                      label="Confirmed Time"
                      value={`${schedule.approvedEstimatedMinutes || 0} min`}
                    />
                    <Metric
                      label="Total Time"
                      value={`${schedule.totalEstimatedMinutes || 0} min`}
                    />
                  </dl>
                </div>
              </div>
              <footer className="appointment-schedule-action flex w-full min-w-0 items-center justify-center bg-white p-2.5 sm:p-3">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openSchedule(schedule);
                  }}
                  aria-label={`View appointment requests for ${date(schedule.startAt)}`}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-maroon-800 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-maroon-900 focus:outline-none focus:ring-2 focus:ring-maroon-400 focus:ring-offset-2 sm:w-40"
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
          onApprove={(item) => update(item, "Confirmed")}
          onReject={(item, note) => update(item, "Rejected", { note })}
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
    <div className="min-w-0 bg-slate-50 px-2.5 py-2 sm:px-3">
      <dt
        className="min-w-0 break-words text-[9px] font-bold uppercase leading-3 tracking-wide text-slate-500"
        title={label}
      >
        {label}
      </dt>
      <dd className="mt-0.5 whitespace-nowrap text-sm font-bold text-slate-900">
        {value}
      </dd>
    </div>
  );
}

function Count({ label, value, color }) {
  return (
    <div
      className={`min-w-0 rounded-lg border px-2 py-2 ${label === "Pending" ? "border-amber-200 bg-amber-50/70" : label === "Confirmed" ? "border-green-200 bg-green-50/70" : "border-red-200 bg-red-50/70"}`}
    >
      <dt className="break-words text-[9px] font-bold uppercase leading-4 tracking-wide text-slate-600 sm:text-xs">
        {label}
      </dt>
      <dd className={`mt-0.5 text-lg font-extrabold ${color}`}>{value}</dd>
    </div>
  );
}
