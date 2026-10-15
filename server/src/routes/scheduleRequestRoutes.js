import { Router } from "express";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { supportingDocumentUpload } from "../middleware/supportingDocumentUpload.js";
import { transitionAppointment, createAppointmentRequest } from "../services/appointmentTransitionService.js";
import { uploadAppointmentDocuments } from "../services/appointmentDocumentService.js";

const router = Router();
router.use(authenticate);
const pending = "Pending";
const years = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];
const validId = (id) => mongoose.isValidObjectId(id);
const validMeetingLink = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};
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
    const yearLevel = String(req.body.yearLevel || "").trim();
    const duration = Number(req.body.estimatedDurationMinutes);
    if (
      !validId(facultyId) ||
      !(await User.exists({
        _id: facultyId,
        role: { $in: ["faculty", "dean"] },
        registrationStatus: "Approved",
        accountStatus: "Active",
      }))
    )
      return res
        .status(400)
        .json({ message: "Select an active Faculty Member." });
    if (
      !subject ||
      subject.length > 150 ||
      !reason ||
      reason.length > 1000 ||
      !years.includes(yearLevel) ||
      !Number.isInteger(duration) ||
      duration < 5 ||
      duration > 240
    )
      return res.status(400).json({
        message:
          "Enter a topic, reason, year level, and estimated duration between 5 and 240 minutes.",
      });
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
      });
    const appointmentId = new mongoose.Types.ObjectId();
    const documents = await uploadAppointmentDocuments(req.files || [], appointmentId);
    let appointment;
    try {
      appointment = await createAppointmentRequest({ actor: req.user, data: {
        _id: appointmentId, student: req.user.id, faculty: facultyId,
        bookingMethod: "schedule_request", subject, reason, yearLevel,
        estimatedDurationMinutes: duration, supportingDocuments: documents.entries,
      } });
    } catch (error) { await documents.cleanup(); throw error; }
    res.status(201).json({ message: "Schedule request sent. Awaiting Faculty Member's decision.", appointment });

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
  const studentIsActive = await User.exists({
    _id: appointment.student,
    role: "student",
    registrationStatus: "Approved",
    accountStatus: "Active",
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
