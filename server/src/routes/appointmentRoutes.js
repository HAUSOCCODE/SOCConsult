import { canReadAppointmentDocument } from "../services/appointmentDocumentAuthorizationService.js";
import { BLOCKING_STATUSES } from "../config/appointmentStatus.js";
import { Router } from "express";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Availability from "../models/Availability.js";
import User from "../models/User.js";
import SupportingDocument from "../models/SupportingDocument.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { classifyStudentAppointments } from "../services/appointmentClassificationService.js";
import { monitoringAttendance } from "../services/attendancePrivacyService.js";
import { supportingDocumentUpload } from "../middleware/supportingDocumentUpload.js";
import { logActivity } from "../services/activityService.js";
import {
  transitionAppointment,
  createAppointmentRequest,
} from "../services/appointmentTransitionService.js";
import { uploadAppointmentDocuments } from "../services/appointmentDocumentService.js";
import { destroyAsset } from "../services/cloudinaryStorage.js";
import {
  consultationIcsFilename,
  generateConsultationIcs,
} from "../services/icsService.js";
import { listStudentConsultationHistory } from "../services/studentConsultationHistoryService.js";
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
const platformFor = (availability) =>
  availability?.meetingPlatform || "Meeting platform not provided";

router.get("/mine", authorize("student", "faculty", "dean"), async (req, res) => {
  const query =
    req.user.role === "student"
      ? { student: req.user.id }
      : { faculty: req.user.id };
  const appointments = await Appointment.find(query)
    .select("+meetingLink +attendance")
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
    appointment.attendanceSummary = monitoringAttendance(appointment);
    delete appointment.attendance;
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
        ["Confirmed", "Completed"].includes(appointment.status);
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
      // Retain the legacy response key without minute-based capacity behavior.
      availabilityCapacity: [],
    }),
  });
});

router.get("/student-history", authorize("student"), async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await listStudentConsultationHistory({
    student: req.user.id,
    input: req.query,
  }));
});

router.get(
  "/:appointmentId/calendar.ics",
  authorize("student"),
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.appointmentId))
      return res.status(400).json({ message: "Invalid appointment ID." });

    const appointment = await Appointment.findOne({
      _id: req.params.appointmentId,
      student: req.user.id,
      status: "Confirmed",
    })
      .select(
        "faculty startAt endAt subject consultationMode location meetingPlatform status",
      )
      .populate("faculty", "name")
      .lean();
    if (!appointment)
      return res.status(404).json({
        message: "Confirmed consultation not found or no longer available.",
      });

    let calendar;
    let filename;
    try {
      calendar = generateConsultationIcs(appointment);
      filename = consultationIcsFilename(appointment.startAt);
    } catch {
      return res.status(409).json({
        message: "This consultation does not have a valid calendar schedule.",
      });
    }
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(calendar);
  },
);
router.post(
  "/",
  authorize("student"),
  supportingDocumentUpload,
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.body.availabilityId))
      return res
        .status(400)
        .json({ message: "Select a valid consultation schedule." });
    const slot = await Availability.findOne({
      _id: req.body.availabilityId,
      isActive: true,
      reservationToken: { $exists: false },
      startAt: { $gt: new Date() },
    });
    const requestedStart = slot?.startAt;
    const requestedEnd = slot?.endAt;
    const windowMinutes = slot
      ? Math.round((slot.endAt - slot.startAt) / 60000)
      : 0;
    if (!slot || slot.endAt <= slot.startAt)
      return res.status(409).json({
        message: "This schedule is no longer available.",
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
      status: { $in: BLOCKING_STATUSES },
    });
    if (existingActiveRequest)
      return res.status(409).json({
        message:
          "You already have an active consultation request for this faculty schedule.",
      });
    const [studentConflict, facultyConflict] = await Promise.all([
      Appointment.exists({
        student: req.user.id,
        status: { $in: BLOCKING_STATUSES },
        startAt: { $lt: requestedEnd },
        endAt: { $gt: requestedStart },
      }),
      Appointment.exists({
        faculty: slot.faculty,
        status: { $in: BLOCKING_STATUSES },
        startAt: { $lt: requestedEnd },
        endAt: { $gt: requestedStart },
      }),
    ]);
    if (studentConflict || facultyConflict)
      return res.status(409).json({
        message:
          "This schedule conflicts with an active consultation and is no longer available.",
      });
    const subject =
      typeof req.body.subject === "string" ? req.body.subject.trim() : "";
    const reason =
      typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (!subject)
      return res.status(400).json({ message: "Subject or Course is required." });
    if (subject.length > 150)
      return res.status(400).json({
        message: "Subject or Course must be 150 characters or fewer.",
      });
    if (!reason)
      return res
        .status(400)
        .json({ message: "Consultation Concern is required." });
    if (reason.length > 1000)
      return res.status(400).json({
        message: "Consultation Concern must be 1,000 characters or fewer.",
      });
    const validYearLevels = new Set([
      "1st Year",
      "2nd Year",
      "3rd Year",
      "4th Year",
      "5th Year",
    ]);
    const yearLevel = validYearLevels.has(req.user.yearLevel)
      ? req.user.yearLevel
      : undefined;
    const appointmentId = new mongoose.Types.ObjectId();
    const documents = await uploadAppointmentDocuments(req.files || [], appointmentId);
    let appointment;
    try {
      appointment = await createAppointmentRequest({ actor: req.user, data: {
        _id: appointmentId, student: req.user.id, faculty: slot.faculty,
        availability: slot._id, bookingMethod: "published_slot",
        startAt: slot.startAt, endAt: slot.endAt, estimatedDurationMinutes: windowMinutes,
        subject, yearLevel, reason, consultationMode: slot.mode || "Online",
        meetingPlatform: slot.mode === "Online" ? platformFor(slot) : undefined,
        location: slot.mode === "Face-to-Face" ? slot.location : "",
        supportingDocuments: documents.entries,
      } });
    } catch (error) { await documents.cleanup(); throw error; }
    res.status(201).json({ message: "Consultation request submitted successfully.", appointment });

  },
);

export const appointmentDocumentRoutes = Router();
appointmentDocumentRoutes.use((req, res, next) => {
  if (!/^\/[^/]+\/(?:documents\/[^/]+|document)\/?$/.test(req.path)) return next();
  const parts = req.path.split("/");
  if (![parts[1], ...(parts[2] === "documents" ? [parts[3]] : [])].every(id => /^[a-f\d]{24}$/i.test(id)))
    return res.status(400).json({ message: "Invalid document reference." });
  res.set("Cache-Control", "no-store");
  next();
});
appointmentDocumentRoutes.get(
  "/:id/documents/:documentId",
  authorize("student", "faculty", "dean"),
  async (req, res) => {
    const appointment = await Appointment.findById(req.params.id).select(
      "student faculty supportingDocuments",
    );
    if (!appointment)
      return res.status(404).json({ message: "Appointment not found." });
    const allowed = canReadAppointmentDocument(appointment, req.user, req.deanManagementAccess);
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
    if (req.deanManagementAccess) return res.status(403).json({ message: "Dean management access is read-only." });
    const appointment = await Appointment.findById(req.params.id).select(
      "student faculty supportingDocuments",
    );
    if (!appointment)
      return res.status(404).json({ message: "Appointment not found." });
    const allowed = canReadAppointmentDocument(appointment, req.user, req.deanManagementAccess);
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
    const allowed = canReadAppointmentDocument(appointment, req.user, req.deanManagementAccess);
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
  const action = { Confirmed: "confirm", Rejected: "reject", "Reschedule Proposed": "propose", Cancelled: "cancel" }[req.body.status];
  if (!action) return res.status(400).json({ message: "Invalid appointment status. Direct completion is not permitted." });
  const appointment = await transitionAppointment({ id: req.params.id, actor: req.user, action,
    reason: req.body.reason ?? req.body.note ?? "", availabilityId: req.body.availabilityId,
    expectedVersion: req.body.expectedVersion });
  res.json({ message: "Appointment status updated.", appointment });
});
router.put("/:id/cancel", authorize("student"), async (req, res) => {
  const appointment = await transitionAppointment({ id: req.params.id, actor: req.user, action: "cancel",
    reason: req.body.reason ?? "", expectedVersion: req.body.expectedVersion });
  res.json({ message: "Consultation cancelled.", appointment });
});
router.put("/:id/reschedule-response", authorize("student"), async (req, res) => {
  const decision = req.body.decision;
  if (!["accept", "reject"].includes(decision)) return res.status(400).json({ message: "Select a valid proposal response." });
  const appointment = await transitionAppointment({ id: req.params.id, actor: req.user,
    action: decision === "accept" ? "accept_proposal" : "reject_proposal",
    expectedProposalAt: req.body.proposedAt, expectedVersion: req.body.expectedVersion });
  res.json({ message: decision === "accept" ? "Reschedule proposal accepted. Your consultation is confirmed."
    : "Reschedule proposal rejected. The consultation is pending Faculty action.", appointment });
});
export default router;
