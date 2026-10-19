import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import Appointment from "../models/Appointment.js";
import Availability from "../models/Availability.js";
import { BLOCKING_STATUSES } from "../config/appointmentStatus.js";
import { rescheduleFacultyAppointment } from "../controllers/facultyAppointmentController.js";

const router = Router();
router.use(authenticate, authorize("faculty", "dean"));
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const CALENDAR_STATUSES = [
  "Confirmed",
  "Awaiting Attendance Update",
  "Attendance Review",
  "Completed",
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const calendarDateAtManilaMidnight = (value) => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const utcDate = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(utcDate.getTime()) ||
    utcDate.toISOString().slice(0, 10) !== value
  )
    return null;
  return new Date(utcDate.getTime() - MANILA_OFFSET_MS);
};

const calendarEvent = (appointment) => {
  const availability = appointment.availability;
  const mode = appointment.consultationMode || availability?.mode || "Online";
  return {
    id: String(appointment._id),
    title: appointment.subject || "Consultation",
    topic: appointment.subject || "Consultation",
    student: {
      id: String(appointment.student?._id || appointment.student || ""),
      name: appointment.student?.name || "Student",
    },
    start: appointment.startAt,
    end: appointment.endAt,
    duration: appointment.estimatedDurationMinutes || null,
    status: appointment.status,
    mode,
    location: mode === "Face-to-Face" ? appointment.location || null : null,
    meetingPlatform:
      mode === "Online"
        ? appointment.meetingPlatform ||
          availability?.meetingPlatform ||
          "Online meeting"
        : null,
    meetingLink:
      mode === "Online"
        ? appointment.meetingLink || availability?.meetingLink || null
        : null,
    reason: appointment.reason || "",
    responseNote: appointment.responseNote || "",
    yearLevel: appointment.yearLevel || "",
    createdAt: appointment.createdAt,
  };
};

const calendarQuery = (facultyId, extra = {}, combined = false) => ({
  faculty: facultyId,
  status: { $in: combined ? [...new Set([...CALENDAR_STATUSES, ...BLOCKING_STATUSES])] : CALENDAR_STATUSES },
  startAt: { $type: "date", ...extra },
  endAt: { $type: "date" },
});

const calendarRecords = (query) =>
  Appointment.find(query)
    .select(
      "+meetingLink student availability startAt endAt estimatedDurationMinutes subject reason yearLevel consultationMode location meetingPlatform status responseNote createdAt",
    )
    .populate("student", "name")
    .populate("availability", "mode location meetingPlatform +meetingLink")
    .sort({ startAt: 1 })
    .lean();

router.get("/calendar", async (req, res) => {
  const startAt = calendarDateAtManilaMidnight(req.query.start);
  const inclusiveEnd = calendarDateAtManilaMidnight(req.query.end);
  if (!startAt || !inclusiveEnd)
    return res.status(400).json({
      message:
        "Start and end must be valid calendar dates in YYYY-MM-DD format.",
    });
  const endAt = new Date(inclusiveEnd.getTime() + 86400000);
  if (startAt >= endAt || endAt - startAt > 62 * 86400000)
    return res.status(400).json({
      message: "Choose a calendar range of up to 62 days.",
    });

  const combined = req.query.includeAvailability === "true";
  const events = await calendarRecords(
    calendarQuery(req.user.id, { $gte: startAt, $lt: endAt }, combined),
  );
  const upcoming = await Appointment.find(
    calendarQuery(req.user.id, { $gte: new Date() }),
  )
    .select(
      "+meetingLink student availability startAt endAt estimatedDurationMinutes subject reason yearLevel consultationMode location meetingPlatform status responseNote createdAt",
    )
    .populate("student", "name")
    .populate("availability", "mode location meetingPlatform +meetingLink")
    .sort({ startAt: 1 })
    .limit(3)
    .lean();

  let slotEvents = [];
  if (combined) {
    const slots = await Availability.find({ faculty: req.user.id, startAt: { $gte: startAt, $lt: endAt },
      endAt: { $gt: new Date() } }).select("startAt endAt mode location meetingPlatform isActive +reservationToken").lean();
    const blocking = await Appointment.find({ faculty: req.user.id, status: { $in: BLOCKING_STATUSES },
      startAt: { $lt: endAt }, endAt: { $gt: startAt } }).select("availability startAt endAt").lean();
    slotEvents = slots.filter(slot => !blocking.some(item => String(item.availability) === String(slot._id) ||
      (slot.isActive && item.startAt < slot.endAt && item.endAt > slot.startAt))).map(slot => ({
      id: `availability-${slot._id}`, availabilityId: String(slot._id), kind: "availability",
      title: "Consultation slot", topic: "Consultation slot", participantName: "Consultation slot",
      start: slot.startAt, end: slot.endAt, mode: slot.mode,
      location: slot.mode === "Face-to-Face" ? slot.location : null,
      meetingPlatform: slot.mode === "Online" ? slot.meetingPlatform : null,
      status: slot.isActive && !slot.reservationToken && slot.startAt > new Date() ? "Available" : "Inactive",
    }));
  }
  return res.json({
    timezone: "Asia/Manila",
    range: { start: req.query.start, end: req.query.end },
    events: [...events.map(item => ({ ...calendarEvent(item), ...(combined && { displayStatus: item.status === "Pending" ? "Pending request" : item.status === "Confirmed" ? "Confirmed consultation" : item.status }) })), ...slotEvents].sort((a, b) => new Date(a.start) - new Date(b.start)),
    upcoming: upcoming.map(calendarEvent),
  });
});

router.patch(
  "/appointments/:appointmentId/reschedule",
  rescheduleFacultyAppointment,
);


export const facultyCalendarInternals = {
  CALENDAR_STATUSES,
  calendarDateAtManilaMidnight,
  calendarEvent,
};
export default router;
