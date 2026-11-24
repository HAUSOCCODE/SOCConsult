import { formatDateOnly, formatManilaDate, formatManilaTime } from "./formatDateTime.js";
const instant = value => value && Number.isFinite(+new Date(value)) ? new Date(value) : null;

export function requestedDateLabel(value) {
  return formatDateOnly(value, "Requested date was not recorded");
}
export function preferredTimeLabel(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || "")
    ? formatManilaTime(new Date(`2000-01-01T${value}:00+08:00`)) : "Not recorded";
}
export function hasConfirmedSchedule(appointment) {
  return Boolean(instant(appointment.startAt)) && (
    ["Confirmed", "Completed", "Awaiting Attendance Update", "Attendance Review"].includes(appointment.status) ||
    appointment.statusHistory?.some(entry => entry.newStatus === "Confirmed")
  );
}
export function formatManilaHistorySchedule(appointment) {
  const start = instant(appointment.startAt), end = instant(appointment.endAt);
  if (start) return `${hasConfirmedSchedule(appointment) ? "Confirmed Schedule" : "Recorded Appointment Schedule"}: ${formatManilaDate(start)} · ${formatManilaTime(start)}${end ? ` – ${formatManilaTime(end)}` : ""}`;
  const parts = [];
  if (appointment.requestedConsultationDate) parts.push(`Requested Date: ${requestedDateLabel(appointment.requestedConsultationDate)}`);
  if (appointment.requestedConsultationTime) parts.push(`Preferred Time: ${preferredTimeLabel(appointment.requestedConsultationTime)}`);
  if (appointment.availableTimeSlots?.length) parts.push(`Preferred Availability: ${appointment.availableTimeSlots.map(slot => `${preferredTimeLabel(slot.startTime)} – ${preferredTimeLabel(slot.endTime)}`).join(", ")}`);
  return parts.length ? parts.join(" · ") : "Schedule and requested availability were not recorded";
}
