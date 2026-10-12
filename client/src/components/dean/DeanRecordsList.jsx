import { ChevronRight, ChevronUp, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../UI";
import Pagination from "../Pagination";
import FacultyAppointmentDetailsModal from "../appointments/FacultyAppointmentDetailsModal";
import { formatPersonName } from "../../utils/formatPersonName";

const APPOINTMENTS_PER_PAGE = 6;
const appointmentFilters = [
  "All Appointments",
  "Approved",
  "Pending",
  "Awaiting Faculty Schedule",
  "Rescheduled",
  "Completed",
  "Cancelled",
  "Rejected",
];

const dateLabel = (value) => {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not available";
};

const timeLabel = (value) => {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not available";
};

export default function DeanRecordsList({ title }) {
  const [appointments, setAppointments] = useState(null);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [details, setDetails] = useState(null);
  const [filter, setFilter] = useState("All Appointments");
  const [search, setSearch] = useState("");
  const [expandedAppointmentId, setExpandedAppointmentId] = useState(null);

  const load = () => {
    setError("");
    return api("/dean/appointments")
      .then((data) =>
        setAppointments(
          Array.isArray(data?.appointments) ? data.appointments : [],
        ),
      )
      .catch(() =>
        setError("Unable to load appointments management. Please try again."),
      );
  };

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 20000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const shownAppointments = (appointments || []).filter((appointment) => {
    const matchesFilter =
      filter === "All Appointments" ||
      (filter === "Rescheduled"
        ? /reschedul/i.test(appointment.status || "")
        : appointment.status === filter);
    const matchesSearch =
      !normalizedSearch ||
      [
        appointment.subject,
        appointment.student?.name,
        appointment.faculty?.name,
        appointment.consultationMode,
        appointment.status,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(normalizedSearch),
      );
    return matchesFilter && matchesSearch;
  });
  const totalItems = shownAppointments.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / APPOINTMENTS_PER_PAGE));
  const validPage = Math.min(currentPage, totalPages);
  const pageAppointments = shownAppointments.slice(
    (validPage - 1) * APPOINTMENTS_PER_PAGE,
    validPage * APPOINTMENTS_PER_PAGE,
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setExpandedAppointmentId(null);
  }, [filter, search, validPage]);

  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setAppointments(null);
          void load();
        }}
      />
    );
  if (appointments === null) return <Loading />;

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 pb-20 md:pb-16">
      <div>
        <h1 className="text-2xl font-bold text-maroon-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          Review consultation appointments and their current status.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
        <div className="flex max-w-full min-w-0 gap-2 overflow-x-auto pb-1 min-[900px]:flex-1 min-[900px]:flex-wrap min-[900px]:overflow-visible min-[900px]:pb-0">
          {appointmentFilters.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setFilter(name);
                setCurrentPage(1);
              }}
              aria-pressed={filter === name}
              className={`h-9 shrink-0 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-maroon-200 ${filter === name ? "border-maroon-800 bg-maroon-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-maroon-200 hover:bg-maroon-50"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="relative block w-full min-w-0 min-[900px]:w-60 min-[1200px]:w-64">
          <span className="sr-only">Search appointments</span>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search appointment..."
            className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100"
          />
        </label>
      </div>

      {shownAppointments.length === 0 ? (
        <EmptyState title="No appointments found." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 min-[900px]:hidden">
            {pageAppointments.map((appointment) => {
              const expanded = expandedAppointmentId === appointment._id;
              const detailsId = `dean-appointment-details-${appointment._id}`;
              const subject = appointment.subject || "Consultation";
              return (
                <article
                  key={appointment._id}
                  className="w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="grid min-h-[98px] min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 p-3.5">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900">
                        {subject}
                      </p>
                      <p className="mt-1 break-words text-[11px] leading-4 text-slate-500">
                        {dateLabel(appointment.startAt)} ·{" "}
                        {timeLabel(appointment.startAt)} –{" "}
                        {timeLabel(appointment.endAt)}
                      </p>
                      <p className="mt-1.5 break-words text-xs font-semibold text-slate-700">
                        {formatPersonName(appointment.student?.name) ||
                          "Student unavailable"}
                      </p>
                      <p className="mt-0.5 break-words text-[11px] leading-4 text-slate-500">
                        with{" "}
                        {formatPersonName(appointment.faculty?.name) ||
                          "Faculty unavailable"}{" "}
                        · {appointment.consultationMode || "Online"} ·{" "}
                        {appointment.estimatedDurationMinutes
                          ? `${appointment.estimatedDurationMinutes} min`
                          : "Duration unavailable"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatusBadge status={appointment.status} compact />
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedAppointmentId((current) =>
                            current === appointment._id
                              ? null
                              : appointment._id,
                          )
                        }
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        aria-label={`${expanded ? "Collapse" : "Expand"} appointment details for ${subject}`}
                        className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-maroon-800 transition hover:bg-maroon-50 focus-visible:ring-2 focus-visible:ring-maroon-300"
                      >
                        {expanded ? (
                          <ChevronUp size={17} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={17} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div
                      id={detailsId}
                      className="border-t border-slate-200 bg-slate-50/70 p-3.5"
                    >
                      <dl className="grid min-w-0 grid-cols-2 gap-3 text-xs">
                        <MobileDetail
                          label="Student"
                          value={formatPersonName(appointment.student?.name)}
                        />
                        <MobileDetail
                          label="Faculty"
                          value={formatPersonName(appointment.faculty?.name)}
                        />
                        <MobileDetail
                          label="Mode"
                          value={appointment.consultationMode || "Online"}
                        />
                        <MobileDetail
                          label="Duration"
                          value={
                            appointment.estimatedDurationMinutes
                              ? `${appointment.estimatedDurationMinutes} min`
                              : null
                          }
                        />
                        <MobileDetail
                          label="Status"
                          value={appointment.status}
                        />
                        <MobileDetail
                          label="Scheduled"
                          value={`${dateLabel(appointment.startAt)} · ${timeLabel(appointment.startAt)} – ${timeLabel(appointment.endAt)}`}
                        />
                      </dl>
                      <button
                        type="button"
                        onClick={() => setDetails(appointment)}
                        className="btn-action mt-4 h-9 w-full"
                      >
                        View Details
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="hidden">
            {pageAppointments.map((appointment) => (
              <article
                key={appointment._id}
                className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="truncate font-bold text-slate-900"
                      title={appointment.subject}
                    >
                      {appointment.subject || "Consultation"}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {dateLabel(appointment.startAt)} ·{" "}
                      {timeLabel(appointment.startAt)} –{" "}
                      {timeLabel(appointment.endAt)}
                    </p>
                  </div>
                  <StatusBadge status={appointment.status} compact />
                </div>
                <dl className="mt-4 grid min-w-0 grid-cols-2 gap-3 text-sm">
                  <MobileDetail
                    label="Student"
                    value={formatPersonName(appointment.student?.name)}
                  />
                  <MobileDetail
                    label="Faculty"
                    value={formatPersonName(appointment.faculty?.name)}
                  />
                  <MobileDetail
                    label="Mode"
                    value={appointment.consultationMode || "Online"}
                  />
                  <MobileDetail
                    label="Duration"
                    value={
                      appointment.estimatedDurationMinutes
                        ? `${appointment.estimatedDurationMinutes} min`
                        : null
                    }
                  />
                </dl>
                <button
                  type="button"
                  onClick={() => setDetails(appointment)}
                  className="btn-action mt-4"
                >
                  View Details
                </button>
              </article>
            ))}
          </div>

          <div className="responsive-table-shell hidden overflow-hidden min-[900px]:block">
            <table className="responsive-table text-[10px] min-[1200px]:text-xs 2xl:text-sm">
              <colgroup>
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[17%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="bg-maroon-800 text-[11px] uppercase tracking-wide text-white 2xl:text-xs">
                <tr>
                  {[
                    "Date",
                    "Topic",
                    "Student",
                    "Faculty",
                    "Time",
                    "Mode",
                    "Duration",
                    "Status",
                    "Action",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="whitespace-nowrap px-1 py-3 font-bold min-[1200px]:px-2.5 2xl:px-3"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageAppointments.map((appointment) => (
                  <tr
                    key={appointment._id}
                    className="border-t border-slate-200 bg-white align-middle transition-colors hover:bg-slate-50"
                  >
                    <td className="break-words px-1 py-2 text-[9px] leading-4 min-[1200px]:px-2.5 min-[1200px]:text-[11px] 2xl:px-3 2xl:text-xs">
                      {dateLabel(appointment.startAt)}
                    </td>
                    <td className="min-w-0 px-1 py-2 min-[1200px]:px-2.5 2xl:px-3">
                      <p
                        className="break-words font-semibold leading-4"
                        title={appointment.subject}
                      >
                        {appointment.subject || "—"}
                      </p>
                    </td>
                    <td className="min-w-0 px-1 py-2 min-[1200px]:px-2.5 2xl:px-3">
                      <p
                        className="break-words leading-4"
                        title={formatPersonName(appointment.student?.name)}
                      >
                        {formatPersonName(appointment.student?.name) ||
                          "Unavailable"}
                      </p>
                    </td>
                    <td className="min-w-0 px-1 py-2 min-[1200px]:px-2.5 2xl:px-3">
                      <p
                        className="break-words leading-4"
                        title={formatPersonName(appointment.faculty?.name)}
                      >
                        {formatPersonName(appointment.faculty?.name) ||
                          "Unavailable"}
                      </p>
                    </td>
                    <td className="break-words px-1 py-2 text-[9px] leading-4 min-[1200px]:px-2.5 min-[1200px]:text-[11px] 2xl:px-3 2xl:text-xs">
                      {timeLabel(appointment.startAt)} –{" "}
                      {timeLabel(appointment.endAt)}
                    </td>
                    <td className="break-words px-1 py-2 min-[1200px]:px-2.5 2xl:px-3">
                      {appointment.consultationMode || "Online"}
                    </td>
                    <td className="whitespace-nowrap px-1 py-2 min-[1200px]:px-2.5 2xl:px-3">
                      {appointment.estimatedDurationMinutes
                        ? `${appointment.estimatedDurationMinutes} min`
                        : "—"}
                    </td>
                    <td className="px-1 py-2 min-[1200px]:px-2 2xl:px-3">
                      <div className="flex items-center justify-center">
                        <StatusBadge status={appointment.status} compact />
                      </div>
                    </td>
                    <td className="px-1 py-2 pr-2 text-center min-[1200px]:px-2 2xl:px-3">
                      <button
                        type="button"
                        onClick={() => setDetails(appointment)}
                        className="btn-action-sm h-8 px-1 text-[9px] min-[1200px]:px-2 min-[1200px]:text-xs"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-hidden rounded-b-2xl border border-t-0 border-slate-200">
            <Pagination
              currentPage={validPage}
              totalItems={shownAppointments.length}
              itemsPerPage={APPOINTMENTS_PER_PAGE}
              itemLabel="appointments"
              onPageChange={setCurrentPage}
            />
          </div>
        </>
      )}

      {details && (
        <FacultyAppointmentDetailsModal
          appointment={details}
          onClose={() => setDetails(null)}
          showFacultyInfo
        />
      )}
    </div>
  );
}

function MobileDetail({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd
        className="mt-1 [overflow-wrap:anywhere] font-medium leading-4 text-slate-800"
        title={value || undefined}
      >
        {value || "Not available"}
      </dd>
    </div>
  );
}
