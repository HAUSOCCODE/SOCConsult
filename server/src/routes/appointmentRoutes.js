import { Router } from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import path from "node:path";
import Appointment from "../models/Appointment.js";
import Availability from "../models/Availability.js";
import User from "../models/User.js";
import SupportingDocument from "../models/SupportingDocument.js";
import OneTimeScheduleHold from "../models/OneTimeScheduleHold.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { classifyStudentAppointments } from "../services/appointmentClassificationService.js";
import { supportingDocumentUpload } from "../middleware/supportingDocumentUpload.js";
import { logActivity, notify } from "../services/activityService.js";
import { processExpiredAvailability } from "../services/availabilityExpirationService.js";
import { destroyAsset, uploadBuffer } from "../services/cloudinaryStorage.js";
const router = Router();
router.use(authenticate);

const documentSize = (data = "") => {
  const encoded = data.split(",")[1] || "";
  return Buffer.from(encoded, "base64").length;
};

const looksLikeUrl = (value = "") => /^https?:\/\//i.test(value);
const normalizeProfilePicture = (person) => {
  if (!person || typeof person !== "object") return;
  if (person.profilePicture && typeof person.profilePicture !== "string")
    person.profilePicture = person.profilePicture.url;
};
const publicDocumentMetadata = (document) => ({
  _id: document._id,
  originalName: document.originalName,
  mimeType: document.mimeType,
  size: document.size,
  uploadedAt: document.uploadedAt || document.createdAt,
});
const hydrateLegacyDocuments = async (appointments) => {
  const legacyIds = appointments.flatMap((appointment) =>
    (appointment.supportingDocuments || []).filter(
      (entry) => mongoose.isValidObjectId(entry) && !entry?.originalName,
    ),
  );
  if (!legacyIds.length) return appointments;
  const legacy = await SupportingDocument.find({ _id: { $in: legacyIds } })
    .select("originalName mimeType size createdAt")
    .lean();
  const byId = new Map(
    legacy.map((document) => [String(document._id), document]),
  );
  appointments.forEach((appointment) => {
    appointment.supportingDocuments = (appointment.supportingDocuments || [])
      .map((entry) =>
        typeof entry === "object" && entry.originalName
          ? publicDocumentMetadata(entry)
          : byId.get(String(entry)),
      )
      .filter(Boolean);
  });
  return appointments;
};
const safeOriginalName = (value = "") =>
  path.basename(value.replaceAll("\\", "/")).slice(0, 255) || "document";
const cloudinaryResourceType = (mimeType = "") =>
  mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("video/")
      ? "video"
      : "raw";
const platformFor = (availability) =>
  availability?.meetingPlatform || "Meeting platform not provided";
const conflictsWithOneTimeSchedule = (appointment, startAt, endAt) =>
  OneTimeScheduleHold.exists({
    appointment: { $ne: appointment._id },
    minute: {
      $gte: Math.floor(new Date(startAt).getTime() / 60000),
      $lt: Math.ceil(new Date(endAt).getTime() / 60000),
    },
    $or: [{ faculty: appointment.faculty }, { student: appointment.student }],
  });

const capacitySummary = async (facultyId) => {
  const appointments = await Appointment.find({
    faculty: facultyId,
    status: { $in: ["Pending", "Approved", "Rescheduled"] },
  }).select("availability status estimatedDurationMinutes");
  const availabilityIds = [
    ...new Set(
      appointments
        .filter((item) => item.availability)
        .map((item) => String(item.availability)),
    ),
  ];
  const schedules = await Availability.find({
    _id: { $in: availabilityIds },
  }).select("startAt endAt");
  return schedules.map((schedule) => {
    const related = appointments.filter(
      (item) => String(item.availability) === schedule.id,
    );
    const pending = related.filter((item) => item.status === "Pending");
    const approved = related.filter((item) =>
      ["Approved", "Rescheduled"].includes(item.status),
    );
    const sum = (items) =>
      items.reduce(
        (total, item) => total + (item.estimatedDurationMinutes || 0),
        0,
      );
    return {
      availabilityId: schedule.id,
      startAt: schedule.startAt,
      endAt: schedule.endAt,
      capacityMinutes: Math.round((schedule.endAt - schedule.startAt) / 60000),
      pendingCount: pending.length,
      pendingEstimatedMinutes: sum(pending),
      approvedEstimatedMinutes: sum(approved),
      totalEstimatedMinutes: sum(related),
    };
  });
};

router.get("/mine", authorize("student", "faculty", "dean"), async (req, res) => {
  const query =
    req.user.role === "student"
      ? { student: req.user.id }
      : { faculty: req.user.id };
  const appointments = await Appointment.find(query)
    .select("+meetingLink")
    .populate(
      "student",
      "name email studentId program yearLevel +profilePicture",
    )
    .populate(
      "faculty",
      "name email position specialization office +profilePicture",
    )
    .populate(
      "availability",
      "startAt endAt mode location meetingPlatform +meetingLink",
    )
    .sort({ createdAt: -1 })
    .lean();
  await hydrateLegacyDocuments(appointments);
  const safeAppointments = appointments.map((appointment) => {
    normalizeProfilePicture(appointment.student);
    normalizeProfilePicture(appointment.faculty);
    const availability = appointment.availability;
    if (
      appointment.consultationMode === "Online" ||
      availability?.mode === "Online"
    ) {
      appointment.meetingPlatform =
        appointment.meetingPlatform || platformFor(availability);
      const canAccessLink =
        ["faculty", "dean"].includes(req.user.role) ||
        ["Approved", "Rescheduled", "Completed"].includes(appointment.status);
      if (
        canAccessLink &&
        availability?.meetingLink &&
        !appointment.meetingLink
      )
        appointment.meetingLink = availability.meetingLink;
      if (!canAccessLink) delete appointment.meetingLink;
      if (availability) delete availability.meetingLink;
      if (looksLikeUrl(appointment.location)) appointment.location = "";
    }
    return appointment;
  });
  const studentViews =
    req.user.role === "student"
      ? classifyStudentAppointments(safeAppointments, new Date())
      : null;
  res.json({
    appointments: safeAppointments,
    ...(studentViews && { studentViews }),
    ...(["faculty", "dean"].includes(req.user.role) && {
      availabilityCapacity: await capacitySummary(req.user.id),
    }),
  });
});
router.post(
  "/",
  authorize("student"),
  supportingDocumentUpload,
  async (req, res) => {
    const slot = await Availability.findOne({
      _id: req.body.availabilityId,
      isActive: true,
      startAt: { $gt: new Date() },
    });
    const requestedStart = slot?.startAt;
    const requestedEnd = slot?.endAt;
    const estimatedDurationMinutes = Number(req.body.estimatedDurationMinutes);
    const windowMinutes = slot
      ? Math.round((slot.endAt - slot.startAt) / 60000)
      : 0;
    if (!slot || slot.endAt <= new Date())
      return res.status(400).json({
        message: "This faculty availability is unavailable or in the past.",
      });
    if (
      !Number.isInteger(estimatedDurationMinutes) ||
      estimatedDurationMinutes < 5 ||
      estimatedDurationMinutes > windowMinutes
    )
      return res.status(400).json({
        message: `Estimated consultation time must be between 5 and ${windowMinutes} minutes.`,
      });
    const facultyIsAvailable = await User.exists({
      _id: slot.faculty,
      role: { $in: ["faculty", "dean"] },
      accountStatus: "Active",
      $or: [
        { registrationStatus: "Approved" },
        { role: "dean" },
      ],
    });
    if (!facultyIsAvailable)
      return res.status(400).json({
        message: "This faculty member is not currently available for booking.",
      });
    const existingActiveRequest = await Appointment.exists({
      student: req.user.id,
      availability: slot.id,
      status: { $in: ["Pending", "Approved", "Rescheduled"] },
    });
    if (existingActiveRequest)
      return res.status(409).json({
        message:
          "You already have an active consultation request for this faculty schedule.",
      });
    const [studentConflict, facultyConflict] = await Promise.all([
      Appointment.exists({
        student: req.user.id,
        status: { $in: ["Pending", "Approved", "Rescheduled"] },
        startAt: { $lt: requestedEnd },
        endAt: { $gt: requestedStart },
      }),
      Appointment.exists({
        faculty: slot.faculty,
        status: { $in: ["Approved", "Rescheduled"] },
        startAt: { $lt: requestedEnd },
        endAt: { $gt: requestedStart },
      }),
    ]);
    if (studentConflict || facultyConflict)
      return res.status(409).json({
        message:
          "This schedule conflicts with an active consultation and is no longer available.",
      });
    const subject = (req.body.subject || "").trim();
    const reason = (req.body.reason || "").trim();
    const yearLevel = (req.body.yearLevel || "").trim();
    if (!subject || !reason)
      return res
        .status(400)
        .json({ message: "Subject and reason are required." });
    if (
      !["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"].includes(
        yearLevel,
      )
    )
      return res
        .status(400)
        .json({ message: "Please select your year level." });
    const appointment = await Appointment.create({
      student: req.user.id,
      faculty: slot.faculty,
      availability: slot.id,
      startAt: requestedStart,
      endAt: requestedEnd,
      estimatedDurationMinutes,
      subject,
      yearLevel,
      reason,
      consultationMode: slot.mode || "Online",
      location: slot.mode === "Online" ? platformFor(slot) : slot.location,
    });
    const uploadedAssets = [];
    try {
      if (req.files?.length) {
        for (const file of req.files) {
          const resourceType = cloudinaryResourceType(file.mimetype);
          const originalName = safeOriginalName(file.originalname);
          const extension = path.extname(originalName).toLowerCase();
          const uploaded = await uploadBuffer(file.buffer, {
            folder: `consultio/consultation-documents/${appointment.id}`,
            resource_type: resourceType,
            public_id: `${crypto.randomUUID()}${resourceType === "raw" ? extension : ""}`,
          });
          uploadedAssets.push({
            file,
            originalName,
            url: uploaded.secure_url,
            publicId: uploaded.public_id,
            resourceType: uploaded.resource_type,
          });
        }
        appointment.supportingDocuments = uploadedAssets.map(
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
    } catch (documentError) {
      await Promise.all([
        ...uploadedAssets.map((asset) => destroyAsset(asset).catch(() => {})),
        Appointment.deleteOne({ _id: appointment.id }),
      ]);
      throw documentError;
    }
    await Promise.all([
      logActivity(
        "appointment_created",
        req.user.id,
        "Appointment",
        appointment.id,
      ),
      logActivity(
        "published_schedule_selected",
        req.user.id,
        "Appointment",
        appointment.id,
        { mode: appointment.consultationMode },
      ),
      ...(uploadedAssets.length
        ? [
            logActivity(
              "supporting_document_uploaded",
              req.user.id,
              "Appointment",
              appointment.id,
              { documentCount: uploadedAssets.length },
            ),
          ]
        : []),
      notify(
        slot.faculty,
        "appointment",
        "New Consultation Request",
        `${req.user.name} submitted a consultation request.`,
        appointment.id,
      ),
      notify(
        req.user.id,
        "appointment",
        "Consultation Request Submitted",
        "Your consultation request was submitted and is awaiting the faculty member's decision.",
        appointment.id,
      ),
    ]);
    res.status(201).json({
      message: "Consultation request submitted successfully.",
      appointment,
    });
  },
);

export const appointmentDocumentRoutes = Router();
appointmentDocumentRoutes.get(
  "/:id/documents/:documentId",
  authorize("student", "faculty", "dean"),
  async (req, res) => {
    const appointment = await Appointment.findById(req.params.id).select(
      "student faculty supportingDocuments",
    );
    if (!appointment)
      return res.status(404).json({ message: "Appointment not found." });
    const allowed =
      req.deanManagementAccess === true ||
      String(appointment.student) === req.user.id ||
      String(appointment.faculty) === req.user.id;
    if (!allowed)
      return res
        .status(403)
        .json({ message: "Unauthorized for this document." });
    const entry = appointment.supportingDocuments.find(
      (document) => String(document?._id || document) === req.params.documentId,
    );
    if (!entry)
      return res
        .status(404)
        .json({ message: "Supporting document not found." });
    const embedded = entry && typeof entry === "object" && entry.cloudinaryUrl;
    const document = embedded
      ? entry
      : await SupportingDocument.findOne({
          _id: req.params.documentId,
          appointment: appointment.id,
        }).select("+data +publicId +resourceType");
    if (!document)
      return res
        .status(404)
        .json({ message: "Supporting document not found." });
    const url = document.cloudinaryUrl || document.url;
    if (!url && !document.data)
      return res
        .status(404)
        .json({ message: "Supporting document file is unavailable." });
    if (url) {
      try {
        const check = await fetch(url, { method: "HEAD" });
        if (check.status === 404) {
          if (embedded) {
            appointment.supportingDocuments =
              appointment.supportingDocuments.filter(
                (item) => String(item?._id || item) !== req.params.documentId,
              );
            await appointment.save();
          }
          return res
            .status(404)
            .json({ message: "Document is no longer available." });
        }
      } catch {
        // A transient Cloudinary/network failure must not remove valid metadata.
      }
    }
    res.json({
      supportingDocument: {
        _id: document.id,
        name: document.originalName,
        mimeType: document.mimeType,
        size: document.size,
        data: url
          ? url
          : `data:${document.mimeType};base64,${document.data.toString("base64")}`,
      },
    });
  },
);
appointmentDocumentRoutes.delete(
  "/:id/documents/:documentId",
  authorize("student", "faculty", "dean"),
  async (req, res) => {
    const appointment = await Appointment.findById(req.params.id).select(
      "student faculty supportingDocuments",
    );
    if (!appointment)
      return res.status(404).json({ message: "Appointment not found." });
    const allowed =
      req.deanManagementAccess === true ||
      String(appointment.student) === req.user.id ||
      String(appointment.faculty) === req.user.id;
    if (!allowed)
      return res
        .status(403)
        .json({ message: "Unauthorized for this document." });
    const entry = appointment.supportingDocuments.find(
      (document) => String(document?._id || document) === req.params.documentId,
    );
    if (!entry)
      return res
        .status(404)
        .json({ message: "Supporting document not found." });
    if (entry?.cloudinaryPublicId) {
      await destroyAsset({
        publicId: entry.cloudinaryPublicId,
        resourceType: entry.resourceType,
      }).catch(() => {});
    } else {
      const legacy = await SupportingDocument.findById(
        req.params.documentId,
      ).select("+publicId +resourceType");
      if (legacy?.publicId)
        await destroyAsset({
          publicId: legacy.publicId,
          resourceType: legacy.resourceType,
        }).catch(() => {});
      await SupportingDocument.deleteOne({
        _id: req.params.documentId,
        appointment: appointment.id,
      });
    }
    appointment.supportingDocuments = appointment.supportingDocuments.filter(
      (document) => String(document?._id || document) !== req.params.documentId,
    );
    await appointment.save();
    await logActivity(
      "supporting_document_removed",
      req.user.id,
      "Appointment",
      appointment.id,
      { documentCount: 1 },
    );
    res.json({ message: "Supporting document removed." });
  },
);
appointmentDocumentRoutes.get(
  "/:id/document",
  authorize("student", "faculty", "dean"),
  async (req, res) => {
    const appointment = await Appointment.findById(req.params.id).select(
      "+supportingDocument.data student faculty",
    );
    if (!appointment)
      return res.status(404).json({ message: "Appointment not found." });
    const allowed =
      req.deanManagementAccess === true ||
      String(appointment.student) === req.user.id ||
      String(appointment.faculty) === req.user.id;
    if (!allowed)
      return res
        .status(403)
        .json({ message: "Unauthorized for this document." });
    if (!appointment.supportingDocument?.data)
      return res
        .status(404)
        .json({ message: "No supporting document attached." });
    const supportingDocument = appointment.supportingDocument.toObject();
    supportingDocument.size ||= documentSize(supportingDocument.data);
    res.json({ supportingDocument });
  },
);
router.use(appointmentDocumentRoutes);
router.put("/:id/status", authorize("faculty", "dean"), async (req, res) => {
  await processExpiredAvailability({ facultyId: req.user.id });
  const status = req.body.status;
  if (
    !["Approved", "Rejected", "Completed", "No Show", "Rescheduled"].includes(
      status,
    )
  )
    return res.status(400).json({ message: "Invalid appointment status." });
  const appointment = await Appointment.findOne({
    _id: req.params.id,
    faculty: req.user.id,
  });
  if (!appointment)
    return res.status(404).json({ message: "Appointment not found." });
  if (
    appointment.bookingMethod === "schedule_request" &&
    appointment.status === "Awaiting Faculty Schedule"
  )
    return res.status(409).json({
      message:
        "Decide this request from Appointment Requests by assigning a one-time schedule or rejecting it.",
    });
  if (["Rejected", "Completed", "No Show"].includes(appointment.status))
    return res
      .status(409)
      .json({ message: "This appointment can no longer be updated." });
  const previousStatus = appointment.status;
  if (
    status === "Approved" &&
    !(await Availability.exists({
      _id: appointment.availability,
      faculty: req.user.id,
      isActive: true,
      endAt: { $gt: new Date() },
    }))
  )
    return res.status(409).json({
      message:
        "This consultation schedule has expired or is no longer active. The Student must choose a new schedule.",
    });
  if (status === "Rescheduled") {
    const slot = await Availability.findOne({
      _id: req.body.availabilityId,
      faculty: req.user.id,
      isActive: true,
      endAt: { $gt: new Date() },
    });
    if (!slot)
      return res
        .status(400)
        .json({ message: "Select a valid future availability schedule." });
    const proposedStart = slot.startAt;
    const proposedEnd = slot.endAt;
    const windowMinutes = Math.round((proposedEnd - proposedStart) / 60000);
    if ((appointment.estimatedDurationMinutes || 0) > windowMinutes)
      return res.status(400).json({
        message:
          "The availability window is shorter than the estimated consultation time.",
      });
    appointment.availability = slot.id;
    appointment.startAt = proposedStart;
    appointment.endAt = proposedEnd;
    appointment.consultationMode = slot.mode || "Online";
    appointment.location = slot.location;
  }
  if (
    ["Approved", "Rescheduled"].includes(status) &&
    (await conflictsWithOneTimeSchedule(
      appointment,
      appointment.startAt,
      appointment.endAt,
    ))
  )
    return res.status(409).json({
      message:
        "The Faculty Member or Student has a one-time consultation during this schedule.",
    });
  appointment.status = status;
  appointment.responseNote = (req.body.note || "").trim();
  if (status === "Rescheduled") {
    appointment.rescheduleRequested = false;
    appointment.rescheduleRequestNote = "";
  }
  await appointment.save();
  if (
    status === "Rescheduled" &&
    appointment.bookingMethod === "schedule_request"
  )
    await OneTimeScheduleHold.deleteMany({ appointment: appointment.id });
  const verb = status.toLowerCase();
  const notificationTitles = {
    Approved: "Consultation Approved",
    Rejected: "Consultation Request Rejected",
    Rescheduled: "Consultation Rescheduled",
    Completed: "Consultation Completed",
    "No Show": "Consultation Marked No Show",
  };
  await Promise.all([
    logActivity(
      `appointment_${verb}`,
      req.user.id,
      "Appointment",
      appointment.id,
      { previousStatus, newStatus: status, mode: appointment.consultationMode },
    ),
    notify(
      appointment.student,
      "appointment",
      notificationTitles[status],
      `Your consultation request is now ${status}.`,
      appointment.id,
    ),
  ]);
  res.json({ message: `Appointment ${verb}.`, appointment });
});
router.put("/:id/cancel", authorize("student"), async (req, res) => {
  const appointment = await Appointment.findOneAndUpdate(
    {
      _id: req.params.id,
      student: req.user.id,
      status: "Pending",
      startAt: { $gt: new Date() },
    },
    { status: "Cancelled" },
    { new: true },
  );
  if (!appointment)
    return res
      .status(409)
      .json({ message: "This appointment cannot be cancelled." });
  await Promise.all([
    logActivity(
      "appointment_cancelled",
      req.user.id,
      "Appointment",
      appointment.id,
    ),
    notify(
      appointment.faculty,
      "appointment",
      "Consultation Cancelled",
      `${req.user.name} cancelled a consultation.`,
      appointment.id,
    ),
    notify(
      req.user.id,
      "appointment",
      "Consultation Cancelled",
      "Your consultation was cancelled.",
      appointment.id,
    ),
  ]);
  res.json({ message: "Appointment cancelled.", appointment });
});
router.put(
  "/:id/request-reschedule",
  authorize("student"),
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ message: "Invalid appointment ID." });
    const reason = (req.body.reason ?? req.body.note ?? "").trim();
    if (reason.length < 5)
      return res.status(400).json({
        message:
          "Please provide a meaningful reschedule reason of at least 5 characters.",
      });
    if (reason.length > 500)
      return res.status(400).json({
        message: "Reschedule reason cannot exceed 500 characters.",
      });
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      student: req.user.id,
    });
    if (!appointment)
      return res.status(404).json({ message: "Appointment not found." });
    if (
      appointment.rescheduleRequested ||
      appointment.rescheduleRequestStatus === "Pending"
    )
      return res.status(409).json({
        message: "A reschedule request is already awaiting Faculty review.",
      });
    if (
      !["Approved", "Rescheduled"].includes(appointment.status) ||
      appointment.startAt <= new Date()
    )
      return res.status(400).json({
        message: "This appointment is not eligible for rescheduling.",
      });
    appointment.rescheduleRequested = true;
    appointment.rescheduleRequestNote = reason;
    appointment.rescheduleRequestStatus = "Pending";
    appointment.rescheduleRequestedAt = new Date();
    appointment.rescheduleReviewedAt = undefined;
    appointment.rescheduleReviewedBy = undefined;
    appointment.rescheduleDecisionNote = "";
    await appointment.save();
    await Promise.all([
      logActivity(
        "appointment_reschedule_requested",
        req.user.id,
        "Appointment",
        appointment.id,
      ),
      notify(
        appointment.faculty,
        "appointment",
        "Reschedule Request",
        `${req.user.name} requested to reschedule an approved consultation.`,
        appointment.id,
      ),
    ]);
    res.json({
      message: "Reschedule request sent to the faculty member.",
      appointment,
    });
  },
);
router.put(
  "/:id/reschedule-request",
  authorize("faculty", "dean"),
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ message: "Invalid appointment ID." });
    const decision = req.body.decision;
    if (!["Approved", "Rejected"].includes(decision))
      return res
        .status(400)
        .json({ message: "Select a valid reschedule decision." });
    const decisionNote = (req.body.note || "").trim();
    if (decisionNote.length > 500)
      return res.status(400).json({
        message: "Decision note cannot exceed 500 characters.",
      });
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      faculty: req.user.id,
    });
    if (!appointment)
      return res.status(404).json({ message: "Appointment not found." });
    if (
      !appointment.rescheduleRequested ||
      appointment.rescheduleRequestStatus !== "Pending"
    )
      return res.status(409).json({
        message: "This appointment has no pending reschedule request.",
      });
    if (!["Approved", "Rescheduled"].includes(appointment.status))
      return res.status(400).json({
        message: "This appointment is no longer eligible for rescheduling.",
      });
    appointment.rescheduleRequested = false;
    appointment.rescheduleRequestStatus = decision;
    appointment.rescheduleReviewedAt = new Date();
    appointment.rescheduleReviewedBy = req.user.id;
    appointment.rescheduleDecisionNote = decisionNote;
    if (decision === "Approved") appointment.status = "Needs Reschedule";
    await appointment.save();
    if (
      decision === "Approved" &&
      appointment.bookingMethod === "schedule_request"
    )
      await OneTimeScheduleHold.deleteMany({ appointment: appointment.id });
    const approved = decision === "Approved";
    await Promise.all([
      logActivity(
        `appointment_reschedule_${decision.toLowerCase()}`,
        req.user.id,
        "Appointment",
        appointment.id,
      ),
      notify(
        appointment.student,
        "appointment",
        `Reschedule Request ${decision}`,
        approved
          ? "Your faculty member approved your reschedule request. Please select another available consultation schedule."
          : "Your consultation reschedule request was not approved. Your current consultation schedule remains unchanged.",
        appointment.id,
      ),
    ]);
    res.json({
      message: approved
        ? "Reschedule request approved. The Student can now choose a new schedule."
        : "Reschedule request rejected. The current schedule remains unchanged.",
      appointment,
    });
  },
);
router.put("/:id/reschedule", authorize("student"), async (req, res) => {
  if (
    !mongoose.isValidObjectId(req.params.id) ||
    !mongoose.isValidObjectId(req.body.availabilityId)
  )
    return res
      .status(400)
      .json({ message: "Invalid appointment or availability ID." });
  const appointment = await Appointment.findOne({
    _id: req.params.id,
    student: req.user.id,
    status: "Needs Reschedule",
  });
  if (!appointment)
    return res.status(409).json({
      message: "This appointment is not currently awaiting rescheduling.",
    });
  const slot = await Availability.findOne({
    _id: req.body.availabilityId,
    faculty: appointment.faculty,
    isActive: true,
    startAt: { $gt: new Date() },
    endAt: { $gt: new Date() },
  });
  if (!slot)
    return res.status(400).json({
      message:
        "Select a valid future availability schedule for this faculty member.",
    });
  const [studentConflict, facultyConflict] = await Promise.all([
    Appointment.exists({
      _id: { $ne: appointment.id },
      student: req.user.id,
      status: { $in: ["Pending", "Approved", "Rescheduled"] },
      startAt: { $lt: slot.endAt },
      endAt: { $gt: slot.startAt },
    }),
    Appointment.exists({
      _id: { $ne: appointment.id },
      faculty: appointment.faculty,
      status: { $in: ["Approved", "Rescheduled"] },
      startAt: { $lt: slot.endAt },
      endAt: { $gt: slot.startAt },
    }),
  ]);
  if (studentConflict || facultyConflict)
    return res.status(409).json({
      message:
        "This schedule conflicts with an active consultation and is no longer available.",
    });
  const windowMinutes = Math.round((slot.endAt - slot.startAt) / 60000);
  const scheduled = await Appointment.find({
    _id: { $ne: appointment.id },
    availability: slot.id,
    status: { $in: ["Approved", "Rescheduled"] },
  }).select("estimatedDurationMinutes");
  const occupiedMinutes = scheduled.reduce(
    (total, item) => total + (item.estimatedDurationMinutes || 0),
    0,
  );
  if (
    occupiedMinutes + (appointment.estimatedDurationMinutes || 0) >
    windowMinutes
  )
    return res.status(409).json({
      message: "This schedule no longer has enough time for your consultation.",
    });
  appointment.availability = slot.id;
  const previousStatus = appointment.status;
  appointment.startAt = slot.startAt;
  appointment.endAt = slot.endAt;
  appointment.consultationMode = slot.mode || "Online";
  appointment.location =
    slot.mode === "Online" ? platformFor(slot) : slot.location;
  appointment.status = "Rescheduled";
  appointment.responseNote = "";
  await appointment.save();
  await Promise.all([
    logActivity(
      "appointment_rescheduled",
      req.user.id,
      "Appointment",
      appointment.id,
      {
        previousStatus,
        newStatus: "Rescheduled",
        mode: appointment.consultationMode,
      },
    ),
    notify(
      appointment.faculty,
      "appointment",
      "Consultation Rescheduled",
      `${req.user.name} selected a new consultation schedule.`,
      appointment.id,
    ),
    notify(
      req.user.id,
      "appointment",
      "Consultation Rescheduled",
      "Your new consultation schedule has been saved.",
      appointment.id,
    ),
  ]);
  res.json({ message: "New consultation schedule selected.", appointment });
});
export default router;
