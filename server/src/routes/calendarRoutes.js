import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import Appointment from "../models/Appointment.js";

const router = Router();
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 93;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STUDENT_CALENDAR_STATUSES = Object.freeze([
  "Reschedule Proposed",
  "Confirmed",
  "Awaiting Attendance Update",
  "Attendance Review",
  "Completed",
]);

const manilaMidnight = (value) => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const utcCalendarDate = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(utcCalendarDate.getTime()) ||
    utcCalendarDate.toISOString().slice(0, 10) !== value
  )
    return null;
  return new Date(utcCalendarDate.getTime() - MANILA_OFFSET_MS);
};

const safeScheduleHistory = (history) =>
  Array.isArray(history)
    ? history.map((entry) => ({
        previous: entry.previous,
        next: entry.next,
        reason: entry.reason || "",
        initiatedByRole: entry.initiatedByRole,
        createdAt: entry.createdAt,
        response: entry.response,
        respondedAt: entry.respondedAt,
      }))
    : [];

const studentCalendarEvent = (appointment) => {
  const faculty = appointment.faculty || {};
  const mode = appointment.consultationMode || "Online";
  const facultyName = faculty.name || "Consultation provider";
  return {
    id: String(appointment._id),
    _id: String(appointment._id),
    title: appointment.subject || "Consultation",
    topic: appointment.subject || "Consultation",
    subject: appointment.subject || "Consultation",
    facultyName,
    participantName: facultyName,
    faculty: {
      id: String(faculty._id || faculty.id || appointment.faculty || ""),
      name: facultyName,
      position: faculty.position || "",
      specialization: faculty.specialization || "",
      office: faculty.office || "",
    },
    start: appointment.startAt,
    end: appointment.endAt,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    mode,
    consultationMode: mode,
    location: mode === "Face-to-Face" ? appointment.location || null : null,
    meetingPlatform:
      mode === "Online" ? appointment.meetingPlatform || "Online meeting" : null,
    status: appointment.status,
    reason: appointment.reason || "",
    proposedStartAt: appointment.proposedStartAt,
    proposedEndAt: appointment.proposedEndAt,
    proposedConsultationMode: appointment.proposedConsultationMode,
    proposedLocation: appointment.proposedLocation || null,
    proposedMeetingPlatform: appointment.proposedMeetingPlatform || null,
    proposalNote: appointment.proposalNote || "",
    scheduleHistory: safeScheduleHistory(appointment.scheduleHistory),
    createdAt: appointment.createdAt,
  };
};

router.use(authenticate, authorize("student"));

router.get("/student", async (req, res) => {
  const rangeStart = manilaMidnight(req.query.start);
  const inclusiveEnd = manilaMidnight(req.query.end);
  if (!rangeStart || !inclusiveEnd)
    return res.status(400).json({
      message: "Start and end must be valid calendar dates in YYYY-MM-DD format.",
    });
  if (rangeStart > inclusiveEnd)
    return res.status(400).json({ message: "Calendar start date must not be after end date." });

  const rangeEndExclusive = new Date(inclusiveEnd.getTime() + DAY_MS);
  const rangeDays = (rangeEndExclusive - rangeStart) / DAY_MS;
  if (rangeDays > MAX_RANGE_DAYS)
    return res.status(400).json({
      message: `Calendar range cannot exceed ${MAX_RANGE_DAYS} days.`,
    });

  const appointments = await Appointment.find({
    student: req.user.id,
    status: { $in: STUDENT_CALENDAR_STATUSES },
    startAt: { $type: "date", $lt: rangeEndExclusive },
    endAt: { $type: "date", $gt: rangeStart },
  })
    .select(
      "faculty startAt endAt subject reason consultationMode location meetingPlatform status proposedStartAt proposedEndAt proposedConsultationMode proposedLocation proposedMeetingPlatform proposalNote scheduleHistory createdAt",
    )
    .populate("faculty", "name position specialization office")
    .sort({ startAt: 1, _id: 1 })
    .lean();

  return res.json({
    timezone: "Asia/Manila",
    range: { start: req.query.start, end: req.query.end },
    events: appointments.map(studentCalendarEvent),
  });
});

export const studentCalendarInternals = {
  MAX_RANGE_DAYS,
  STUDENT_CALENDAR_STATUSES,
  manilaMidnight,
  safeScheduleHistory,
  studentCalendarEvent,
};

export default router;
