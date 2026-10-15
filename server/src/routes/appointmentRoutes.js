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
const manilaScheduleSnapshot = ({ startAt, endAt, mode, location, meetingPlatform }) => {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const parts = (value) => {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const values = Object.fromEntries(
      formatter.formatToParts(value).map(({ type, value: part }) => [type, part]),
    );
    return values;
  };
  const startParts = parts(start);
  const endParts = parts(end);
  return {
    consultationDate: `${startParts.year}-${startParts.month}-${startParts.day}`,
    startAt: start,
    endAt: end,
    startTime: `${startParts.hour}:${startParts.minute}`,
    endTime: `${endParts.hour}:${endParts.minute}`,
    durationMinutes: Math.round((end - start) / 60000),
    mode,
    location: mode === "Face-to-Face" ? location || "" : "",
    meetingPlatform: mode === "Online" ? meetingPlatform || "" : "",
  };
};
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
    status: { $in: ["Pending", "Reschedule Proposed", "Confirmed"] },
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
      item.status === "Confirmed",
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
      availabilityCapacity: await capacitySummary(req.user.id),
    }),
  });
});
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
      status: { $in: ["Pending", "Reschedule Proposed", "Confirmed"] },
    });
    if (existingActiveRequest)
      return res.status(409).json({
        message:
          "You already have an active consultation request for this faculty schedule.",
      });
    const [studentConflict, facultyConflict] = await Promise.all([
      Appointment.exists({
        student: req.user.id,
        status: { $in: ["Pending", "Reschedule Proposed", "Confirmed"] },
        startAt: { $lt: requestedEnd },
        endAt: { $gt: requestedStart },
      }),
      Appointment.exists({
        faculty: slot.faculty,
        status: "Confirmed",
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
    const reservationToken = crypto.randomUUID();
    const reservedSlot = await Availability.findOneAndUpdate(
      {
        _id: slot.id,
        isActive: true,
        reservationToken: { $exists: false },
        startAt: { $gt: new Date() },
        endAt: { $gt: slot.startAt },
      },
      { $set: { reservationToken } },
      { new: true },
    );
    if (!reservedSlot)
      return res
        .status(409)
        .json({ message: "This schedule is no longer available." });
    let appointment;
    const uploadedAssets = [];
    try {
      appointment = await Appointment.create({
        student: req.user.id,
        faculty: reservedSlot.faculty,
        availability: reservedSlot.id,
        reservationToken,
        startAt: reservedSlot.startAt,
        endAt: reservedSlot.endAt,
        estimatedDurationMinutes: windowMinutes,
        subject,
        yearLevel,
        reason,
        consultationMode: reservedSlot.mode || "Online",
        meetingPlatform:
          reservedSlot.mode === "Online"
            ? platformFor(reservedSlot)
            : undefined,
        location:
          reservedSlot.mode === "Online"
            ? platformFor(reservedSlot)
            : reservedSlot.location,
        status: "Pending",
      });
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
    } catch (creationError) {
      await Promise.all([
        ...uploadedAssets.map((asset) => destroyAsset(asset).catch(() => {})),
        ...(appointment
          ? [Appointment.deleteOne({ _id: appointment.id })]
          : []),
        Availability.updateOne(
          { _id: slot.id, reservationToken },
          { $unset: { reservationToken: 1 } },
        ),
      ]);
      throw creationError;
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
    !["Confirmed", "Rejected", "Completed", "Reschedule Proposed"].includes(
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
    appointment.status === "Pending"
  )
    return res.status(409).json({
      message:
        "Decide this request from Appointment Requests by assigning a one-time schedule or rejecting it.",
    });
  if (["Rejected", "Cancelled", "Expired", "Completed"].includes(appointment.status))
    return res
      .status(409)
      .json({ message: "This appointment can no longer be updated." });
  const previousStatus = appointment.status;
  if (
    status === "Confirmed" &&
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
  if (status === "Reschedule Proposed") {
    if (appointment.status !== "Confirmed")
      return res.status(409).json({
        message: "Only a confirmed consultation can receive a reschedule proposal.",
      });
    const slot = await Availability.findOne({
      _id: req.body.availabilityId,
      faculty: req.user.id,
      isActive: true,
      endAt: { $gt: new Date() },
    }).select("+meetingLink");
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
    if (
      appointment.startAt?.getTime() === proposedStart.getTime() &&
      appointment.endAt?.getTime() === proposedEnd.getTime()
    )
      return res.status(409).json({
        message: "The proposed schedule must differ from the current schedule.",
      });
    appointment.proposedAvailability = slot.id;
    appointment.proposedStartAt = proposedStart;
    appointment.proposedEndAt = proposedEnd;
    appointment.proposedConsultationMode = slot.mode || "Online";
    appointment.proposedLocation = slot.mode === "Face-to-Face" ? slot.location : "";
    appointment.proposedMeetingPlatform =
      slot.mode === "Online" ? platformFor(slot) : "";
    appointment.proposedMeetingLink =
      slot.mode === "Online" ? slot.meetingLink || "" : "";
    appointment.proposalNote = (req.body.note || "").trim();
    appointment.proposedAt = new Date();
    appointment.proposedBy = req.user.id;
  }
  if (
    ["Confirmed", "Reschedule Proposed"].includes(status) &&
    (await conflictsWithOneTimeSchedule(
      appointment,
      status === "Reschedule Proposed"
        ? appointment.proposedStartAt
        : appointment.startAt,
      status === "Reschedule Proposed"
        ? appointment.proposedEndAt
        : appointment.endAt,
    ))
  )
    return res.status(409).json({
      message:
        "The Faculty Member or Student has a one-time consultation during this schedule.",
    });
  appointment.status = status;
  appointment.responseNote = (req.body.note || "").trim();
  if (status === "Reschedule Proposed") {
    appointment.responseNote = appointment.proposalNote;
  }
  await appointment.save();
  if (
    status === "Reschedule Proposed" &&
    appointment.bookingMethod === "schedule_request"
  )
    await OneTimeScheduleHold.deleteMany({ appointment: appointment.id });
  const verb = status.toLowerCase();
  const notificationTitles = {
    Confirmed: "Consultation Confirmed",
    Rejected: "Consultation Request Rejected",
    "Reschedule Proposed": "Consultation Reschedule Proposed",
    Completed: "Consultation Completed",
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
router.put("/:id/reschedule-response", authorize("student"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ message: "Invalid appointment ID." });
  const decision = String(req.body.decision || "").toLowerCase();
  if (!["accept", "reject", "cancel"].includes(decision))
    return res.status(400).json({ message: "Select a valid proposal response." });

  const appointment = await Appointment.findOne({
    _id: req.params.id,
    student: req.user.id,
  }).select("+reservationToken +proposedMeetingLink +meetingLink");
  if (!appointment)
    return res.status(404).json({ message: "Appointment not found." });
  if (appointment.status !== "Reschedule Proposed")
    return res.status(409).json({
      message: "This reschedule proposal is no longer active.",
    });

  const proposedStart = new Date(appointment.proposedStartAt);
  const proposedEnd = new Date(appointment.proposedEndAt);
  const proposalComplete =
    Number.isFinite(proposedStart.getTime()) &&
    Number.isFinite(proposedEnd.getTime()) &&
    proposedEnd > proposedStart &&
    ["Face-to-Face", "Online"].includes(appointment.proposedConsultationMode);
  if (!proposalComplete)
    return res.status(400).json({
      message: "This reschedule proposal is incomplete and cannot be processed.",
    });

  const original = manilaScheduleSnapshot({
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    mode: appointment.consultationMode,
    location: appointment.location,
    meetingPlatform: appointment.meetingPlatform,
  });
  const proposed = manilaScheduleSnapshot({
    startAt: proposedStart,
    endAt: proposedEnd,
    mode: appointment.proposedConsultationMode,
    location: appointment.proposedLocation,
    meetingPlatform: appointment.proposedMeetingPlatform,
  });
  const respondedAt = new Date();
  const history = {
    previous: original,
    next: proposed,
    reason: appointment.proposalNote || "Schedule adjustment proposed by Faculty.",
    initiatedByRole: "Faculty",
    initiatedBy: appointment.proposedBy || appointment.faculty,
    createdAt: appointment.proposedAt || appointment.updatedAt,
    response:
      decision === "accept"
        ? "Accepted"
        : decision === "reject"
          ? "Rejected"
          : "Cancelled",
    respondedAt,
    respondedBy: req.user.id,
  };
  const proposalFields = {
    proposedAvailability: 1,
    proposedStartAt: 1,
    proposedEndAt: 1,
    proposedConsultationMode: 1,
    proposedLocation: 1,
    proposedMeetingPlatform: 1,
    proposedMeetingLink: 1,
    proposalNote: 1,
    proposedAt: 1,
    proposedBy: 1,
  };

  let claimedToken;
  let claimedAvailability;
  if (decision === "accept") {
    if (proposedStart <= respondedAt || proposedEnd <= respondedAt)
      return res.status(400).json({
        message: "This proposed schedule has already passed and can no longer be accepted.",
      });
    const blockingStatuses = ["Pending", "Reschedule Proposed", "Confirmed"];
    const [studentConflict, facultyConflict] = await Promise.all([
      Appointment.exists({
        _id: { $ne: appointment._id },
        student: req.user.id,
        status: { $in: blockingStatuses },
        startAt: { $lt: proposedEnd },
        endAt: { $gt: proposedStart },
      }),
      Appointment.exists({
        _id: { $ne: appointment._id },
        faculty: appointment.faculty,
        status: { $in: blockingStatuses },
        startAt: { $lt: proposedEnd },
        endAt: { $gt: proposedStart },
      }),
    ]);
    if (studentConflict || facultyConflict)
      return res.status(409).json({
        message: "The proposed schedule now conflicts with an active consultation.",
      });
    if (await conflictsWithOneTimeSchedule(appointment, proposedStart, proposedEnd))
      return res.status(409).json({
        message: "The proposed schedule now conflicts with an active consultation.",
      });

    if (appointment.proposedAvailability) {
      claimedToken = crypto.randomUUID();
      claimedAvailability = await Availability.findOneAndUpdate(
        {
          _id: appointment.proposedAvailability,
          faculty: appointment.faculty,
          isActive: true,
          reservationToken: { $exists: false },
          startAt: proposedStart,
          endAt: proposedEnd,
        },
        { $set: { reservationToken: claimedToken } },
        { new: true },
      ).select("+meetingLink");
      if (!claimedAvailability)
        return res.status(409).json({
          message: "This proposed schedule is no longer available.",
        });
    }
  }

  const nextStatus =
    decision === "accept" ? "Confirmed" : decision === "reject" ? "Pending" : "Cancelled";
  const set = { status: nextStatus, responseNote: "" };
  if (decision === "accept") {
    Object.assign(set, {
      availability: appointment.proposedAvailability || undefined,
      reservationToken: claimedToken,
      startAt: proposedStart,
      endAt: proposedEnd,
      estimatedDurationMinutes: Math.round((proposedEnd - proposedStart) / 60000),
      consultationMode: appointment.proposedConsultationMode,
      location:
        appointment.proposedConsultationMode === "Face-to-Face"
          ? appointment.proposedLocation
          : appointment.proposedMeetingPlatform,
      meetingPlatform:
        appointment.proposedConsultationMode === "Online"
          ? appointment.proposedMeetingPlatform
          : "",
      meetingLink:
        appointment.proposedConsultationMode === "Online"
          ? appointment.proposedMeetingLink || claimedAvailability?.meetingLink || ""
          : "",
    });
  }
  const unset = { ...proposalFields };
  if (decision === "accept" && !appointment.proposedAvailability) {
    unset.availability = 1;
    unset.reservationToken = 1;
    delete set.availability;
    delete set.reservationToken;
  }
  let updated;
  try {
    updated = await Appointment.findOneAndUpdate(
      {
        _id: appointment._id,
        student: req.user.id,
        status: "Reschedule Proposed",
        proposedAt: appointment.proposedAt,
      },
      { $set: set, $unset: unset, $push: { scheduleHistory: history } },
      { new: true, runValidators: true },
    );
  } catch (error) {
    if (claimedToken)
      await Availability.updateOne(
        { _id: appointment.proposedAvailability, reservationToken: claimedToken },
        { $unset: { reservationToken: 1 } },
      );
    throw error;
  }
  if (!updated) {
    if (claimedToken)
      await Availability.updateOne(
        { _id: appointment.proposedAvailability, reservationToken: claimedToken },
        { $unset: { reservationToken: 1 } },
      );
    return res.status(409).json({
      message: "This reschedule proposal was already answered.",
    });
  }

  const shouldReleaseOriginal =
    decision === "cancel" ||
    (decision === "accept" &&
      String(appointment.availability || "") !==
        String(appointment.proposedAvailability || ""));
  if (shouldReleaseOriginal && appointment.availability && appointment.reservationToken)
    await Availability.updateOne(
      { _id: appointment.availability, reservationToken: appointment.reservationToken },
      { $unset: { reservationToken: 1 } },
    );

  const responseLabel = history.response.toLowerCase();
  await Promise.all([
    logActivity(
      `appointment_reschedule_${responseLabel}`,
      req.user.id,
      "Appointment",
      appointment.id,
      { previousStatus: "Reschedule Proposed", newStatus: nextStatus },
    ),
    notify(
      appointment.faculty,
      "appointment",
      `Reschedule Proposal ${history.response}`,
      `${req.user.name} ${responseLabel} the consultation reschedule proposal.`,
      appointment.id,
    ),
  ]);
  const safe = updated.toObject ? updated.toObject() : updated;
  delete safe.reservationToken;
  delete safe.proposedMeetingLink;
  if (nextStatus !== "Confirmed") delete safe.meetingLink;
  return res.json({
    message:
      decision === "accept"
        ? "Reschedule proposal accepted. Your consultation is confirmed."
        : decision === "reject"
          ? "Reschedule proposal rejected. The consultation is pending Faculty action."
          : "Consultation cancelled.",
    appointment: safe,
  });
});
export default router;
