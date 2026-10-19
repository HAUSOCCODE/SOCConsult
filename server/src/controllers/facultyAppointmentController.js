import { safeReason } from "../services/appointmentHistoryService.js";
import { transitionAppointment } from "../services/appointmentTransitionService.js";

const ACTIVE_STATUSES = ["Pending", "Confirmed"];
import { BLOCKING_STATUSES } from "../config/appointmentStatus.js";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MANILA_OFFSET = "+08:00";

const validMeetingLink = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const manilaParts = (value) => {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    consultationDate: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
};

const parseManilaDateTime = (date, time) => {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
  const value = new Date(`${date}T${time}:00${MANILA_OFFSET}`);
  if (!Number.isFinite(value.getTime())) return null;
  const roundTrip = manilaParts(value);
  return roundTrip.consultationDate === date && roundTrip.time === time
    ? value
    : null;
};

const snapshot = ({
  startAt,
  endAt,
  duration,
  mode,
  location,
  meetingPlatform,
  meetingLink,
}) => {
  const start = manilaParts(startAt);
  const end = manilaParts(endAt);
  return {
    consultationDate: start.consultationDate,
    startAt,
    endAt,
    startTime: start.time,
    endTime: end.time,
    durationMinutes: duration,
    mode,
    location: mode === "Face-to-Face" ? location : "",
    meetingPlatform: mode === "Online" ? meetingPlatform : "",
    meetingLink: mode === "Online" ? meetingLink : "",
  };
};

const validateInput = (body, now = new Date()) => {
  const consultationDate = String(body.consultationDate || "").trim();
  const startTime = String(body.startTime || "").trim();
  const duration = Number(body.duration);
  const mode = String(body.mode || "").trim();
  const location = String(body.location || "").trim();
  const meetingPlatform = String(body.meetingPlatform || "").trim();
  const meetingLink = String(body.meetingLink || "").trim();
  const reason = safeReason(body.reason ?? "");
  const startAt = parseManilaDateTime(consultationDate, startTime);
  if (!startAt || startAt <= now)
    return { error: "Choose a valid future date and time in Asia/Manila." };
  if (!Number.isInteger(duration) || duration < 5 || duration > 240)
    return { error: "Duration must be between 5 and 240 minutes." };
  if (!ACTIVE_STATUSES.includes(body.currentStatus) && body.currentStatus)
    return { error: "This appointment cannot be rescheduled." };
  if (!["Face-to-Face", "Online"].includes(mode))
    return { error: "Choose a valid consultation mode." };
  if (!reason || reason.length < 5 || reason.length > 500)
    return {
      error: "Provide a reschedule reason between 5 and 500 characters.",
    };
  if (mode === "Face-to-Face" && (!location || location.length > 150))
    return { error: "Enter a location (up to 150 characters)." };
  if (
    mode === "Online" &&
    (!meetingPlatform ||
      meetingPlatform.length > 100 ||
      (meetingLink &&
        (!validMeetingLink(meetingLink) || meetingLink.length > 500)))
  )
    return {
      error:
        "Enter a meeting platform and an optional valid HTTP or HTTPS meeting link.",
    };
  return {
    value: {
      consultationDate,
      startAt,
      endAt: new Date(startAt.getTime() + duration * 60000),
      duration,
      mode,
      location,
      meetingPlatform,
      meetingLink,
      reason,
    },
  };
};

export async function rescheduleFacultyAppointment(req, res) {
  const validated = validateInput(req.body);
  if (validated.error) return res.status(400).json({ message: validated.error });
  const input = validated.value;
  const appointment = await transitionAppointment({ id: req.params.appointmentId, actor: req.user,
    action: "propose", reason: input.reason, expectedVersion: req.body.expectedVersion,
    schedule: { startAt: input.startAt, endAt: input.endAt, mode: input.mode,
      location: input.location, meetingPlatform: input.meetingPlatform, meetingLink: input.meetingLink } });
  return res.json({ message: "Consultation reschedule proposed and the student was notified.", appointment });
}

export const facultyAppointmentInternals = {
  ACTIVE_STATUSES,
  BLOCKING_STATUSES,
  manilaParts,
  parseManilaDateTime,
  snapshot,
  validateInput,
};
