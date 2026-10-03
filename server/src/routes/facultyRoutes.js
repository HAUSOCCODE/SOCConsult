import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate, authorize } from "../middleware/auth.js";
import { chatWithRoleAi } from "../controllers/roleAiController.js";
import Appointment from "../models/Appointment.js";
import { rescheduleFacultyAppointment } from "../controllers/facultyAppointmentController.js";

const router = Router();
router.use(authenticate, authorize("faculty"));
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const CALENDAR_STATUSES = ["Approved", "Rescheduled", "Completed", "No Show"];
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

const calendarQuery = (facultyId, extra = {}) => ({
  faculty: facultyId,
  status: { $in: CALENDAR_STATUSES },
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

  const events = await calendarRecords(
    calendarQuery(req.user.id, { $gte: startAt, $lt: endAt }),
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

  return res.json({
    timezone: "Asia/Manila",
    range: { start: req.query.start, end: req.query.end },
    events: events.map(calendarEvent),
    upcoming: upcoming.map(calendarEvent),
  });
});

router.patch(
  "/appointments/:appointmentId/reschedule",
  rescheduleFacultyAppointment,
);

router.post(
  "/ai/chat",
  rateLimit({
    windowMs: 60000,
    limit: 8,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        message:
          "You're sending requests a little too quickly. Please wait a moment and try again.",
        retryAfter: 60,
      }),
  }),
  chatWithRoleAi("faculty"),
);

export const facultyCalendarInternals = {
  CALENDAR_STATUSES,
  calendarDateAtManilaMidnight,
  calendarEvent,
};
export default router;
