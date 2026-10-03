import { Router } from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import path from "node:path";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import OneTimeScheduleHold from "../models/OneTimeScheduleHold.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { supportingDocumentUpload } from "../middleware/supportingDocumentUpload.js";
import { uploadBuffer, destroyAsset } from "../services/cloudinaryStorage.js";
import { logActivity, notify } from "../services/activityService.js";

const router = Router();
router.use(authenticate);
const pending = "Awaiting Faculty Schedule";
const years = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];
const active = ["Approved", "Rescheduled"];
const validId = (id) => mongoose.isValidObjectId(id);
const validMeetingLink = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};
const publicRequest = (appointment) => ({
  ...appointment.toObject(),
  meetingLink: undefined,
});
const recoverStaleClaims = async (facultyId) => {
  const stale = await Appointment.find({
    faculty: facultyId,
    bookingMethod: "schedule_request",
    status: pending,
    decisionLock: true,
    decisionLockAt: { $lt: new Date(Date.now() - 5 * 60000) },
  })
    .select("_id")
    .lean();
  for (const request of stale) {
    await OneTimeScheduleHold.deleteMany({ appointment: request._id });
    await Appointment.updateOne(
      { _id: request._id, status: pending, decisionLock: true },
      { $set: { decisionLock: false }, $unset: { decisionLockAt: 1 } },
    );
  }
};

router.get("/mine", authorize("faculty"), async (req, res) => {
  await recoverStaleClaims(req.user.id);
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
        role: "faculty",
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
    let appointment;
    try {
      await Appointment.init();
      appointment = await Appointment.create({
        student: req.user.id,
        faculty: facultyId,
        bookingMethod: "schedule_request",
        status: pending,
        subject,
        reason,
        yearLevel,
        estimatedDurationMinutes: duration,
      });
    } catch (error) {
      if (error.code === 11000)
        return res.status(409).json({
          message:
            "You already have a schedule request awaiting this Faculty Member.",
        });
      throw error;
    }
    const assets = [];
    try {
      for (const file of req.files || []) {
        const resourceType = file.mimetype.startsWith("image/")
          ? "image"
          : file.mimetype.startsWith("video/")
            ? "video"
            : "raw";
        const originalName =
          path
            .basename(file.originalname.replaceAll("\\", "/"))
            .slice(0, 255) || "document";
        const uploaded = await uploadBuffer(file.buffer, {
          folder: `consultio/consultation-documents/${appointment.id}`,
          resource_type: resourceType,
          public_id: `${crypto.randomUUID()}${resourceType === "raw" ? path.extname(originalName).toLowerCase() : ""}`,
        });
        assets.push({
          file,
          originalName,
          url: uploaded.secure_url,
          publicId: uploaded.public_id,
          resourceType,
        });
      }
      if (assets.length) {
        appointment.supportingDocuments = assets.map(
          ({ file, originalName, url, publicId, resourceType }) => ({
            _id: new mongoose.Types.ObjectId(),
            originalName,
            cloudinaryUrl: url,
            cloudinaryPublicId: publicId,
            resourceType,
            mimeType: file.mimetype,
            size: file.size,
            uploadedAt: new Date(),
          }),
        );
        await appointment.save();
      }
    } catch (error) {
      await Promise.all(
        assets.map((asset) => destroyAsset(asset).catch(() => {})),
      );
      await Appointment.deleteOne({ _id: appointment.id });
      throw error;
    }
    await Promise.all([
      logActivity(
        "schedule_requested",
        req.user.id,
        "Appointment",
        appointment.id,
      ),
      ...(assets.length
        ? [
            logActivity(
              "supporting_document_uploaded",
              req.user.id,
              "Appointment",
              appointment.id,
              { documentCount: assets.length },
            ),
          ]
        : []),
      notify(
        facultyId,
        "appointment",
        "Student Requested a Schedule",
        `${req.user.name} requested a consultation schedule. Review it in Appointment Requests.`,
        appointment.id,
      ),
      notify(
        req.user.id,
        "appointment",
        "Schedule Request Submitted",
        "Your request is awaiting the Faculty Member's schedule decision.",
        appointment.id,
      ),
    ]);
    res.status(201).json({
      message: "Schedule request sent. Awaiting Faculty Member's decision.",
      appointment: publicRequest(appointment),
    });
  },
);

router.put("/:id/cancel", authorize("student"), async (req, res) => {
  if (!validId(req.params.id))
    return res.status(404).json({ message: "Request not found." });
  const appointment = await Appointment.findOneAndUpdate(
    {
      _id: req.params.id,
      student: req.user.id,
      bookingMethod: "schedule_request",
      status: pending,
      decisionLock: { $ne: true },
    },
    { $set: { status: "Cancelled" } },
    { new: true },
  );
  if (!appointment)
    return res
      .status(409)
      .json({ message: "This pending request cannot be cancelled." });
  await Promise.all([
    logActivity(
      "schedule_request_cancelled",
      req.user.id,
      "Appointment",
      appointment.id,
    ),
    notify(
      appointment.faculty,
      "appointment",
      "Schedule Request Cancelled",
      `${req.user.name} cancelled a schedule request.`,
      appointment.id,
    ),
  ]);
  res.json({ message: "Schedule request cancelled.", appointment });
});

router.put("/:id/reject", authorize("faculty"), async (req, res) => {
  if (!validId(req.params.id))
    return res.status(404).json({ message: "Request not found." });
  const note = String(req.body.note || "").trim();
  if (note.length > 500)
    return res.status(400).json({ message: "Reason is too long." });
  const appointment = await Appointment.findOneAndUpdate(
    {
      _id: req.params.id,
      faculty: req.user.id,
      bookingMethod: "schedule_request",
      status: pending,
      decisionLock: { $ne: true },
    },
    { $set: { status: "Rejected", responseNote: note } },
    { new: true },
  );
  if (!appointment)
    return res.status(409).json({
      message: "This request is no longer pending or does not belong to you.",
    });
  await Promise.all([
    logActivity(
      "schedule_request_rejected",
      req.user.id,
      "Appointment",
      appointment.id,
    ),
    notify(
      appointment.student,
      "appointment",
      "Schedule Request Rejected",
      "Your Faculty Member rejected your schedule request. View the request for details.",
      appointment.id,
    ),
  ]);
  res.json({ message: "Schedule request rejected.", appointment });
});

router.put("/:id/approve", authorize("faculty"), async (req, res) => {
  await recoverStaleClaims(req.user.id);
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
  const overlap = {
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
    status: { $in: active },
  };
  if (
    await Appointment.exists({
      ...overlap,
      $or: [{ faculty: req.user.id }, { student: appointment.student }],
    })
  )
    return res.status(409).json({
      message:
        "The Faculty Member or Student already has a consultation during this time.",
    });
  // Claim the pending record atomically. The booking stays a single appointment.
  const claimed = await Appointment.findOneAndUpdate(
    {
      _id: appointment.id,
      faculty: req.user.id,
      status: pending,
      decisionLock: { $ne: true },
    },
    { $set: { decisionLock: true, decisionLockAt: new Date() } },
    { new: true },
  );
  if (!claimed)
    return res
      .status(409)
      .json({ message: "This request is already being decided." });
  const first = Math.floor(startAt.getTime() / 60000);
  const last = Math.ceil(endAt.getTime() / 60000);
  try {
    await OneTimeScheduleHold.init();
    await OneTimeScheduleHold.insertMany(
      Array.from({ length: last - first }, (_, index) => ({
        appointment: appointment.id,
        faculty: req.user.id,
        student: appointment.student,
        minute: first + index,
        expiresAt: endAt,
      })),
      { ordered: true },
    );
    if (
      await Appointment.exists({
        ...overlap,
        $or: [{ faculty: req.user.id }, { student: appointment.student }],
      })
    )
      throw Object.assign(new Error("Schedule conflict"), {
        code: "SCHEDULE_CONFLICT",
      });
    const approved = await Appointment.findOneAndUpdate(
      {
        _id: appointment.id,
        faculty: req.user.id,
        status: pending,
        decisionLock: true,
      },
      {
        $set: {
          status: "Approved",
          startAt,
          endAt,
          estimatedDurationMinutes: duration,
          consultationMode: mode,
          location: mode === "Face-to-Face" ? location : "",
          meetingPlatform: mode === "Online" ? meetingPlatform : "",
          meetingLink: mode === "Online" ? meetingLink : "",
          decisionLock: false,
        },
        $unset: { decisionLockAt: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!approved)
      throw Object.assign(new Error("Request changed"), {
        code: "REQUEST_CHANGED",
      });
    await Promise.allSettled([
      logActivity(
        "schedule_request_approved",
        req.user.id,
        "Appointment",
        appointment.id,
        { previousStatus: pending, newStatus: "Approved", mode },
      ),
      logActivity(
        mode === "Online"
          ? "online_meeting_details_updated"
          : "consultation_location_updated",
        req.user.id,
        "Appointment",
        appointment.id,
        { mode },
      ),
      notify(
        appointment.student,
        "appointment",
        "Consultation Schedule Approved",
        "Your Faculty Member approved your request and assigned a consultation schedule. View My Appointments for the date, time, and meeting details.",
        appointment.id,
      ),
    ]);
    return res.json({
      message: "Schedule approved and sent to the Student.",
      appointment: publicRequest(approved),
    });
  } catch (error) {
    await OneTimeScheduleHold.deleteMany({ appointment: appointment.id });
    await Appointment.updateOne(
      { _id: appointment.id, status: pending },
      { $set: { decisionLock: false }, $unset: { decisionLockAt: 1 } },
    );
    if (error.code === 11000 || error.code === "SCHEDULE_CONFLICT")
      return res.status(409).json({
        message:
          "The Faculty Member or Student already has a one-time consultation during this time.",
      });
    if (error.code === "REQUEST_CHANGED")
      return res
        .status(409)
        .json({ message: "This request has already been decided." });
    throw error;
  }
});

export default router;
