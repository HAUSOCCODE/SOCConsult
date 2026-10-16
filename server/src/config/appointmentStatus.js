export const APPOINTMENT_STATUSES = Object.freeze([
  "Pending", "Reschedule Proposed", "Confirmed", "Rejected", "Cancelled",
  "Expired", "Awaiting Attendance Update", "Completed", "Attendance Review",
]);
export const LEGACY_APPOINTMENT_STATUSES = Object.freeze([
  "Awaiting Faculty Schedule", "Approved", "Needs Reschedule", "Rescheduled", "No Show",
]);
export const TERMINAL_STATUSES = Object.freeze(["Completed", "Rejected", "Cancelled", "Expired"]);
export const BLOCKING_STATUSES = Object.freeze(["Pending", "Reschedule Proposed", "Confirmed"]);
export const isTerminalStatus = (status) => TERMINAL_STATUSES.includes(status);
export const isUnresolvedStatus = (status) => APPOINTMENT_STATUSES.includes(status) && !isTerminalStatus(status);
export const isLegacyStatus = (status) => LEGACY_APPOINTMENT_STATUSES.includes(status);

// Participant commands. Attendance destinations remain unavailable to callers.
export const TRANSITION_RULES = Object.freeze({
  confirm: { from: ["Pending"], to: "Confirmed", actor: "faculty" },
  reject: { from: ["Pending"], to: "Rejected", actor: "faculty" },
  propose: { from: ["Pending", "Confirmed"], to: "Reschedule Proposed", actor: "faculty" },
  accept_proposal: { from: ["Reschedule Proposed"], to: "Confirmed", actor: "student" },
  reject_proposal: { from: ["Reschedule Proposed"], to: "Pending", actor: "student" },
  cancel: { from: ["Pending", "Reschedule Proposed", "Confirmed"], to: "Cancelled", actor: "participant" },
  expire: { from: ["Pending"], to: "Expired", actor: "system" },
});

// Executed only by the transactional attendance service, never participant status input.
export const ATTENDANCE_TRANSITIONS = Object.freeze({
  "Confirmed": ["Awaiting Attendance Update"],
  "Awaiting Attendance Update": ["Completed", "Attendance Review"],
  "Attendance Review": [], // Resolution requires the later authorized Dean workflow.
});
