import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../UI";
import Pagination from "../Pagination";
import FacultyAppointmentDetailsModal from "../appointments/FacultyAppointmentDetailsModal";
import { formatPersonName } from "../../utils/formatPersonName";

const APPOINTMENTS_PER_PAGE = 6;

const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not available";
};

const timeLabel = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Not available";
};

export default function AdminRecordsList({ title }) {
  const [appointments, setAppointments] = useState(null);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [details, setDetails] = useState(null);

  const load = () => {
    setError("");
    return api("/admin/appointments")
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

  const totalItems = appointments?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / APPOINTMENTS_PER_PAGE));
  const validPage = Math.min(currentPage, totalPages);
  const pageAppointments = (appointments || []).slice(
    (validPage - 1) * APPOINTMENTS_PER_PAGE,
    validPage * APPOINTMENTS_PER_PAGE,
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

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
    <div className="w-full min-w-0 max-w-full space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-maroon-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          Review consultation appointments and their current status.
        </p>
      </div>

      {appointments.length === 0 ? (
        <EmptyState title="No appointments found." />
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))] gap-4 xl:hidden">
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

          <div className="responsive-table-shell hidden xl:block">
            <table className="responsive-table text-xs 2xl:text-sm">
              <colgroup>
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[15%]" />
                <col className="w-[9%]" />
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
                      className="whitespace-nowrap px-2.5 py-3 font-bold 2xl:px-3"
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
                    <td className="px-2.5 py-2 text-[11px] whitespace-nowrap 2xl:px-3 2xl:text-xs">
                      {dateLabel(appointment.startAt)}
                    </td>
                    <td className="min-w-0 px-2.5 py-2 2xl:px-3">
                      <p
                        className="truncate font-semibold"
                        title={appointment.subject}
                      >
                        {appointment.subject || "—"}
                      </p>
                    </td>
                    <td className="min-w-0 px-2.5 py-2 2xl:px-3">
                      <p
                        className="whitespace-normal break-normal leading-4"
                        title={formatPersonName(appointment.student?.name)}
                      >
                        {formatPersonName(appointment.student?.name) ||
                          "Unavailable"}
                      </p>
                    </td>
                    <td className="min-w-0 px-2.5 py-2 2xl:px-3">
                      <p
                        className="whitespace-normal break-normal leading-4"
                        title={formatPersonName(appointment.faculty?.name)}
                      >
                        {formatPersonName(appointment.faculty?.name) ||
                          "Unavailable"}
                      </p>
                    </td>
                    <td className="px-2.5 py-2 text-[11px] leading-4 whitespace-nowrap 2xl:px-3 2xl:text-xs">
                      {timeLabel(appointment.startAt)} –{" "}
                      {timeLabel(appointment.endAt)}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap 2xl:px-3">
                      {appointment.consultationMode || "Online"}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap 2xl:px-3">
                      {appointment.estimatedDurationMinutes
                        ? `${appointment.estimatedDurationMinutes} min`
                        : "—"}
                    </td>
                    <td className="px-2 py-2 2xl:px-3">
                      <div className="flex items-center justify-center">
                        <StatusBadge status={appointment.status} compact />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center 2xl:px-3">
                      <button
                        type="button"
                        onClick={() => setDetails(appointment)}
                        className="btn-action-sm"
                      >
                        View
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
              totalItems={appointments.length}
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
        className="mt-1 truncate font-medium text-slate-800"
        title={value || undefined}
      >
        {value || "Not available"}
      </dd>
    </div>
  );
}
