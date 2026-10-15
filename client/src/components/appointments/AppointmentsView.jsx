import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../UI";
import Pagination from "../Pagination";
import AppointmentRequestDetailsModal from "./AppointmentRequestDetailsModal";
import StudentAppointmentDetailsModal from "./StudentAppointmentDetailsModal";
import FacultyAppointmentDetailsModal from "./FacultyAppointmentDetailsModal";
import FacultyRescheduleModal from "./FacultyRescheduleModal";
import {
  getAppointmentDisplayStatus,
  isAwaitingFacultyUpdate,
} from "../../utils/appointmentStatus";
import { useToast } from "../../context/ToastContext";
import ProfileImagePreview from "../profile/ProfileImagePreview";
import { formatPersonName } from "../../utils/formatPersonName";
import ConfirmDialog from "../ConfirmDialog";
import {
  ArrowUpDown,
  CalendarDays,
  ChevronRight,
  ChevronUp,
  Clock3,
  Eye,
  MapPin,
  Monitor,
  Tag,
  UserRound,
} from "lucide-react";
const HISTORY_ITEMS_PER_PAGE = 6;
export default function AppointmentsPage({ filter }) {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [studentViews, setStudentViews] = useState(null);
  const [error, setError] = useState("");
  const [appointmentTab, setAppointmentTab] = useState("Upcoming");
  const [historyTab, setHistoryTab] = useState("All");
  const [historySort, setHistorySort] = useState("newest");
  const [historyPage, setHistoryPage] = useState(1);
  const [appointmentsPage, setAppointmentsPage] = useState(1);
  const [details, setDetails] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [facultyReschedule, setFacultyReschedule] = useState(null);
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [availabilityCapacity, setAvailabilityCapacity] = useState([]);
  const [approvalWarning, setApprovalWarning] = useState(null);
  const [updatingIds, setUpdatingIds] = useState(() => new Set());
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const load = () =>
    api("/appointments/mine")
      .then((d) => {
        setItems(Array.isArray(d?.appointments) ? d.appointments : []);
        setStudentViews(
          d?.studentViews &&
            Array.isArray(d.studentViews.current) &&
            Array.isArray(d.studentViews.history)
            ? d.studentViews
            : null,
        );
        setAvailabilityCapacity(
          Array.isArray(d?.availabilityCapacity) ? d.availabilityCapacity : [],
        );
        setError("");
      })
      .catch(() => setError("Unable to load appointments. Please try again."));
  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);
  const update = async (id, status, extra = {}) => {
    setUpdatingIds((current) => new Set(current).add(id));
    try {
      const d = await api(`/appointments/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status, ...extra }),
      });
      if (status === "Rejected") toast.info(d.message);
      else toast.success(d.message);
      setItems((current) =>
        current?.map((appointment) =>
          appointment._id === id
            ? { ...appointment, status, ...d.appointment }
            : appointment,
        ),
      );
      void load();
      return true;
    } catch (e) {
      toast.error(e.message || "Unable to update the appointment.");
      return false;
    } finally {
      setUpdatingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  const beginReschedule = async (appointment) => {
    try {
      const facultyId =
        user.role === "student"
          ? appointment.faculty?._id || appointment.faculty
          : user.id;
      const data = await api(`/availability/faculty/${facultyId}`);
      const currentAvailabilityId =
        appointment.availability?._id || appointment.availability;
      setRescheduleSlots(
        (Array.isArray(data?.schedules) ? data.schedules : []).filter(
          (slot) =>
            String(slot.availabilityId || slot._id) !==
            String(currentAvailabilityId),
        ),
      );
      setRescheduleTarget(appointment);
    } catch (requestError) {
      toast.error(requestError.message || "Unable to load schedules.");
    }
  };
  const openSupportingDocument = async (appointment) => {
    try {
      const data = await api(`/appointments/${appointment._id}/document`);
      const link = window.document.createElement("a");
      link.href = data.supportingDocument.data;
      link.download = data.supportingDocument.name || "consultation-document";
      link.click();
    } catch (requestError) {
      toast.error(requestError.message || "Unable to open the document.");
    }
  };
  const approve = async (appointment) => {
    const availabilityId =
      appointment.availability?._id || appointment.availability;
    const capacity = availabilityCapacity.find(
      (item) => item.availabilityId === String(availabilityId),
    );
    const excess = capacity
      ? capacity.approvedEstimatedMinutes +
        (appointment.estimatedDurationMinutes || 0) -
        capacity.capacityMinutes
      : 0;
    if (excess > 0) {
      setApprovalWarning({ appointment, excess });
      return;
    }
    await update(appointment._id, "Confirmed");
  };
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <Loading />;
  let shown = items;
  if (user.role === "student" && !filter) shown = studentViews?.current || [];
  if (filter === "requests")
    shown = items.filter((x) => x.status === "Pending");
  if (filter === "history") {
    const historical = ["Completed", "Rejected", "Cancelled", "Expired"];
    const historyItems =
      user.role === "student" ? studentViews?.history || [] : items;
    shown = historyItems.filter((x) =>
      historyTab === "All"
        ? user.role === "student" || historical.includes(x.status)
        : x.status === historyTab,
    );
    shown = [...shown].sort((left, right) => {
      const leftDate = left.startAt || left.endAt || left.createdAt;
      const rightDate = right.startAt || right.endAt || right.createdAt;
      const difference = new Date(leftDate || 0) - new Date(rightDate || 0);
      return historySort === "oldest" ? difference : -difference;
    });
  }
  if (["faculty", "dean"].includes(user.role) && !filter) {
    const now = new Date();
    const today = now.toDateString();
    shown = items.filter((item) => {
      const start = new Date(item.startAt);
      const end = new Date(item.endAt);
      if (appointmentTab === "Today")
        return (
          item.status === "Confirmed" &&
          start.toDateString() === today
        );
      if (appointmentTab === "Upcoming")
        return (
          item.status === "Confirmed" && start >= now
        );
      if (appointmentTab === "Awaiting Update")
        return item.status === "Confirmed" && end < now;
      return item.status === appointmentTab;
    });
  }
  const renderStudentAppointmentActions = (appointment, mobile = false) => (
    <div
      className={`min-w-0 gap-2 ${
        mobile
          ? "flex w-full flex-col items-stretch sm:flex-row sm:flex-wrap"
          : "table-action-group flex-wrap justify-center whitespace-nowrap"
      }`}
    >
      <button
        type="button"
        onClick={() => setDetails(appointment)}
        className={
          mobile
            ? "btn-table-primary h-10 w-full min-w-0 px-3 sm:w-auto sm:flex-1"
            : "btn-action-sm"
        }
      >
        View Details
      </button>
    </div>
  );
  return (
    <div
      className={`w-full min-w-0 max-w-full space-y-6 ${user.role === "student" && filter === "history" ? "student-history space-y-4 pb-16 md:space-y-6 md:pb-0" : ""} ${["faculty", "dean"].includes(user.role) && filter === "history" ? "pb-16 md:pb-20" : ""}`}
    >
      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="Reject Appointment Request"
        message="Are you sure you want to reject this appointment request?"
        supportingText="You may include an optional reason for the Student."
        confirmLabel="Reject"
        loadingLabel="Rejecting..."
        loading={Boolean(rejectTarget && updatingIds.has(rejectTarget._id))}
        inputLabel="Rejection reason (optional)"
        inputValue={rejectNote}
        onInputChange={setRejectNote}
        inputPlaceholder="Enter an optional reason"
        onCancel={() => {
          if (rejectTarget && updatingIds.has(rejectTarget._id)) return;
          setRejectTarget(null);
          setRejectNote("");
        }}
        onConfirm={async () => {
          if (!rejectTarget || updatingIds.has(rejectTarget._id)) return;
          const rejected = await update(rejectTarget._id, "Rejected", {
            note: rejectNote.trim(),
          });
          if (rejected) {
            setRejectTarget(null);
            setRejectNote("");
          }
        }}
      />
      {user.role === "student" && !filter ? (
        <section className="relative min-w-0 overflow-hidden rounded-2xl border border-maroon-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="pointer-events-none absolute -right-8 -top-10 hidden h-36 w-36 rounded-full border border-gold-300/40 md:block" />
          <div className="relative flex min-w-0 items-center justify-between gap-5">
            <div className="min-w-0">
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-700">
                Consultation Management
              </p>
              <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-maroon-900 sm:text-[28px]">
                My Appointments
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-[15px]">
                View and manage your current consultation appointments.
              </p>
            </div>
            <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl border border-gold-300 bg-maroon-50 text-maroon-800 md:grid">
              <CalendarDays size={23} aria-hidden="true" />
            </span>
          </div>
        </section>
      ) : user.role === "student" && filter === "history" ? (
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-maroon-900 sm:text-[30px]">
            Consultation History
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Review your completed, rejected, and cancelled consultation records.
          </p>
        </div>
      ) : ["faculty", "dean"].includes(user.role) && !filter ? (
        <section className="relative min-w-0 overflow-hidden rounded-2xl border border-maroon-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="pointer-events-none absolute -right-8 -top-10 hidden h-36 w-36 rounded-full border border-gold-300/40 md:block" />
          <div className="relative flex min-w-0 items-center justify-between gap-5">
            <div className="min-w-0">
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-700">
                Faculty Workspace
              </p>
              <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-maroon-900 sm:text-[28px]">
                My Appointments
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-[15px]">
                Manage and track your consultation appointments.
              </p>
            </div>
            <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl border border-gold-300 bg-maroon-50 text-maroon-800 md:grid">
              <CalendarDays size={23} aria-hidden="true" />
            </span>
          </div>
        </section>
      ) : (
        <div>
          <h1
            className={`font-bold tracking-tight text-maroon-900 ${["faculty", "dean"].includes(user.role) && filter === "history" ? "text-2xl sm:text-[30px]" : "text-2xl"}`}
          >
            {filter === "requests"
              ? "Appointment Requests"
              : filter === "history"
                ? "Consultation History"
                : "My Appointments"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {filter === "history"
              ? "Review your completed, rejected, and cancelled consultation records."
              : "Live appointment data from SOCConsult."}
          </p>
        </div>
      )}
      {user.role === "student" && filter === "history" && (
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div
            className="grid min-w-0 grid-cols-2 gap-2 min-[480px]:flex min-[480px]:flex-wrap"
            role="group"
            aria-label="Filter consultation history"
          >
            {["All", "Completed", "Expired", "Cancelled"].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setHistoryTab(name);
                  setHistoryPage(1);
                }}
                aria-pressed={historyTab === name}
                className={`h-10 min-w-0 rounded-lg border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 min-[480px]:min-w-[108px] ${
                  historyTab === name
                    ? "border-maroon-800 bg-maroon-800 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-700 hover:border-maroon-200 hover:bg-maroon-50"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
            <span>Sort by:</span>
            <select
              value={historySort}
              onChange={(event) => {
                setHistorySort(event.target.value);
                setHistoryPage(1);
              }}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </label>
        </div>
      )}
      {["faculty", "dean"].includes(user.role) && filter === "history" && (
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div
            className="grid min-w-0 grid-cols-2 gap-2 min-[480px]:flex min-[480px]:flex-wrap"
            role="group"
            aria-label="Filter consultation history"
          >
            {["All", "Completed", "Expired", "Cancelled"].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setHistoryTab(name);
                  setHistoryPage(1);
                }}
                aria-pressed={historyTab === name}
                className={`h-10 min-w-0 rounded-lg border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 min-[480px]:min-w-[108px] ${
                  historyTab === name
                    ? "border-maroon-800 bg-maroon-800 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-700 hover:border-maroon-200 hover:bg-maroon-50"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
            <span>Sort by:</span>
            <select
              value={historySort}
              onChange={(event) => {
                setHistorySort(event.target.value);
                setHistoryPage(1);
              }}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </label>
        </div>
      )}
      {["faculty", "dean"].includes(user.role) &&
        filter === "requests" &&
        availabilityCapacity.length > 0 && (
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))] gap-4">
            {availabilityCapacity.map((capacity) => (
              <article
                key={capacity.availabilityId}
                className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <p className="break-words font-bold text-maroon-900">
                  {new Date(capacity.startAt).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {new Date(capacity.startAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  –{" "}
                  {new Date(capacity.endAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
                <dl className="mt-4 grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <Capacity
                    label="Pending Requests"
                    value={capacity.pendingCount}
                  />
                  <Capacity
                    label="Availability Capacity"
                    value={`${capacity.capacityMinutes} min`}
                  />
                  <Capacity
                    label="Pending Estimated"
                    value={`${capacity.pendingEstimatedMinutes} min`}
                  />
                  <Capacity
                    label="Confirmed Estimated"
                    value={`${capacity.approvedEstimatedMinutes} min`}
                  />
                  <Capacity
                    label="Total Estimated Time"
                    value={`${capacity.totalEstimatedMinutes} min`}
                    wide
                  />
                </dl>
                {capacity.totalEstimatedMinutes > capacity.capacityMinutes && (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Consultation requests exceed this availability by{" "}
                    {capacity.totalEstimatedMinutes - capacity.capacityMinutes}{" "}
                    minutes.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      {details && filter === "requests" && (
        <AppointmentRequestDetailsModal
          appointment={details}
          onClose={() => setDetails(null)}
        />
      )}
      {details && user.role === "student" && (
        <StudentAppointmentDetailsModal
          appointment={details}
          onClose={() => setDetails(null)}
        />
      )}
      {details && ["faculty", "dean"].includes(user.role) && filter !== "requests" && (
        <FacultyAppointmentDetailsModal
          appointment={details}
          onClose={() => setDetails(null)}
          onComplete={async () => {
            if (await update(details._id, "Completed")) setDetails(null);
          }}
        />
      )}
      {facultyReschedule && (
        <FacultyRescheduleModal
          appointment={facultyReschedule.appointment}
          opener={facultyReschedule.opener}
          onClose={() => setFacultyReschedule(null)}
          onSuccess={(data) => {
            toast.success(data.message);
            setItems((current) =>
              current?.map((appointment) =>
                appointment._id === data.appointment?._id
                  ? { ...appointment, ...data.appointment }
                  : appointment,
              ),
            );
            setFacultyReschedule(null);
            window.dispatchEvent(new Event("notifications:updated"));
            void load();
          }}
        />
      )}
      {approvalWarning &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-3 sm:p-4">
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="capacity-warning-title"
              className="w-full min-w-0 max-w-lg rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
            >
              <h2
                id="capacity-warning-title"
                className="text-xl font-bold text-maroon-900"
              >
                Availability Capacity Warning
              </h2>
              <p className="mt-3 text-sm text-slate-600">
                Approving this request will exceed your published consultation
                availability by {approvalWarning.excess} minutes.
              </p>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setApprovalWarning(null)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const target = approvalWarning.appointment;
                    setApprovalWarning(null);
                    await update(target._id, "Confirmed");
                  }}
                  className="btn-primary"
                >
                  Approve Anyway
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {rescheduleTarget && ["faculty", "dean"].includes(user.role) && (
        <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-950/60 p-3 sm:p-4">
          <div className="w-full min-w-0 max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-6">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-maroon-900">
                  Reschedule Consultation
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Select another valid schedule.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="font-bold text-slate-500"
              >
                Close
              </button>
            </div>
            {rescheduleSlots.length === 0 ? (
              <EmptyState title="No alternative schedules available." />
            ) : (
              <div className="mt-5 max-h-96 space-y-3 overflow-y-auto">
                {rescheduleSlots.map((slot) => (
                  <button
                    key={slot._id}
                    type="button"
                    onClick={async () => {
                      await update(rescheduleTarget._id, "Reschedule Proposed", {
                        availabilityId: slot.availabilityId,
                        startAt: slot.startAt,
                      });
                      setRescheduleTarget(null);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm hover:border-maroon-400"
                  >
                    <span className="block font-bold">
                      {new Date(slot.startAt).toLocaleString()}
                    </span>
                    <span className="mt-1 block text-slate-600">
                      {slot.mode} · {slot.location}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {user.role === "student" && !filter ? (
        <StudentCurrentAppointments
          appointments={shown}
          currentPage={appointmentsPage}
          onPageChange={setAppointmentsPage}
          renderActions={renderStudentAppointmentActions}
        />
      ) : ["faculty", "dean"].includes(user.role) && !filter ? (
        <FacultyCurrentAppointments
          appointments={shown}
          activeFilter={appointmentTab}
          onFilterChange={setAppointmentTab}
          onView={setDetails}
          updatingIds={updatingIds}
          onApprove={approve}
          onReject={(appointment) => {
            setRejectTarget(appointment);
            setRejectNote("");
          }}
          onBeginReschedule={beginReschedule}
          onFacultyReschedule={(appointment, opener) =>
            setFacultyReschedule({ appointment, opener })
          }
          onComplete={(appointment) => update(appointment._id, "Completed")}
          onViewDocument={openSupportingDocument}
        />
      ) : filter === "history" ? (
        <ConsultationHistoryTable
          appointments={shown}
          currentPage={historyPage}
          onPageChange={setHistoryPage}
          onView={setDetails}
          role={user.role}
          mobileResetKey={`${historyTab}-${historySort}`}
          emptyTitle={
            user.role === "student"
              ? historyTab === "All"
                ? "No consultation history yet."
                : "No records match the selected filter."
              : historyTab === "All"
                ? "No consultation records found."
                : `No ${historyTab.toLowerCase()} consultation records found.`
          }
          showTime
          renderActions={
            user.role === "student"
              ? (appointment, mobile = false) => (
                  <div
                    className={
                      mobile
                        ? "mt-3 flex min-w-0 flex-col gap-2 border-t border-slate-200 pt-3 min-[360px]:flex-row"
                        : "student-history-table-actions flex min-w-0 flex-nowrap items-center !gap-2 whitespace-nowrap"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setDetails(appointment)}
                      className={
                        mobile
                          ? "flex h-10 w-full min-w-0 flex-1 items-center justify-between rounded-lg border border-maroon-200 bg-white px-3 text-sm font-semibold text-maroon-800 hover:bg-maroon-50"
                          : "btn-action-sm"
                      }
                    >
                      <span>View Details</span>
                      {mobile && <ChevronRight size={17} aria-hidden="true" />}
                    </button>
                  </div>
                )
              : undefined
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState title="No current appointments" />
      ) : (
        <div className="grid min-w-0 gap-4">
          {shown.map((x) => (
            <article
              key={x._id}
              className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border bg-white p-4 sm:p-5"
            >
              <div
                className={`flex min-w-0 flex-col gap-4 ${
                  ["faculty", "dean"].includes(user.role) && filter !== "requests"
                    ? "xl:flex-row xl:items-center xl:justify-between xl:gap-5"
                    : "lg:flex-row lg:items-start lg:justify-between lg:gap-6"
                }`}
              >
                <div className="min-w-0 flex-1">
                  {filter === "requests" && (
                    <>
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                        <h2 className="min-w-0 break-words font-bold text-slate-900">
                          {formatPersonName(x.student?.name) ||
                            "Student name not provided"}
                        </h2>
                        <StatusBadge status={x.status} />
                      </div>
                      <dl className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Date
                          </dt>
                          <dd className="mt-1 break-words text-sm font-semibold text-slate-800">
                            {new Date(x.startAt).toLocaleDateString(undefined, {
                              weekday: "short",
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Time
                          </dt>
                          <dd className="mt-1 break-words text-sm font-semibold text-slate-800">
                            {new Date(x.startAt).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}{" "}
                            –{" "}
                            {new Date(x.endAt).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                  {filter !== "requests" && !["faculty", "dean"].includes(user.role) && (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="min-w-0 break-words font-bold">
                          {x.subject}
                        </h2>
                        <StatusBadge
                          status={
                            user.role === "student"
                              ? getAppointmentDisplayStatus(x)
                              : x.status
                          }
                        />
                      </div>
                      <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-slate-600">
                        <ProfileImagePreview
                          user={user.role === "student" ? x.faculty : x.student}
                          className="h-9 w-9 rounded-full bg-maroon-800 text-xs font-bold text-white"
                          buttonClassName="rounded-full"
                        />
                        <p className="min-w-0 break-words">
                          {user.role === "student"
                            ? `Faculty: ${formatPersonName(x.faculty?.name)}`
                            : `Student: ${formatPersonName(x.student?.name)}`}
                        </p>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {new Date(x.startAt).toLocaleDateString(undefined, {
                          weekday: "short",
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Estimated consultation time:{" "}
                        {x.estimatedDurationMinutes || "Not provided"}
                        {x.estimatedDurationMinutes ? " minutes" : ""}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {new Date(x.startAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        –{" "}
                        {new Date(x.endAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {x.consultationMode || "Online"} ·{" "}
                        {x.location || "Location to be confirmed"}
                      </p>
                      {["faculty", "dean"].includes(user.role) && x.student?.program && (
                        <p className="mt-1 break-words text-sm text-slate-500">
                          Program: {x.student.program}
                        </p>
                      )}
                      <div className="mt-3 min-w-0 text-sm">
                        <p className="font-semibold text-slate-700">Reason:</p>
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed text-slate-700">
                          {x.reason}
                        </p>
                      </div>
                      {x.notes && (
                        <div className="mt-3 min-w-0 text-sm">
                          <p className="font-semibold text-slate-700">Notes:</p>
                          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed text-slate-600">
                            {x.notes}
                          </p>
                        </div>
                      )}
                      {user.role === "student" &&
                        isAwaitingFacultyUpdate(x) && (
                          <p className="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                            The scheduled consultation time has passed. Waiting
                            for your faculty member to update the consultation
                            status.
                          </p>
                        )}
                    </>
                  )}
                </div>
                <div
                  className={`flex w-full min-w-0 flex-wrap gap-2 ${
                    filter === "requests"
                      ? "lg:w-52 lg:shrink-0 lg:flex-col"
                      : ["faculty", "dean"].includes(user.role)
                        ? "border-t border-slate-200 pt-3 xl:w-[22rem] xl:shrink-0 xl:justify-end xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0"
                        : "lg:w-auto lg:shrink-0"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setDetails(x)}
                    className="btn-action"
                  >
                    View Details
                  </button>
                  {["faculty", "dean"].includes(user.role) && x.status === "Pending" && (
                    <>
                      <button
                        disabled={updatingIds.has(x._id)}
                        onClick={() => approve(x)}
                        className="rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        disabled={updatingIds.has(x._id)}
                        onClick={() => {
                          setRejectTarget(x);
                          setRejectNote("");
                        }}
                        className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => beginReschedule(x)}
                        className="btn-action"
                      >
                        Reschedule
                      </button>
                    </>
                  )}
                  {["faculty", "dean"].includes(user.role) &&
                    x.status === "Confirmed" && (
                      <>
                        <button
                          disabled={updatingIds.has(x._id)}
                          onClick={() => update(x._id, "Completed")}
                          className="rounded-lg bg-maroon-800 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-maroon-900 disabled:opacity-60"
                        >
                          {updatingIds.has(x._id)
                            ? "Completing..."
                            : "Complete"}
                        </button>
                        {new Date(x.endAt) < new Date() && (
                          <button
                            type="button"
                            onClick={() => beginReschedule(x)}
                            className="btn-action"
                          >
                            Reschedule
                          </button>
                        )}
                      </>
                    )}
                  {x.supportingDocument?.name &&
                    filter !== "requests" &&
                    filter !== "history" &&
                    user.role !== "student" && (
                      <button
                        type="button"
                        onClick={() => openSupportingDocument(x)}
                        className="btn-action"
                      >
                        View Document
                      </button>
                    )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const FACULTY_APPOINTMENT_FILTERS = [
  "Today",
  "Upcoming",
  "Awaiting Update",
  "Completed",
  "Cancelled",
];
const FACULTY_APPOINTMENTS_PAGE_SIZE = 3;

function FacultyCurrentAppointments({
  appointments,
  activeFilter,
  onFilterChange,
  onView,
  updatingIds,
  onApprove,
  onReject,
  onBeginReschedule,
  onFacultyReschedule,
  onComplete,
  onViewDocument,
}) {
  const [sortOrder, setSortOrder] = useState("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const sorted = [...appointments].sort((left, right) => {
    const difference = new Date(left.startAt) - new Date(right.startAt);
    return sortOrder === "oldest" ? difference : -difference;
  });
  const totalPages = Math.max(
    1,
    Math.ceil(sorted.length / FACULTY_APPOINTMENTS_PAGE_SIZE),
  );
  const safePage = Math.min(currentPage, totalPages);
  const pageAppointments = sorted.slice(
    (safePage - 1) * FACULTY_APPOINTMENTS_PAGE_SIZE,
    safePage * FACULTY_APPOINTMENTS_PAGE_SIZE,
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const changeFilter = (filter) => {
    onFilterChange(filter);
    setCurrentPage(1);
  };

  return (
    <section className="min-w-0 space-y-4 pb-16 md:pb-0">
      <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div
          className="hidden min-w-0 flex-wrap gap-2 sm:flex"
          role="group"
          aria-label="Filter faculty appointments"
        >
          {FACULTY_APPOINTMENT_FILTERS.map((filter) => (
            <FacultyFilterButton
              key={filter}
              filter={filter}
              active={activeFilter === filter}
              onClick={() => changeFilter(filter)}
            />
          ))}
        </div>

        <div
          className="hidden min-w-0 grid-cols-[.75fr_1fr_1.45fr_1fr_.7fr] gap-1 min-[480px]:grid sm:hidden"
          role="group"
          aria-label="Filter faculty appointments"
        >
          {FACULTY_APPOINTMENT_FILTERS.slice(0, 4).map((filter) => (
            <FacultyFilterButton
              key={filter}
              filter={filter}
              active={activeFilter === filter}
              onClick={() => changeFilter(filter)}
              mobile
            />
          ))}
          <details className="group relative min-w-0">
            <summary
              className={`flex min-h-9 cursor-pointer list-none items-center justify-center rounded-lg border px-1 py-2 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 min-[560px]:text-xs [&::-webkit-details-marker]:hidden ${
                activeFilter === "Cancelled"
                  ? "border-maroon-800 bg-maroon-800 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              More
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <button
                type="button"
                onClick={() => changeFilter("Cancelled")}
                aria-pressed={activeFilter === "Cancelled"}
                className={`w-full rounded-md px-3 py-2 text-left text-xs font-semibold ${
                  activeFilter === "Cancelled"
                    ? "bg-maroon-800 text-white"
                    : "text-slate-700 hover:bg-maroon-50"
                }`}
              >
                Cancelled
              </button>
            </div>
          </details>
        </div>

        <div
          className="grid min-w-0 grid-cols-4 gap-1 min-[480px]:hidden"
          role="group"
          aria-label="Filter faculty appointments"
        >
          {FACULTY_APPOINTMENT_FILTERS.slice(0, 3).map((filter) => (
            <FacultyFilterButton
              key={filter}
              filter={filter}
              active={activeFilter === filter}
              onClick={() => changeFilter(filter)}
              mobile
            />
          ))}
          <details className="group relative min-w-0">
            <summary
              className={`flex min-h-9 cursor-pointer list-none items-center justify-center rounded-lg border px-1 py-2 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 min-[380px]:text-xs [&::-webkit-details-marker]:hidden ${
                ["Completed", "Cancelled"].includes(activeFilter)
                  ? "border-maroon-800 bg-maroon-800 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              More
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {FACULTY_APPOINTMENT_FILTERS.slice(3).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => changeFilter(filter)}
                  className={`w-full rounded-md px-3 py-2 text-left text-xs font-semibold ${
                    activeFilter === filter
                      ? "bg-maroon-800 text-white"
                      : "text-slate-700 hover:bg-maroon-50"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </details>
        </div>

        <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-600">
          <ArrowUpDown size={15} aria-hidden="true" />
          <span>Sort by</span>
          <select
            value={sortOrder}
            onChange={(event) => {
              setSortOrder(event.target.value);
              setCurrentPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-800 outline-none focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title={`No ${activeFilter.toLowerCase()} appointments found.`}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-200">
            {pageAppointments.map((appointment) => (
              <FacultyAppointmentRow
                key={appointment._id}
                appointment={appointment}
                renderActions={(mobile) => (
                  <FacultyAppointmentActions
                    appointment={appointment}
                    mobile={mobile}
                    onView={onView}
                    updatingIds={updatingIds}
                    onApprove={onApprove}
                    onReject={onReject}
                    onBeginReschedule={onBeginReschedule}
                    onFacultyReschedule={onFacultyReschedule}
                    onComplete={onComplete}
                    onViewDocument={onViewDocument}
                  />
                )}
              />
            ))}
          </div>
          <div className="sm:[&>div]:pr-16 md:[&>div]:pr-20">
            <Pagination
              currentPage={safePage}
              totalItems={sorted.length}
              itemsPerPage={FACULTY_APPOINTMENTS_PAGE_SIZE}
              itemLabel="appointments"
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function FacultyFilterButton({ filter, active, onClick, mobile = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-lg font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 ${
        mobile
          ? "min-w-0 px-1 py-2 text-[10px] min-[380px]:text-xs"
          : "px-3 py-2 text-xs sm:text-sm"
      } ${
        active
          ? "border border-maroon-800 bg-maroon-800 text-white shadow-sm"
          : "border border-slate-200 bg-white text-slate-700 hover:border-maroon-200 hover:bg-maroon-50"
      }`}
    >
      {filter}
    </button>
  );
}

function FacultyAppointmentRow({ appointment, renderActions }) {
  const start = new Date(appointment.startAt);
  const isFaceToFace = appointment.consultationMode === "Face-to-Face";
  const ModeIcon = isFaceToFace ? MapPin : Monitor;
  const destination = isFaceToFace
    ? appointment.location || "Location to be confirmed"
    : appointment.meetingPlatform || "Meeting platform to be confirmed";

  return (
    <article className="grid min-w-0 grid-cols-[3.75rem_minmax(0,1fr)] bg-white md:grid-cols-[4.25rem_minmax(0,1fr)_minmax(12rem,.75fr)_auto] min-[1200px]:min-h-[88px] min-[1200px]:grid-cols-[7rem_minmax(13rem,1.2fr)_minmax(12rem,.8fr)_minmax(7rem,.4fr)_minmax(15rem,.9fr)]">
      <div className="flex items-start justify-center p-3 md:items-center md:p-4 min-[1200px]:justify-start min-[1200px]:py-2.5 min-[1200px]:pl-6 min-[1200px]:pr-3">
        <div className="grid h-16 w-14 shrink-0 content-center rounded-lg border border-maroon-100 bg-maroon-50 text-center min-[1200px]:h-[4.25rem] min-[1200px]:w-[3.75rem]">
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-maroon-700">
            {start.toLocaleDateString(undefined, { month: "short" })}
          </span>
          <span className="text-2xl font-extrabold leading-6 text-maroon-900">
            {start.toLocaleDateString(undefined, { day: "numeric" })}
          </span>
          <span className="text-[9px] font-semibold text-slate-500">
            {start.toLocaleDateString(undefined, { year: "numeric" })}
          </span>
        </div>
      </div>

      <div className="min-w-0 p-3 pl-0 md:flex md:items-center md:p-4 md:pl-0 min-[1200px]:py-3 min-[1200px]:pl-1 min-[1200px]:pr-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2 md:block">
            <div className="flex min-w-0 items-start gap-2.5 min-[1200px]:items-center min-[1200px]:gap-4">
              <ProfileImagePreview
                user={appointment.student}
                className="h-8 w-8 shrink-0 rounded-full bg-maroon-800 text-xs font-bold text-white min-[1200px]:h-11 min-[1200px]:w-11 min-[1200px]:text-sm"
                buttonClassName="shrink-0 rounded-full"
              />
              <div className="min-w-0">
                <h2 className="break-words text-sm font-bold leading-5 text-slate-900 sm:text-base">
                  {appointment.subject || "Consultation"}
                </h2>
                <p className="mt-1 break-words text-xs text-slate-600 sm:text-sm">
                  <span className="font-semibold">Student:</span>{" "}
                  {formatPersonName(appointment.student?.name) ||
                    "Not provided"}
                </p>
              </div>
            </div>
            <span className="shrink-0 md:hidden">
              <StatusBadge status={appointment.status} compact />
            </span>
          </div>
        </div>
      </div>

      <div className="col-span-2 min-w-0 border-t border-slate-200 bg-slate-50/60 px-3 py-3 text-sm text-slate-600 md:col-span-1 md:flex md:flex-col md:justify-center md:border-l md:border-t-0 md:bg-white md:px-4 min-[1200px]:px-5">
        <p className="flex min-w-0 items-start gap-2">
          <Clock3
            size={15}
            className="mt-0.5 shrink-0 text-maroon-700"
            aria-hidden="true"
          />
          <span className="break-words font-semibold">
            {formatClock(appointment.startAt)} {" – "}
            {formatClock(appointment.endAt)}
          </span>
        </p>
        <p className="mt-2 flex min-w-0 items-start gap-2">
          <ModeIcon
            size={15}
            className="mt-0.5 shrink-0 text-maroon-700"
            aria-hidden="true"
          />
          <span className="break-words">
            {appointment.consultationMode || "Mode not provided"} ·{" "}
            {destination}
          </span>
        </p>
      </div>

      <div className="hidden min-w-0 items-center justify-center border-l border-slate-200 px-3 md:flex">
        <StatusBadge status={appointment.status} compact />
      </div>

      <div className="col-span-2 border-t border-slate-200 p-3 md:col-span-4 md:px-4 min-[1200px]:col-span-1 min-[1200px]:flex min-[1200px]:items-center min-[1200px]:justify-center min-[1200px]:border-l min-[1200px]:border-t-0 min-[1200px]:py-3 min-[1200px]:pl-4 min-[1200px]:pr-6">
        <div className="min-[1200px]:hidden">{renderActions(true)}</div>
        <div className="hidden min-[1200px]:block">{renderActions(false)}</div>
      </div>
    </article>
  );
}

function FacultyAppointmentActions({
  appointment,
  mobile,
  onView,
  updatingIds,
  onApprove,
  onReject,
  onBeginReschedule,
  onFacultyReschedule,
  onComplete,
  onViewDocument,
}) {
  const buttonLayout = mobile
    ? "flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap"
    : "flex min-w-0 flex-wrap items-center justify-center gap-2";
  const mobileButton = mobile ? "h-10 w-full sm:w-auto sm:flex-1" : "h-8";
  return (
    <div className={buttonLayout}>
      <button
        type="button"
        onClick={() => onView(appointment)}
        className={`btn-action ${mobileButton}`}
      >
        View Details
      </button>
      {appointment.status === "Pending" && (
        <>
          <button
            disabled={updatingIds.has(appointment._id)}
            onClick={() => onApprove(appointment)}
            className={`rounded-lg bg-green-700 px-4 text-sm font-bold text-white disabled:opacity-60 ${mobileButton}`}
          >
            Approve
          </button>
          <button
            disabled={updatingIds.has(appointment._id)}
            onClick={() => onReject(appointment)}
            className={`rounded-lg bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-60 ${mobileButton}`}
          >
            Reject
          </button>
          <button
            onClick={() => onBeginReschedule(appointment)}
            className={`btn-action ${mobileButton}`}
          >
            Reschedule
          </button>
        </>
      )}
      {appointment.status === "Confirmed" && (
          <>
            {new Date(appointment.startAt) > new Date() && (
              <button
                type="button"
                onClick={(event) =>
                  onFacultyReschedule(appointment, event.currentTarget)
                }
                className={`rounded-lg border border-gold-500 bg-gold-50 px-4 text-sm font-bold text-maroon-900 transition-colors hover:bg-gold-100 ${mobileButton}`}
              >
                Reschedule
              </button>
            )}
            <button
              disabled={updatingIds.has(appointment._id)}
              onClick={() => onComplete(appointment)}
              className={`rounded-lg bg-maroon-800 px-4 text-sm font-bold text-white transition-colors hover:bg-maroon-900 disabled:opacity-60 ${mobileButton}`}
            >
              {updatingIds.has(appointment._id) ? "Completing..." : "Complete"}
            </button>
            {new Date(appointment.endAt) < new Date() && (
              <button
                type="button"
                onClick={() => onBeginReschedule(appointment)}
                className={`btn-action ${mobileButton}`}
              >
                Reschedule
              </button>
            )}
          </>
        )}
      {appointment.supportingDocument?.name && (
        <button
          type="button"
          onClick={() => onViewDocument(appointment)}
          className={`btn-action ${mobileButton}`}
        >
          View Document
        </button>
      )}
    </div>
  );
}

function Capacity({ label, value, wide = false }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words font-bold text-slate-800">{value}</dd>
    </div>
  );
}

const formatClock = (value) =>
  value
    ? new Date(value).toLocaleTimeString("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not scheduled";
const appointmentDatePart = (appointment, options) =>
  appointment.startAt
    ? new Date(appointment.startAt).toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        ...options,
      })
    : "TBD";

const CURRENT_APPOINTMENT_FILTERS = [
  "All",
  "Reschedule Proposed",
  "Upcoming",
  "Pending",
  "Confirmed",
];
const CURRENT_APPOINTMENTS_PAGE_SIZE = 3;
const PRIMARY_MOBILE_APPOINTMENT_FILTERS = [
  "All",
  "Upcoming",
  "Pending",
  "Confirmed",
];
const SECONDARY_MOBILE_APPOINTMENT_FILTERS = [
  "Reschedule Proposed",
];

function StudentCurrentAppointments({
  appointments,
  currentPage,
  onPageChange,
  renderActions,
}) {
  const [activeFilter, setActiveFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState("newest");
  const now = new Date();
  const filtered = appointments.filter((appointment) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Upcoming")
      return (
        Boolean(appointment.startAt) && new Date(appointment.startAt) > now
      );
    return appointment.status === activeFilter;
  });
  const sorted = [...filtered].sort((left, right) => {
    const difference = new Date(left.startAt) - new Date(right.startAt);
    return sortOrder === "oldest" ? difference : -difference;
  });
  const totalPages = Math.max(
    1,
    Math.ceil(sorted.length / CURRENT_APPOINTMENTS_PAGE_SIZE),
  );
  const safePage = Math.min(currentPage, totalPages);
  const pageAppointments = sorted.slice(
    (safePage - 1) * CURRENT_APPOINTMENTS_PAGE_SIZE,
    safePage * CURRENT_APPOINTMENTS_PAGE_SIZE,
  );

  useEffect(() => {
    if (currentPage > totalPages) onPageChange(totalPages);
  }, [currentPage, onPageChange, totalPages]);

  const changeFilter = (filter) => {
    setActiveFilter(filter);
    onPageChange(1);
  };

  return (
    <section className="min-w-0 space-y-4 pb-16 md:pb-0">
      <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div
          className="hidden min-w-0 flex-wrap gap-x-1 gap-y-2 sm:flex"
          role="group"
          aria-label="Filter current appointments"
        >
          {CURRENT_APPOINTMENT_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => changeFilter(filter)}
              aria-pressed={activeFilter === filter}
              className={`min-h-9 rounded-lg px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 sm:text-sm ${
                activeFilter === filter
                  ? "bg-maroon-800 text-white shadow-sm"
                  : "border border-slate-200 bg-white text-slate-700 hover:border-maroon-200 hover:bg-maroon-50"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
        <div
          className="hidden min-w-0 grid-cols-5 gap-1 min-[480px]:grid sm:hidden"
          role="group"
          aria-label="Filter current appointments"
        >
          {PRIMARY_MOBILE_APPOINTMENT_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => changeFilter(filter)}
              aria-pressed={activeFilter === filter}
              className={`min-h-9 min-w-0 rounded-lg px-1 py-2 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 min-[380px]:text-xs ${
                activeFilter === filter
                  ? "bg-maroon-800 text-white"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              {filter}
            </button>
          ))}
          <details className="group relative min-w-0">
            <summary
              className={`flex min-h-9 cursor-pointer list-none items-center justify-center rounded-lg border px-1 py-2 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 min-[380px]:text-xs [&::-webkit-details-marker]:hidden ${
                SECONDARY_MOBILE_APPOINTMENT_FILTERS.includes(activeFilter)
                  ? "border-maroon-800 bg-maroon-800 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              More
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {SECONDARY_MOBILE_APPOINTMENT_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => changeFilter(filter)}
                  aria-pressed={activeFilter === filter}
                  className={`w-full rounded-md px-3 py-2 text-left text-xs font-semibold ${
                    activeFilter === filter
                      ? "bg-maroon-800 text-white"
                      : "text-slate-700 hover:bg-maroon-50"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </details>
        </div>
        <div
          className="grid min-w-0 grid-cols-4 gap-1 min-[480px]:hidden"
          role="group"
          aria-label="Filter current appointments"
        >
          {PRIMARY_MOBILE_APPOINTMENT_FILTERS.slice(0, 3).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => changeFilter(filter)}
              aria-pressed={activeFilter === filter}
              className={`min-h-9 min-w-0 rounded-lg px-1 py-2 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 min-[380px]:text-xs ${
                activeFilter === filter
                  ? "bg-maroon-800 text-white"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              {filter}
            </button>
          ))}
          <details className="group relative min-w-0">
            <summary
              className={`flex min-h-9 cursor-pointer list-none items-center justify-center rounded-lg border px-1 py-2 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 min-[380px]:text-xs [&::-webkit-details-marker]:hidden ${
                ["Confirmed", ...SECONDARY_MOBILE_APPOINTMENT_FILTERS].includes(
                  activeFilter,
                )
                  ? "border-maroon-800 bg-maroon-800 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              More
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {["Confirmed", ...SECONDARY_MOBILE_APPOINTMENT_FILTERS].map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => changeFilter(filter)}
                    aria-pressed={activeFilter === filter}
                    className={`w-full rounded-md px-3 py-2 text-left text-xs font-semibold ${
                      activeFilter === filter
                        ? "bg-maroon-800 text-white"
                        : "text-slate-700 hover:bg-maroon-50"
                    }`}
                  >
                    {filter}
                  </button>
                ),
              )}
            </div>
          </details>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-600">
          <ArrowUpDown size={15} aria-hidden="true" />
          <span>Sort by</span>
          <select
            value={sortOrder}
            onChange={(event) => {
              setSortOrder(event.target.value);
              onPageChange(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-800 outline-none focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title={
            activeFilter === "All"
              ? "No current appointments"
              : `No ${activeFilter.toLowerCase()} appointments found.`
          }
          text={
            activeFilter === "All"
              ? "Your active consultation appointments will appear here."
              : "Choose another filter to review your current appointments."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-200">
            {pageAppointments.map((appointment) => (
              <StudentAppointmentCard
                key={appointment._id}
                appointment={appointment}
                renderActions={renderActions}
              />
            ))}
          </div>
          <div className="sm:[&>div]:pr-16 md:[&>div]:pr-20">
            <Pagination
              currentPage={safePage}
              totalItems={sorted.length}
              onPageChange={onPageChange}
              itemsPerPage={CURRENT_APPOINTMENTS_PAGE_SIZE}
              itemLabel="appointments"
            />
          </div>
        </div>
      )}
    </section>
  );
}

function StudentAppointmentCard({ appointment, renderActions }) {
  const isFaceToFace = appointment.consultationMode === "Face-to-Face";
  const ModeIcon = isFaceToFace ? MapPin : Monitor;
  const consultationPlace = isFaceToFace
    ? appointment.location || "Location to be confirmed"
    : appointment.meetingPlatform || "Meeting platform to be confirmed";
  const status = getAppointmentDisplayStatus(appointment);

  return (
    <article className="grid min-w-0 bg-white md:grid-cols-[minmax(0,1fr)_minmax(13rem,.8fr)_auto] min-[1200px]:grid-cols-[minmax(0,1.1fr)_minmax(14rem,.85fr)_minmax(8rem,.4fr)_minmax(13rem,.7fr)]">
      <div className="min-w-0 p-3 sm:p-4 md:flex md:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <ProfileImagePreview
            user={appointment.faculty}
            className="h-9 w-9 shrink-0 rounded-full bg-maroon-800 text-xs font-bold text-white sm:h-10 sm:w-10"
            buttonClassName="shrink-0 rounded-full"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start justify-between gap-2 md:block">
              <div className="min-w-0">
                <h2 className="break-words text-sm font-bold leading-5 text-slate-900 sm:text-base">
                  {appointment.subject || "Consultation"}
                </h2>
                <p className="mt-1 break-words text-xs text-slate-600 sm:text-sm">
                  <span className="font-semibold">Faculty:</span>{" "}
                  {formatPersonName(appointment.faculty?.name) ||
                    "Not provided"}
                </p>
              </div>
              <span className="shrink-0 md:hidden">
                <StatusBadge status={status} compact />
              </span>
            </div>
          </div>
        </div>
      </div>

      <dl className="min-w-0 border-t border-slate-200 bg-slate-50/60 px-3 py-3 text-sm md:flex md:flex-col md:justify-center md:border-l md:border-t-0 md:bg-white md:px-4">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <Clock3 size={13} aria-hidden="true" /> Time
          </dt>
          <dd className="mt-1 break-words font-semibold text-slate-700">
            {appointment.startAt
              ? `${formatClock(appointment.startAt)} – ${formatClock(appointment.endAt)}`
              : "Not scheduled yet"}
          </dd>
        </div>
        <div className="mt-2 min-w-0">
          <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <ModeIcon size={13} aria-hidden="true" /> Mode
          </dt>
          <dd className="mt-1 break-words font-semibold text-slate-700">
            {appointment.startAt
              ? `${appointment.consultationMode || "Not provided"} · ${consultationPlace}`
              : "Faculty will choose the meeting mode"}
          </dd>
        </div>
      </dl>

      <div className="hidden min-w-0 items-center justify-center border-l border-slate-200 px-3 md:flex">
        <div className="flex justify-center">
          <StatusBadge status={status} compact />
        </div>
      </div>

      <div className="min-w-0 border-t border-slate-200 p-3 md:col-span-3 md:px-4 min-[1200px]:col-span-1 min-[1200px]:flex min-[1200px]:items-center min-[1200px]:justify-center min-[1200px]:border-l min-[1200px]:border-t-0">
        <div className="min-w-0 min-[1200px]:hidden">
          {renderActions(appointment, true)}
        </div>
        <div className="hidden min-w-0 min-[1200px]:block">
          {renderActions(appointment)}
        </div>
      </div>
    </article>
  );
}

function ModalDetail({ label, value, wide = false }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-slate-800">
        {value || "Not provided"}
      </dd>
    </div>
  );
}

function ConsultationHistoryTable({
  appointments,
  currentPage,
  onPageChange,
  onView,
  role,
  mobileResetKey,
  emptyTitle,
  itemLabel = "consultation records",
  renderActions,
  showTime = false,
}) {
  const [expandedAppointmentId, setExpandedAppointmentId] = useState(null);
  const totalPages = Math.max(
    1,
    Math.ceil(appointments.length / HISTORY_ITEMS_PER_PAGE),
  );
  const safePage = Math.min(currentPage, totalPages);
  const pageAppointments = appointments.slice(
    (safePage - 1) * HISTORY_ITEMS_PER_PAGE,
    safePage * HISTORY_ITEMS_PER_PAGE,
  );
  const facultyEmptySlots =
    ["faculty", "dean"].includes(role) && appointments.length > 0
      ? Math.max(0, HISTORY_ITEMS_PER_PAGE - pageAppointments.length)
      : 0;
  const personLabel = ["faculty", "dean"].includes(role) ? "Student" : "Faculty";
  const personFor = (appointment) =>
    ["faculty", "dean"].includes(role) ? appointment.student : appointment.faculty;
  useEffect(() => {
    if (currentPage > totalPages) onPageChange(totalPages);
  }, [currentPage, onPageChange, totalPages]);
  useEffect(() => {
    setExpandedAppointmentId(null);
  }, [mobileResetKey]);
  useEffect(() => {
    if (
      expandedAppointmentId &&
      !pageAppointments.some(
        (appointment) => appointment._id === expandedAppointmentId,
      )
    ) {
      setExpandedAppointmentId(null);
    }
  }, [expandedAppointmentId, pageAppointments]);
  const date = (value) => {
    if (!value) return "Not scheduled";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? "Not provided"
      : parsed.toLocaleDateString("en-PH", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "short",
          day: "numeric",
        });
  };
  const duration = (appointment) =>
    appointment.estimatedDurationMinutes
      ? `${appointment.estimatedDurationMinutes} min`
      : "Not provided";

  return (
    <>
      <div className="hidden">
        <table
          className={`responsive-table text-xs 2xl:text-[13px] ${role === "student" ? "student-consultation-history-table" : ""}`}
        >
          <thead className="h-11 bg-maroon-800 text-[11px] uppercase tracking-wide text-white 2xl:text-xs">
            <tr>
              <th
                className={`${renderActions ? "w-[11%]" : "w-[13%]"} px-2.5 py-2 font-semibold 2xl:px-3`}
              >
                Date
              </th>
              <th
                className={`${renderActions ? "w-[14%]" : "w-[17%]"} px-2.5 py-2 text-center font-semibold 2xl:px-3`}
              >
                Subject / Topic
              </th>
              <th
                className={`${renderActions ? "w-[10%]" : "w-[14%]"} px-2.5 py-2 font-semibold 2xl:px-3`}
              >
                {personLabel}
              </th>
              <th
                className={`${renderActions ? "w-[11%]" : "w-[12%]"} px-2.5 py-2 font-semibold 2xl:px-3`}
              >
                Mode
              </th>
              <th
                className={`${renderActions ? "w-[8%]" : "w-[13%]"} px-2.5 py-2 font-semibold 2xl:px-3`}
              >
                Duration
              </th>
              <th
                className={`${renderActions ? "w-[18%]" : "w-[17%]"} px-2.5 py-2 text-center font-semibold 2xl:px-3`}
              >
                Status
              </th>
              <th
                className={`${renderActions ? "w-[28%] pl-4 pr-6 2xl:pr-8" : "w-[14%] px-2.5 2xl:px-3"} py-2 font-semibold`}
              >
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {appointments.length === 0 ? (
              <tr className="bg-white">
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  {emptyTitle}
                </td>
              </tr>
            ) : (
              <>
                {pageAppointments.map((appointment) => (
                  <tr
                    key={appointment._id}
                    className={`${["faculty", "dean"].includes(role) ? "h-14" : ""} align-middle hover:bg-slate-50`}
                  >
                    <td className="px-2.5 py-2 whitespace-nowrap text-slate-600 2xl:px-3">
                      {date(appointment.startAt)}
                      {showTime && (
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {formatClock(appointment.startAt)} –{" "}
                          {formatClock(appointment.endAt)}
                        </span>
                      )}
                    </td>
                    <td className="min-w-0 px-2.5 py-2 2xl:px-3">
                      <p
                        className="min-w-0 break-words text-center font-medium leading-5 text-slate-900"
                        title={appointment.subject}
                      >
                        {appointment.subject || "Consultation"}
                      </p>
                    </td>
                    <td className="min-w-0 break-words px-2.5 py-2 leading-5 text-slate-700 2xl:px-3">
                      {formatPersonName(personFor(appointment)?.name) ||
                        "Not provided"}
                    </td>
                    <td className="px-2.5 py-2 text-slate-600 2xl:px-3">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {role === "student" &&
                          (appointment.consultationMode === "Face-to-Face" ? (
                            <MapPin
                              size={14}
                              className="shrink-0 text-maroon-700"
                              aria-hidden="true"
                            />
                          ) : (
                            <Monitor
                              size={14}
                              className="shrink-0 text-maroon-700"
                              aria-hidden="true"
                            />
                          ))}
                        <span className="min-w-0 whitespace-nowrap">
                          {appointment.consultationMode || "Not provided"}
                        </span>
                      </span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-slate-600 2xl:px-3">
                      {duration(appointment)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 2xl:px-3">
                      <div className="flex items-center justify-center">
                        <StatusBadge
                          status={
                            role === "student"
                              ? getAppointmentDisplayStatus(appointment)
                              : appointment.status
                          }
                          compact
                        />
                      </div>
                    </td>
                    <td
                      className={`whitespace-nowrap py-2 ${renderActions ? "pl-4 pr-6 2xl:pr-8" : "px-2 2xl:px-3"}`}
                    >
                      {renderActions ? (
                        renderActions(appointment)
                      ) : (
                        <button
                          type="button"
                          onClick={() => onView(appointment)}
                          className="btn-action-sm"
                        >
                          View Details
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {Array.from({ length: facultyEmptySlots }, (_, index) => (
                  <tr
                    key={`faculty-history-empty-slot-${index}`}
                    className="h-14 bg-white"
                    aria-hidden="true"
                  >
                    <td colSpan={7} />
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid min-w-0 gap-3">
        {appointments.length === 0 ? (
          <EmptyState title={emptyTitle} />
        ) : (
          pageAppointments.map((appointment) =>
            role === "student" ? (
              <FacultyHistoryAccordionRow
                key={appointment._id}
                appointment={appointment}
                studentName={
                  formatPersonName(personFor(appointment)?.name) ||
                  "Faculty not provided"
                }
                formattedDate={date(appointment.startAt)}
                duration={duration(appointment)}
                expanded={expandedAppointmentId === appointment._id}
                onToggle={() =>
                  setExpandedAppointmentId((current) =>
                    current === appointment._id ? null : appointment._id,
                  )
                }
                onView={() => onView(appointment)}
                participantLabel="Faculty"
              />
            ) : (
              <FacultyHistoryAccordionRow
                key={appointment._id}
                appointment={appointment}
                studentName={
                  formatPersonName(personFor(appointment)?.name) ||
                  "Student not provided"
                }
                formattedDate={date(appointment.startAt)}
                duration={duration(appointment)}
                expanded={expandedAppointmentId === appointment._id}
                onToggle={() =>
                  setExpandedAppointmentId((current) =>
                    current === appointment._id ? null : appointment._id,
                  )
                }
                onView={() => onView(appointment)}
              />
            ),
          )
        )}
      </div>
      {appointments.length > 0 && (
        <div
          className={`overflow-hidden rounded-xl border border-slate-200 ${
            role === "student" ? "consultation-history-pagination" : ""
          }`}
        >
          <Pagination
            currentPage={safePage}
            totalItems={appointments.length}
            onPageChange={(page) => {
              setExpandedAppointmentId(null);
              onPageChange(page);
            }}
            itemsPerPage={HISTORY_ITEMS_PER_PAGE}
            itemLabel={itemLabel}
          />
        </div>
      )}
    </>
  );
}

function FacultyHistoryAccordionRow({
  appointment,
  studentName,
  formattedDate,
  duration,
  expanded,
  onToggle,
  onView,
  participantLabel = "Student",
}) {
  const panelId = `faculty-history-panel-${appointment._id}`;
  const subject = appointment.subject || "Consultation";
  const mode = appointment.consultationMode || "Not provided";
  const ModeIcon = mode === "Face-to-Face" ? MapPin : Monitor;

  return (
    <article
      className={`w-full min-w-0 overflow-hidden rounded-xl border bg-white transition-colors duration-200 ${
        expanded ? "border-gold-300" : "border-slate-200"
      }`}
    >
      <div className="grid min-h-[92px] min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 p-3 sm:min-h-[96px] sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:gap-4 sm:px-5 sm:py-3.5">
        <div className="grid h-[4.5rem] w-14 shrink-0 content-center rounded-lg border border-maroon-100 bg-maroon-50 text-center sm:h-20 sm:w-16">
          <span className="text-[9px] font-extrabold uppercase tracking-wide text-maroon-700 sm:text-[10px]">
            {appointmentDatePart(appointment, {
              month: "short",
            })}
          </span>
          <span className="text-xl font-extrabold leading-6 text-maroon-900 sm:text-2xl">
            {appointmentDatePart(appointment, {
              day: "numeric",
            })}
          </span>
          <span className="text-[9px] font-semibold text-slate-500">
            {appointmentDatePart(appointment, {
              year: "numeric",
            })}
          </span>
        </div>

        <div className="min-w-0">
          <h2 className="min-w-0 break-words text-sm font-bold leading-5 text-slate-900 sm:text-base">
            {subject}
          </h2>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-600 sm:text-sm">
            <UserRound
              size={14}
              className="shrink-0 text-maroon-700"
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">
              <span className="font-semibold">{participantLabel}:</span>{" "}
              {studentName}
            </span>
          </p>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-600 sm:text-sm">
            <ModeIcon
              size={14}
              className="shrink-0 text-maroon-700"
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">
              {mode} <span aria-hidden="true">·</span> {duration}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <StatusBadge status={appointment.status} compact />
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? "Collapse" : "Expand"} consultation details for ${subject}`}
            className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-maroon-800 transition hover:bg-maroon-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300"
          >
            {expanded ? (
              <ChevronUp size={19} aria-hidden="true" />
            ) : (
              <ChevronRight size={19} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div id={panelId} className="px-3 pb-3 sm:px-5 sm:pb-5">
          <dl className="grid min-w-0 grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 min-[360px]:grid-cols-2 lg:grid-cols-4">
            <FacultyHistoryDetail icon={CalendarDays} label="Date & Time">
              <span className="block">{formattedDate}</span>
              <span className="mt-0.5 block break-words text-xs text-slate-600">
                {formatClock(appointment.startAt)} –{" "}
                {formatClock(appointment.endAt)}
              </span>
            </FacultyHistoryDetail>
            <FacultyHistoryDetail icon={ModeIcon} label="Mode">
              {mode}
            </FacultyHistoryDetail>
            <FacultyHistoryDetail icon={Clock3} label="Duration">
              {duration}
            </FacultyHistoryDetail>
            <FacultyHistoryDetail icon={Tag} label="Status">
              <StatusBadge status={appointment.status} compact />
            </FacultyHistoryDetail>
          </dl>

          <dl className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-maroon-800">
                <Tag size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Subject / Topic
                </dt>
                <dd className="mt-1 break-words text-sm font-medium text-slate-900">
                  {subject}
                </dd>
              </div>
            </div>
          </dl>

          <button
            type="button"
            onClick={onView}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-maroon-300 bg-white px-4 text-sm font-semibold text-maroon-800 transition hover:bg-maroon-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300"
          >
            <Eye size={16} aria-hidden="true" /> View Details
          </button>
        </div>
      )}
    </article>
  );
}

function FacultyHistoryDetail({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0 border-b border-slate-200 p-4 last:border-b-0 min-[360px]:odd:border-r min-[360px]:[&:nth-child(3)]:border-b-0 min-[360px]:[&:nth-child(4)]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-maroon-800">
          <Icon size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {label}
          </dt>
          <dd className="mt-1 break-words text-sm font-medium text-slate-900">
            {children}
          </dd>
        </div>
      </div>
    </div>
  );
}

function StudentHistoryMobileRow({
  appointment,
  facultyName,
  formattedDate,
  duration,
  expanded,
  onToggle,
  renderActions,
}) {
  const panelId = `student-history-panel-${appointment._id}`;
  const subject = appointment.subject || "Consultation";
  const mode = appointment.consultationMode || "Not provided";
  const ModeIcon = mode === "Face-to-Face" ? MapPin : Monitor;

  return (
    <article className="w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid min-h-[88px] min-w-0 grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2.5 p-3">
        <div className="grid h-16 w-[3.25rem] shrink-0 content-center rounded-lg bg-maroon-50 text-center">
          <span className="text-[9px] font-extrabold uppercase tracking-wide text-maroon-700">
            {appointmentDatePart(appointment, {
              month: "short",
            })}
          </span>
          <span className="text-xl font-extrabold leading-5 text-maroon-900">
            {appointmentDatePart(appointment, {
              day: "numeric",
            })}
          </span>
          <span className="text-[9px] font-semibold text-slate-500">
            {appointmentDatePart(appointment, {
              year: "numeric",
            })}
          </span>
        </div>

        <div className="min-w-0 self-center">
          <h3 className="break-words text-sm font-bold leading-5 text-slate-900">
            {subject}
          </h3>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 break-words text-xs leading-4 text-slate-600">
            <UserRound size={13} className="shrink-0 text-maroon-700" />
            <span className="min-w-0 break-words">{facultyName}</span>
          </p>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-4 text-slate-600">
            <ModeIcon size={13} className="shrink-0 text-maroon-700" />
            <span className="break-words">{mode}</span>
            <span aria-hidden="true">•</span>
            <span className="whitespace-nowrap">{duration}</span>
          </p>
        </div>

        <div className="flex min-w-0 items-center gap-1 self-center">
          <span className="flex max-w-[4.75rem] justify-end min-[390px]:max-w-[8.5rem]">
            <StatusBadge
              status={getAppointmentDisplayStatus(appointment)}
              compact
              allowWrap
            />
          </span>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? "Collapse" : "Expand"} consultation actions for ${subject}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-maroon-800 transition-colors hover:bg-maroon-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300"
          >
            {expanded ? (
              <ChevronUp size={19} aria-hidden="true" />
            ) : (
              <ChevronRight size={19} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div
          id={panelId}
          className="mx-3 mb-3 animate-[page-in_.15s_ease-out] rounded-xl border border-slate-200 bg-slate-50/70 p-3"
        >
          <dl className="grid min-w-0 grid-cols-1 gap-3 text-xs min-[360px]:grid-cols-2">
            <div className="min-w-0">
              <dt className="font-bold uppercase tracking-wide text-slate-500">
                Date
              </dt>
              <dd className="mt-1 break-words text-sm text-slate-800">
                {formattedDate}
                <span className="mt-0.5 block text-xs text-slate-600">
                  {formatClock(appointment.startAt)} –{" "}
                  {formatClock(appointment.endAt)}
                </span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-bold uppercase tracking-wide text-slate-500">
                Mode
              </dt>
              <dd className="mt-1 flex min-w-0 items-center gap-1.5 break-words text-sm text-slate-800">
                <ModeIcon size={14} className="shrink-0 text-maroon-700" />
                {mode}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-bold uppercase tracking-wide text-slate-500">
                Duration
              </dt>
              <dd className="mt-1 text-sm text-slate-800">{duration}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-bold uppercase tracking-wide text-slate-500">
                Subject / Topic
              </dt>
              <dd className="mt-1 break-words text-sm text-slate-800">
                {subject}
              </dd>
            </div>
          </dl>
          {renderActions?.(appointment, true)}
        </div>
      )}
    </article>
  );
}
