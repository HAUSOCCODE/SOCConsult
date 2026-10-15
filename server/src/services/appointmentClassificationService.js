export const STUDENT_TERMINAL_STATUSES = Object.freeze([
  "Completed",
  "Cancelled",
  "Rejected",
  "Expired",
]);

const timestamp = (value) => {
  if (!value) return NaN;
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.getTime();
};

export function isAppointmentPast(appointment, now = new Date()) {
  const endTime = timestamp(appointment?.endAt);
  if (!Number.isFinite(endTime)) return false;
  return endTime <= timestamp(now);
}

export function isStudentCurrentAppointment(appointment, now = new Date()) {
  return !STUDENT_TERMINAL_STATUSES.includes(appointment?.status);
}

export function isStudentHistoryAppointment(appointment) {
  return STUDENT_TERMINAL_STATUSES.includes(appointment?.status);
}

export function classifyStudentAppointments(appointments, now = new Date()) {
  const current = appointments
    .filter((appointment) => isStudentCurrentAppointment(appointment, now))
    .sort((left, right) => timestamp(left.startAt) - timestamp(right.startAt));
  const history = appointments
    .filter((appointment) => isStudentHistoryAppointment(appointment, now))
    .sort((left, right) => timestamp(right.endAt) - timestamp(left.endAt));
  return { current, history };
}
