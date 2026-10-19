import Appointment from "../models/Appointment.js";
import Availability from "../models/Availability.js";
import { BLOCKING_STATUSES, TERMINAL_STATUSES } from "../config/appointmentStatus.js";

export const CALENDAR_STATUSES = ["Pending", "Reschedule Proposed", "Confirmed", "Awaiting Attendance Update", "Attendance Review"];
const FINALIZED = [...TERMINAL_STATUSES, "No Show"];
const DAY = 86400000;
export const CALENDAR_LIMIT = 1000;
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
export function calendarDateAtManilaMidnight(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? new Date(+date - 8 * 3600000) : null;
}
export function parseCalendarQuery(input) {
  if (Object.keys(input).some(key => !["start", "end", "includeAvailability", "includeInactive", "includeFinalized"].includes(key))) fail("Invalid calendar filters. Owner IDs are not accepted.");
  const start = calendarDateAtManilaMidnight(input.start), end = calendarDateAtManilaMidnight(input.end);
  if (!start || !end) fail("Start and end must be valid calendar dates in YYYY-MM-DD format.");
  const endExclusive = new Date(+end + DAY);
  if (+start >= +endExclusive || +endExclusive - +start > 62 * DAY) fail("Choose a calendar range of up to 62 inclusive days.");
  const options = {};
  for (const key of ["includeAvailability", "includeInactive", "includeFinalized"]) {
    if (input[key] !== undefined && !["true", "false"].includes(input[key])) fail("Calendar options must be true or false.");
    options[key] = input[key] === undefined ? key !== "includeFinalized" : input[key] === "true";
  }
  return { start, endExclusive, ...options };
}
const stamp = value => value == null ? NaN : +new Date(value);
const valid = (start, end) => Number.isFinite(stamp(start)) && stamp(end) > stamp(start);
const overlaps = (start, end, range) => valid(start, end) && stamp(start) < +range.endExclusive && stamp(end) > +range.start;
const overlapQuery = (start, end, range) => ({ [start]: { $type: "date", $lt: range.endExclusive }, [end]: { $type: "date", $gt: range.start } });
export function calendarEvent(row, role = "current") {
  const proposed = role === "proposed";
  const mode = proposed ? row.proposedConsultationMode : row.consultationMode;
  return { id: `appointment-${row._id}-${role}`, appointmentId: String(row._id), kind: "appointment", scheduleRole: role,
    title: row.subject || "Consultation", topic: row.subject || "Consultation", participantName: row.student?.name || "Student unavailable",
    student: { name: row.student?.name || "Student unavailable" },
    start: proposed ? row.proposedStartAt : row.startAt, end: proposed ? row.proposedEndAt : row.endAt,
    status: row.status, displayStatus: proposed ? "Proposed schedule — awaiting Student response; not reserved"
      : row.status === "Reschedule Proposed" ? "Current schedule — reschedule pending" : row.status === "Pending" ? "Pending request"
        : row.status === "Confirmed" ? "Confirmed consultation" : row.status,
    mode, location: mode === "Face-to-Face" ? (proposed ? row.proposedLocation : row.location) || null : null,
    meetingPlatform: mode === "Online" ? (proposed ? row.proposedMeetingPlatform : row.meetingPlatform) || "Online meeting" : null };
}
const bounded = async query => {
  const rows = await query.sort({ startAt: 1, _id: 1 }).limit(CALENDAR_LIMIT + 1).maxTimeMS(10000).lean();
  if (rows.length > CALENDAR_LIMIT) fail("Too many calendar records. Choose a narrower date range.", 422);
  return rows;
};
export async function facultyCalendar({ faculty, input, now = new Date() }) {
  const range = parseCalendarQuery(input);
  const current = overlapQuery("startAt", "endAt", range), proposal = overlapQuery("proposedStartAt", "proposedEndAt", range);
  // Include linked reservations even when their malformed schedule cannot be plotted.
  const slots = range.includeAvailability ? await bounded(Availability.find({ faculty, ...current, endAt: { ...current.endAt, $gt: new Date(Math.max(+now, +range.start)) } })
    .select("startAt endAt mode location meetingPlatform isActive +reservationToken")) : [];
  const appointments = await bounded(Appointment.find({ faculty, $or: [
    { status: { $in: CALENDAR_STATUSES }, ...current },
    { status: "Reschedule Proposed", ...proposal },
    ...(range.includeFinalized ? [{ status: { $in: FINALIZED }, ...current, endAt: { ...current.endAt, $lte: now } }] : []),
    ...(slots.length ? [{ status: { $in: BLOCKING_STATUSES }, availability: { $in: slots.map(slot => slot._id) } }] : []),
  ] }).select("student availability subject status startAt endAt consultationMode location meetingPlatform proposedAvailability proposedStartAt proposedEndAt proposedConsultationMode proposedLocation proposedMeetingPlatform")
    .populate({ path: "student", select: "name", options: { maxTimeMS: 10000 } }));
  const events = [];
  for (const row of appointments) {
    if (overlaps(row.startAt, row.endAt, range) && (CALENDAR_STATUSES.includes(row.status) || (range.includeFinalized && FINALIZED.includes(row.status) && stamp(row.endAt) <= +now))) events.push(calendarEvent(row));
    if (row.status === "Reschedule Proposed" && overlaps(row.proposedStartAt, row.proposedEndAt, range)) events.push(calendarEvent(row, "proposed"));
  }
  for (const slot of slots) {
    if (!overlaps(slot.startAt, slot.endAt, range) || stamp(slot.endAt) <= +now) continue;
    if (appointments.some(row => BLOCKING_STATUSES.includes(row.status) && (String(row.availability) === String(slot._id) ||
      (slot.isActive && valid(row.startAt, row.endAt) && stamp(row.startAt) < stamp(slot.endAt) && stamp(row.endAt) > stamp(slot.startAt))))) continue;
    const available = slot.isActive && !slot.reservationToken && stamp(slot.startAt) > +now;
    if (!available && !range.includeInactive) continue;
    const pendingProposal = appointments.some(row => row.status === "Reschedule Proposed" && (String(row.proposedAvailability) === String(slot._id) ||
      (valid(row.proposedStartAt, row.proposedEndAt) && stamp(row.proposedStartAt) < stamp(slot.endAt) && stamp(row.proposedEndAt) > stamp(slot.startAt))));
    events.push({ id: `availability-${slot._id}`, availabilityId: String(slot._id), kind: "availability", title: "Consultation slot", topic: "Consultation slot", participantName: "Consultation slot",
      start: slot.startAt, end: slot.endAt, mode: slot.mode, status: available ? "Available" : "Inactive",
      displayStatus: available ? pendingProposal ? "Available — proposal pending; not reserved" : "Available" : "Inactive / unavailable",
      location: slot.mode === "Face-to-Face" ? slot.location || null : null, meetingPlatform: slot.mode === "Online" ? slot.meetingPlatform || null : null });
  }
  events.sort((a, b) => stamp(a.start) - stamp(b.start) || a.id.localeCompare(b.id));
  return { timezone: "Asia/Manila", range: { start: input.start, end: input.end }, events,
    upcoming: events.filter(event => event.kind === "appointment" && event.scheduleRole === "current" && stamp(event.start) >= +now).slice(0, 3) };
}
