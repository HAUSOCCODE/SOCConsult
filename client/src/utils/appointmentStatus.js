export const ACTIVE_REQUEST_STATUSES = Object.freeze([
  "Pending",
  "Reschedule Proposed",
  "Confirmed",
]);
export const ATTENDANCE_REQUIRED_STATUSES = Object.freeze([
  "Awaiting Attendance Update",
]);
export const UNDER_REVIEW_STATUSES = Object.freeze(["Attendance Review"]);
export const TERMINAL_STATUSES = Object.freeze([
  "Rejected",
  "Cancelled",
  "Expired",
  "Completed",
]);
export const STUDENT_CANCELLABLE_STATUSES = Object.freeze([
  "Pending",
  "Reschedule Proposed",
  "Confirmed",
]);

export const APPOINTMENT_STATUS_META = Object.freeze({
  Pending: { label: "Pending", group: "active" },
  "Reschedule Proposed": { label: "Reschedule Proposed", group: "active" },
  Confirmed: { label: "Confirmed", group: "active" },
  "Awaiting Attendance Update": {
    label: "Awaiting Attendance Update",
    group: "attendance",
  },
  "Attendance Review": { label: "Attendance Review", group: "review" },
  Rejected: { label: "Rejected", group: "terminal" },
  Cancelled: { label: "Cancelled", group: "terminal" },
  Expired: { label: "Expired", group: "terminal" },
  Completed: { label: "Completed", group: "terminal" },
});

export const getAppointmentStatusMeta = (status) =>
  APPOINTMENT_STATUS_META[status] || {
    label: "Status unavailable",
    group: "unknown",
  };

export const getAppointmentDisplayStatus = (appointment) =>
  getAppointmentStatusMeta(appointment?.status).label;

export const isAwaitingFacultyUpdate = (appointment) =>
  appointment?.status === "Awaiting Attendance Update";

export const canStudentCancelAppointment = (appointment, now = new Date()) => {
  if (!STUDENT_CANCELLABLE_STATUSES.includes(appointment?.status)) return false;
  const startAt = new Date(appointment?.startAt);
  if (!Number.isFinite(startAt.getTime()) || startAt <= now) return false;
  if (appointment.status !== "Reschedule Proposed") return true;
  const proposedStartAt = new Date(appointment.proposedStartAt);
  return Number.isFinite(proposedStartAt.getTime()) && proposedStartAt > now;
};

export const getStudentConsultationGroup = (status) => {
  if (ACTIVE_REQUEST_STATUSES.includes(status)) return "active";
  if (ATTENDANCE_REQUIRED_STATUSES.includes(status)) return "attendance";
  if (UNDER_REVIEW_STATUSES.includes(status)) return "review";
  if (TERMINAL_STATUSES.includes(status)) return "terminal";
  return "unknown";
};
