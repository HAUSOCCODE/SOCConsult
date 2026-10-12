import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Notification from "../models/Notification.js";
import AuditLog from "../models/AuditLog.js";

const ACTIVE_STATUSES = ["Approved", "Rescheduled"];
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

const readableSchedule = (schedule) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(schedule.startAt);

const validateInput = (body, now = new Date()) => {
  const consultationDate = String(body.consultationDate || "").trim();
  const startTime = String(body.startTime || "").trim();
  const duration = Number(body.duration);
  const mode = String(body.mode || "").trim();
  const location = String(body.location || "").trim();
  const meetingPlatform = String(body.meetingPlatform || "").trim();
  const meetingLink = String(body.meetingLink || "").trim();
  const reason = String(body.reason || "").trim();
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
  if (!mongoose.isValidObjectId(req.params.appointmentId))
    return res.status(400).json({ message: "Invalid appointment ID." });
  const validated = validateInput(req.body);
  if (validated.error)
    return res.status(400).json({ message: validated.error });
  const input = validated.value;
  const appointment = await Appointment.findOne({
    _id: req.params.appointmentId,
    faculty: req.user.id,
  })
    .select("+meetingLink")
    .populate("student", "name")
    .populate("faculty", "name");
  if (!appointment)
    return res.status(404).json({ message: "Appointment not found." });
  if (!ACTIVE_STATUSES.includes(appointment.status))
    return res.status(409).json({
      message: "Only approved or rescheduled appointments can be rescheduled.",
    });
  if (!appointment.startAt || appointment.startAt <= new Date())
    return res.status(409).json({
      message:
        "An appointment that has started or passed cannot be rescheduled.",
    });
  const unchanged =
    appointment.startAt.getTime() === input.startAt.getTime() &&
    appointment.endAt.getTime() === input.endAt.getTime();
  if (unchanged)
    return res.status(409).json({
      message:
        "The new consultation schedule must differ from the current schedule.",
    });
  const overlap = {
    _id: { $ne: appointment._id },
    status: { $in: ACTIVE_STATUSES },
    startAt: { $lt: input.endAt },
    endAt: { $gt: input.startAt },
  };
  if (await Appointment.exists({ ...overlap, faculty: req.user.id }))
    return res.status(409).json({
      message: "The selected time conflicts with another faculty appointment.",
    });
  if (
    await Appointment.exists({ ...overlap, student: appointment.student._id })
  )
    return res.status(409).json({
      message: "The student already has another appointment during this time.",
    });

  const previous = snapshot({
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    duration:
      appointment.estimatedDurationMinutes ||
      Math.round((appointment.endAt - appointment.startAt) / 60000),
    mode: appointment.consultationMode || "Online",
    location: appointment.location || "",
    meetingPlatform: appointment.meetingPlatform || "",
    meetingLink: appointment.meetingLink || "",
  });
  const next = snapshot(input);
  const history = {
    previous,
    next,
    reason: input.reason,
    initiatedByRole: "Faculty",
    initiatedBy: req.user.id,
    createdAt: new Date(),
  };
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      updated = await Appointment.findOneAndUpdate(
        {
          _id: appointment._id,
          faculty: req.user.id,
          status: appointment.status,
          startAt: appointment.startAt,
          endAt: appointment.endAt,
        },
        {
          $set: {
            startAt: input.startAt,
            endAt: input.endAt,
            estimatedDurationMinutes: input.duration,
            consultationMode: input.mode,
            location: input.mode === "Face-to-Face" ? input.location : "",
            meetingPlatform:
              input.mode === "Online" ? input.meetingPlatform : "",
            meetingLink: input.mode === "Online" ? input.meetingLink : "",
            status: "Rescheduled",
            responseNote: input.reason,
            rescheduleRequested: false,
            rescheduleRequestStatus: "Approved",
            rescheduleReviewedAt: history.createdAt,
            rescheduleReviewedBy: req.user.id,
            rescheduleDecisionNote: input.reason,
          },
          $unset: { availability: 1 },
          $push: { scheduleHistory: history },
        },
        { new: true, runValidators: true, session },
      )
        .select("+meetingLink")
        .populate("student", "name")
        .populate("faculty", "name");
      if (!updated)
        throw Object.assign(new Error("Appointment changed"), {
          code: "APPOINTMENT_CHANGED",
        });
      const facultyName = updated.faculty?.name || req.user.name || "Faculty";
      const studentName = updated.student?.name || "Student";
      const oldLabel = readableSchedule(previous);
      const newLabel = readableSchedule(next);
      const destination =
        input.mode === "Face-to-Face"
          ? input.location
          : input.meetingLink || input.meetingPlatform;
      await Notification.create(
        [
          {
            recipient: updated.student._id,
            type: "appointment",
            title: "Consultation Rescheduled by Faculty",
            message: `Your ${updated.subject} consultation with ${facultyName} has been moved from ${oldLabel} to ${newLabel}. Mode: ${input.mode}. ${input.mode === "Face-to-Face" ? "Location" : "Meeting"}: ${destination}. Reason: ${input.reason}`,
            relatedEntityId: updated._id,
            actionUrl: "/student/appointments",
          },
        ],
        { session },
      );
      const audit = {
        subjectUser: updated.student._id,
        subjectRole: "student",
        actorUser: req.user.id,
        actorRole: req.user.role,
        actor: req.user.id,
        action: "appointment_rescheduled",
        category: "Appointment",
        description: "Consultation rescheduled by faculty",
        relatedEntityType: "Appointment",
        relatedEntityId: updated._id,
        changes: { before: previous, after: next },
        metadata: {
          appointmentId: String(updated._id),
          facultyName,
          studentName,
          topic: updated.subject,
          previousSchedule: oldLabel,
          newSchedule: newLabel,
          reason: input.reason,
          initiatedBy: "Faculty",
        },
        targetType: "Appointment",
        targetId: updated._id,
      };
      await AuditLog.create(
        [audit, { ...audit, subjectUser: req.user.id, subjectRole: req.user.role }],
        { session },
      );
    });
  } catch (error) {
    if (error.code === "APPOINTMENT_CHANGED")
      return res.status(409).json({
        message:
          "This appointment changed while you were rescheduling it. Refresh and try again.",
      });
    throw error;
  } finally {
    await session.endSession();
  }
  return res.json({
    message: "Consultation rescheduled and the student was notified.",
    appointment: updated,
  });
}

export const facultyAppointmentInternals = {
  ACTIVE_STATUSES,
  manilaParts,
  parseManilaDateTime,
  snapshot,
  validateInput,
};
