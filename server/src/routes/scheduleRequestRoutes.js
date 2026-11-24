import { eligibleAccountFilter, eligibleProviderFilter } from "../services/accountEligibility.js";
import { Router } from "express";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { supportingDocumentUpload } from "../middleware/supportingDocumentUpload.js";
import { transitionAppointment, createAppointmentRequest } from "../services/appointmentTransitionService.js";
import { uploadAppointmentDocuments } from "../services/appointmentDocumentService.js";
import { parseAvailableTimeSlots, scheduleFitsAvailableTimeSlot, validateAvailableTimeSlots } from "../services/availableTimeSlotService.js";

const router = Router();
router.use(authenticate);
const pending = "Pending";
const years = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];
const validId = (id) => mongoose.isValidObjectId(id);
const invalid = (res, message, code) => res.status(400).json({ message, code });
const validMeetingLink = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};
const requestedDateIsValid = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(instant.getTime())) return false;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
};
const manilaDate = (now = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(now);
const manilaTime = (now = new Date()) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(now);
router.get("/mine", authorize("faculty", "dean"), async (req, res) => {
  const requests = await Appointment.find({
    faculty: req.user.id,
    bookingMethod: "schedule_request",
    status: pending,
  })
    .populate(
      "student",
      "name email studentId program yearLevel +profilePicture",
    )
    .sort({ createdAt: -1 })
    .lean();
  res.json({ requests });
});

router.post(
  "/",
  authorize("student"),
  supportingDocumentUpload,
  async (req, res) => {
    const facultyId = req.body.facultyId;
    const subject = String(req.body.subject || "").trim();
    const reason = String(req.body.reason || "").trim();
    const yearLevel = String(req.body.yearLevel || req.user.yearLevel || "").trim();
    const requestedConsultationDate = String(req.body.requestedConsultationDate || "").trim();
    const requestedConsultationTime = String(req.body.requestedConsultationTime || "").trim();
    const availableTimeSlots = parseAvailableTimeSlots(req.body.availableTimeSlots);
    const duration = Number(req.body.estimatedDurationMinutes);
    const hasPreferredSchedule = Boolean(req.body.startAt || req.body.endAt);
    const isDateOnlyRequest = Boolean(requestedConsultationDate) && !hasPreferredSchedule;
    const startAt = hasPreferredSchedule ? new Date(req.body.startAt) : undefined;
    const endAt = hasPreferredSchedule ? new Date(req.body.endAt) : undefined;
    const mode = String(req.body.mode || "").trim();
    const location = String(req.body.location || "").trim();
    const meetingPlatform = String(req.body.meetingPlatform || "").trim();
    const meetingLink = String(req.body.meetingLink || "").trim();
    if (
      !validId(facultyId) ||
      !(await User.exists({
        _id: facultyId,
        ...eligibleProviderFilter(),
      }))
    )
      return invalid(res, "Select an active Faculty Member.", "INVALID_FACULTY");
    if (!subject || subject.length > 150)
      return invalid(res, "Please enter a consultation subject of 150 characters or fewer.", "INVALID_SUBJECT");
    if (!reason || reason.length > 1000)
      return invalid(res, "Please enter a consultation reason of 1,000 characters or fewer.", "INVALID_REASON");
    if (yearLevel && !years.includes(yearLevel))
      return invalid(res, "Your Student profile contains an invalid year level. Please update your profile or contact the Dean.", "INVALID_YEAR_LEVEL");
    if (isDateOnlyRequest && !requestedDateIsValid(requestedConsultationDate))
      return invalid(res, "Please choose a valid preferred consultation date.", "INVALID_REQUESTED_DATE");
    if (isDateOnlyRequest && availableTimeSlots == null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(requestedConsultationTime))
      return invalid(res, "Please choose a valid preferred consultation time.", "INVALID_REQUESTED_TIME");
    if (isDateOnlyRequest && availableTimeSlots == null && new Date(`${requestedConsultationDate}T${requestedConsultationTime}:00+08:00`) <= new Date())
      return invalid(res, "Please choose a future preferred consultation date and time.", "PAST_REQUESTED_SCHEDULE");
    if (isDateOnlyRequest && availableTimeSlots != null) {
      const slotError = validateAvailableTimeSlots({ date: requestedConsultationDate, slots: availableTimeSlots });
      if (slotError) return invalid(res, slotError.message, slotError.code);
    }
    if (!isDateOnlyRequest && (!Number.isInteger(duration) || duration < 5 || duration > 240))
      return invalid(res, "Consultation duration must be between 5 and 240 minutes.", "INVALID_DURATION");
    if (hasPreferredSchedule && (!req.body.startAt || !req.body.endAt ||
      !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())))
      return invalid(res, "Please choose valid preferred start and end times.", "INVALID_SCHEDULE");
    if (hasPreferredSchedule && startAt <= new Date())
      return invalid(res, "Please choose a future consultation time.", "PAST_SCHEDULE");
    if (hasPreferredSchedule && endAt <= startAt)
      return invalid(res, "The preferred end time must be after the start time.", "INVALID_SCHEDULE_ORDER");
    const preferredMinutes = hasPreferredSchedule ? Math.floor((endAt - startAt) / 60000) : duration;
    if (hasPreferredSchedule && (preferredMinutes < 5 || preferredMinutes > 240))
      return invalid(res, "Consultation duration must be between 5 and 240 minutes.", "INVALID_DURATION");
    if ((hasPreferredSchedule || isDateOnlyRequest) && !["Online", "Face-to-Face"].includes(mode))
      return invalid(res, "Please choose a valid consultation mode.", "INVALID_MODE");
    if (hasPreferredSchedule && location.length > 150)
      return invalid(res, "Location must be 150 characters or fewer.", "INVALID_LOCATION");
    if (hasPreferredSchedule && meetingPlatform.length > 100)
      return invalid(res, "Meeting platform must be 100 characters or fewer.", "INVALID_MEETING_PLATFORM");
    if (hasPreferredSchedule && mode === "Online" && meetingLink &&
      (!validMeetingLink(meetingLink) || meetingLink.length > 500))
      return invalid(res, "Please enter a valid HTTP or HTTPS meeting link.", "INVALID_MEETING_LINK");
    if (
      await Appointment.exists({
        student: req.user.id,
        faculty: facultyId,
        bookingMethod: "schedule_request",
        status: pending,
      })
    )
      return res.status(409).json({
        message:
          "You already have a schedule request awaiting this Faculty Member.",
        code: "DUPLICATE_SCHEDULE_REQUEST",
      });
    if (hasPreferredSchedule && await Appointment.exists({
      status: { $in: ["Pending", "Reschedule Proposed", "Confirmed"] },
      startAt: { $lt: endAt }, endAt: { $gt: startAt },
      $or: [{ student: req.user.id }, { faculty: facultyId }],
    })) return res.status(409).json({ message: "This request conflicts with an existing consultation.", code: "SCHEDULE_CONFLICT" });
    const appointmentId = new mongoose.Types.ObjectId();
    const documents = await uploadAppointmentDocuments(req.files || [], appointmentId);
    let appointment;
    try {
      appointment = await createAppointmentRequest({ actor: req.user, data: {
        _id: appointmentId, student: req.user.id, faculty: facultyId,
        bookingMethod: "schedule_request", subject, reason, ...(yearLevel && { yearLevel }),
        supportingDocuments: documents.entries,
        ...(isDateOnlyRequest && { requestedConsultationDate, consultationMode: mode,
          ...(availableTimeSlots != null ? { availableTimeSlots } : { requestedConsultationTime }) }),
        ...(!hasPreferredSchedule && !isDateOnlyRequest && { estimatedDurationMinutes: duration }),
        ...(hasPreferredSchedule && {
          estimatedDurationMinutes: duration,
          startAt, endAt, consultationMode: mode,
          location: mode === "Face-to-Face" ? location : "",
          meetingPlatform: mode === "Online" ? meetingPlatform : "",
          meetingLink: mode === "Online" ? meetingLink : "",
          currentScheduleSource: "participant_proposed",
        }),
      } });
    } catch (error) { await documents.cleanup(); throw error; }
    res.status(201).json({ message: "Your alternative consultation schedule request has been sent to the Faculty.", appointment });

  },
);

router.put("/:id/cancel", authorize("student"), async (req, res) => {
  const appointment = await transitionAppointment({ id: req.params.id, actor: req.user,
    action: "cancel", reason: req.body.reason ?? "", bookingMethod: "schedule_request",
    expectedVersion: req.body.expectedVersion });
  res.json({ message: "Schedule request cancelled.", appointment });
});
router.put("/:id/reject", authorize("faculty", "dean"), async (req, res) => {
  const appointment = await transitionAppointment({ id: req.params.id, actor: req.user,
    action: "reject", reason: req.body.note ?? "", bookingMethod: "schedule_request",
    expectedVersion: req.body.expectedVersion });
  res.json({ message: "Schedule request rejected.", appointment });
});

router.put("/:id/approve", authorize("faculty", "dean"), async (req, res) => {
  if (!validId(req.params.id))
    return res.status(404).json({ message: "Request not found." });
  const startAt = new Date(req.body.startAt);
  const duration = Number(req.body.durationMinutes);
  const mode = req.body.mode;
  const location = String(req.body.location || "").trim();
  const meetingPlatform = String(req.body.meetingPlatform || "").trim();
  const meetingLink = String(req.body.meetingLink || "").trim();
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      String(req.body.startAt || ""),
    ) ||
    !Number.isFinite(startAt.getTime()) ||
    startAt <= new Date()
  )
    return res.status(400).json({
      message: "Choose a valid future date and time with a timezone.",
    });
  if (!Number.isInteger(duration) || duration < 5 || duration > 240)
    return res
      .status(400)
      .json({ message: "Duration must be between 5 and 240 minutes." });
  if (!["Face-to-Face", "Online"].includes(mode))
    return res.status(400).json({ message: "Choose a consultation mode." });
  if (mode === "Face-to-Face" && (!location || location.length > 150))
    return res
      .status(400)
      .json({ message: "Enter a location (up to 150 characters)." });
  if (
    mode === "Online" &&
    (!meetingPlatform ||
      meetingPlatform.length > 100 ||
      (meetingLink &&
        (!validMeetingLink(meetingLink) || meetingLink.length > 500)))
  )
    return res.status(400).json({
      message:
        "Enter a meeting platform and an optional valid HTTP or HTTPS meeting link.",
    });
  const endAt = new Date(startAt.getTime() + duration * 60000);
  const appointment = await Appointment.findOne({
    _id: req.params.id,
    faculty: req.user.id,
    bookingMethod: "schedule_request",
    status: pending,
  });
  if (!appointment)
    return res.status(409).json({
      message: "This request is no longer pending or does not belong to you.",
    });
  if (appointment.requestedConsultationDate && manilaDate(startAt) !== appointment.requestedConsultationDate)
    return res.status(400).json({
      message: "Use Reschedule Request to propose a different consultation date.",
      code: "REQUESTED_DATE_MISMATCH",
    });
  if (appointment.requestedConsultationTime && manilaTime(startAt) !== appointment.requestedConsultationTime)
    return res.status(400).json({
      message: "Use Reschedule Request to propose a different consultation time.",
      code: "REQUESTED_TIME_MISMATCH",
    });
  if (appointment.availableTimeSlots?.length && !scheduleFitsAvailableTimeSlot({
    date: appointment.requestedConsultationDate, slots: appointment.availableTimeSlots, startAt, endAt,
  })) return res.status(400).json({
    message: "Choose a consultation time that fits within one of the Student's available time slots, or use Reschedule Request.",
    code: "SCHEDULE_OUTSIDE_AVAILABLE_TIME",
  });
  const studentIsActive = await User.exists({
    _id: appointment.student,
    ...eligibleAccountFilter("student"),
  });
  if (!studentIsActive)
    return res
      .status(409)
      .json({ message: "The Student account is no longer active." });
  const approved = await transitionAppointment({ id: req.params.id, actor: req.user, action: "confirm",
    bookingMethod: "schedule_request", expectedVersion: req.body.expectedVersion,
    schedule: { startAt, endAt, mode, location, meetingPlatform, meetingLink } });
  return res.json({ message: "Schedule confirmed and sent to the Student.", appointment: approved });
});
export default router;
