import Availability from "../models/Availability.js";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import StudentAvailability from "../models/StudentAvailability.js";
import mongoose from "mongoose";
import { logActivity, notify } from "../services/activityService.js";
import {
  availabilityStatus,
  processExpiredAvailability,
} from "../services/availabilityExpirationService.js";

const validateSchedule = ({ startAt, endAt }) => {
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()))
    return "Select a valid availability date, start time, and end time.";
  if (endAt <= startAt) return "End time must be later than start time.";
  if (startAt <= new Date())
    return "Start time must be later than the current time.";
  return "";
};

const validMeetingLink = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const legacyPlatform = (availability) => {
  if (availability.meetingPlatform) return availability.meetingPlatform;
  return "Meeting platform not provided";
};

const validateModeFields = ({
  mode,
  location,
  meetingPlatform,
  meetingLink,
}) => {
  if (mode === "Face-to-Face" && !location?.trim())
    return "Location is required for face-to-face availability.";
  if (mode === "Online" && !meetingPlatform?.trim())
    return "Meeting platform is required for online availability.";
  if (
    mode === "Online" &&
    meetingLink?.trim() &&
    !validMeetingLink(meetingLink.trim())
  )
    return "Please enter a valid meeting link.";
  return "";
};

const scheduleShape = (availability) => ({
  _id: availability.id,
  availabilityId: availability.id,
  startAt: availability.startAt,
  endAt: availability.endAt,
  mode: availability.mode || "Online",
  location:
    availability.mode === "Face-to-Face" ? availability.location : undefined,
  meetingPlatform:
    availability.mode === "Online" ? legacyPlatform(availability) : undefined,
});

export const getAvailableFaculty = async (_req, res) => {
  await processExpiredAvailability();
  const now = new Date();
  const faculty = await User.find({
    accountStatus: "Active",
    $or: [
      { role: "faculty", registrationStatus: "Approved" },
      { role: "dean" },
    ],
  }).select(
    "name role position specialization office +profilePicture",
  );
  const ids = faculty.map((item) => item.id);
  const availability = await Availability.find({
    faculty: { $in: ids },
    isActive: true,
    reservationToken: { $exists: false },
    startAt: { $gt: now },
    endAt: { $gt: now },
  });
  const counts = Object.fromEntries(faculty.map((item) => [item.id, 0]));
  const modes = Object.fromEntries(faculty.map((item) => [item.id, new Set()]));
  availability.forEach((item) => {
    counts[item.faculty] += 1;
    modes[item.faculty].add(item.mode || "Online");
  });
  res.json({
    faculty: faculty
      .filter((item) => item.role === "faculty" || counts[item.id] > 0)
      .map((item) => ({
        ...item.toObject(),
        profilePicture:
          typeof item.profilePicture === "string"
            ? item.profilePicture
            : item.profilePicture?.url,
        availableScheduleCount: counts[item.id],
        consultationModes: [...modes[item.id]],
      })),
  });
};

export const getFacultyAvailability = async (req, res) => {
  const facultyId = req.user.role === "student" ? req.params.facultyId : req.user.id;
  if (req.user.role === "student") {
    if (!mongoose.isValidObjectId(facultyId))
      return res.status(404).json({ message: "Consultation provider not found." });
    const provider = await User.exists({
      _id: facultyId,
      accountStatus: "Active",
      $or: [
        { role: "faculty", registrationStatus: "Approved" },
        { role: "dean" },
      ],
    });
    if (!provider)
      return res.status(404).json({ message: "Consultation provider not found." });
  }
  await processExpiredAvailability({ facultyId });
  const now = new Date();
  const schedules = await Availability.find({
    faculty: facultyId,
    isActive: true,
    ...(req.user.role === "student" && {
      reservationToken: { $exists: false },
    }),
    ...(req.user.role === "student" && { startAt: { $gt: now } }),
    endAt: { $gt: now },
  }).sort({ startAt: 1 });
  if (req.user.role === "student") {
    const studentAvailability = await StudentAvailability.find({
      student: req.user.id,
      isActive: true,
      endAt: { $gt: now },
    })
      .select("startAt endAt")
      .lean();
    const hasActiveStudentAvailability = studentAvailability.length > 0;
    const [studentAppointments, providerAppointments] = await Promise.all([
      Appointment.find({
        student: req.user.id,
        status: { $in: ["Pending", "Reschedule Proposed", "Confirmed"] },
        startAt: { $exists: true },
        endAt: { $gt: now },
      }).select("startAt endAt"),
      Appointment.find({
        faculty: facultyId,
        status: "Confirmed",
        startAt: { $exists: true },
        endAt: { $gt: now },
      }).select("startAt endAt"),
    ]);
    const overlaps = (slot, appointment) =>
      slot.startAt < appointment.endAt && slot.endAt > appointment.startAt;
    const matchedSchedules = schedules.filter((schedule) => {
      if (
        hasActiveStudentAvailability &&
        !studentAvailability.some(
          (period) =>
            period.startAt <= schedule.startAt &&
            period.endAt >= schedule.endAt,
        )
      )
        return false;
      return (
        !studentAppointments.some((appointment) =>
          overlaps(schedule, appointment),
        ) &&
        !providerAppointments.some((appointment) =>
          overlaps(schedule, appointment),
        )
      );
    });
    return res.json({
      hasActiveStudentAvailability,
      schedules: matchedSchedules.map((schedule) => ({
        ...scheduleShape(schedule),
        matchingType: hasActiveStudentAvailability
          ? "Matched with your availability"
          : "Based on Faculty availability only",
        bookable: true,
      })),
    });
  }
  res.json({
    schedules: schedules.map(scheduleShape),
  });
};

export const getMyAvailability = async (req, res) => {
  await processExpiredAvailability({ facultyId: req.user.id });
  const now = new Date();
  const availability = await Availability.find({ faculty: req.user.id })
    .select("+meetingLink")
    .lean();
  const shaped = availability
    .map((schedule) => ({
      ...schedule,
      status: availabilityStatus(schedule, now),
    }))
    .sort((left, right) => {
      const rank = { active: 0, inactive: 1, expired: 2 };
      const rankDifference = rank[left.status] - rank[right.status];
      if (rankDifference) return rankDifference;
      return left.status === "expired"
        ? new Date(right.startAt) - new Date(left.startAt)
        : new Date(left.startAt) - new Date(right.startAt);
    });
  res.json({ availability: shaped });
};

export const getAppointmentRequestSchedules = async (req, res) => {
  await processExpiredAvailability({ facultyId: req.user.id });
  const now = new Date();
  const schedules = await Availability.find({
    faculty: req.user.id,
    endAt: { $gt: now },
  })
    .select("startAt endAt mode location meetingPlatform isActive")
    .sort({ startAt: 1 })
    .lean();
  const totals = await Appointment.aggregate([
    {
      $match: {
        faculty: new mongoose.Types.ObjectId(req.user.id),
        availability: { $in: schedules.map((schedule) => schedule._id) },
        status: { $in: ["Pending", "Confirmed", "Rejected"] },
      },
    },
    {
      $group: {
        _id: "$availability",
        pendingCount: {
          $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] },
        },
        approvedCount: {
          $sum: { $cond: [{ $eq: ["$status", "Confirmed"] }, 1, 0] },
        },
        rejectedCount: {
          $sum: { $cond: [{ $eq: ["$status", "Rejected"] }, 1, 0] },
        },
        pendingEstimatedMinutes: {
          $sum: {
            $cond: [
              { $eq: ["$status", "Pending"] },
              { $ifNull: ["$estimatedDurationMinutes", 0] },
              0,
            ],
          },
        },
        approvedEstimatedMinutes: {
          $sum: {
            $cond: [
              { $eq: ["$status", "Confirmed"] },
              { $ifNull: ["$estimatedDurationMinutes", 0] },
              0,
            ],
          },
        },
        totalEstimatedMinutes: {
          $sum: {
            $cond: [
              { $in: ["$status", ["Pending", "Confirmed"]] },
              { $ifNull: ["$estimatedDurationMinutes", 0] },
              0,
            ],
          },
        },
      },
    },
  ]);
  const bySchedule = new Map(totals.map((item) => [String(item._id), item]));
  res.json({
    schedules: schedules.map((schedule) => ({
      ...schedule,
      availabilityId: String(schedule._id),
      capacityMinutes: Math.round((schedule.endAt - schedule.startAt) / 60000),
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      pendingEstimatedMinutes: 0,
      approvedEstimatedMinutes: 0,
      totalEstimatedMinutes: 0,
      ...bySchedule.get(String(schedule._id)),
      _id: schedule._id,
    })),
  });
};

export const getAvailabilityDetails = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ message: "Invalid availability ID." });
  await processExpiredAvailability({ facultyId: req.user.id });
  const schedule = await Availability.findOne({
    _id: req.params.id,
    faculty: req.user.id,
  }).select("+meetingLink");
  if (!schedule)
    return res.status(404).json({ message: "Availability not found." });
  if (availabilityStatus(schedule) === "expired")
    return res.status(409).json({
      message:
        "This availability has expired and can no longer manage requests.",
    });
  const appointments = await Appointment.find({
    availability: schedule.id,
    faculty: req.user.id,
    status: { $in: ["Pending", "Confirmed", "Rejected"] },
  })
    .populate(
      "student",
      "name email studentId program yearLevel +profilePicture",
    )
    .sort({ startAt: 1, createdAt: 1 });
  const safe = appointments.map((appointment) => {
    const value = appointment.toObject();
    if (
      value.student?.profilePicture &&
      typeof value.student.profilePicture !== "string"
    )
      value.student.profilePicture = value.student.profilePicture.url;
    value.supportingDocuments = (value.supportingDocuments || [])
      .filter((document) => document?.originalName)
      .map((document) => ({
        _id: document._id,
        originalName: document.originalName,
        mimeType: document.mimeType,
        size: document.size,
        uploadedAt: document.uploadedAt,
      }));
    return value;
  });
  res.json({
    schedule,
    pendingRequests: safe.filter(
      (appointment) => appointment.status === "Pending",
    ),
    approvedStudents: safe.filter(
      (appointment) => appointment.status === "Confirmed",
    ),
    rejectedRequests: safe.filter(
      (appointment) => appointment.status === "Rejected",
    ),
  });
};

export const createAvailability = async (req, res) => {
  const startAt = new Date(req.body.startAt);
  const endAt = new Date(req.body.endAt);
  const validationError = validateSchedule({ startAt, endAt });
  if (validationError)
    return res.status(400).json({ message: validationError });
  if (
    await Availability.exists({
      faculty: req.user.id,
      isActive: true,
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
    })
  )
    return res
      .status(409)
      .json({ message: "This availability overlaps an existing schedule." });
  if (!["Face-to-Face", "Online"].includes(req.body.mode))
    return res
      .status(400)
      .json({ message: "Select a valid consultation mode." });
  const modeValidation = validateModeFields(req.body);
  if (modeValidation) return res.status(400).json({ message: modeValidation });
  const availability = await Availability.create({
    faculty: req.user.id,
    startAt,
    endAt,
    location: req.body.mode === "Face-to-Face" ? req.body.location.trim() : "",
    mode: req.body.mode,
    meetingPlatform:
      req.body.mode === "Online" ? req.body.meetingPlatform.trim() : "",
    meetingLink: req.body.mode === "Online" ? req.body.meetingLink.trim() : "",
  });
  res
    .status(201)
    .json({ message: "Availability published successfully.", availability });
};

export const updateAvailability = async (req, res) => {
  await processExpiredAvailability({ facultyId: req.user.id });
  const schedule = await Availability.findOne({
    _id: req.params.id,
    faculty: req.user.id,
  }).select("+meetingLink");
  if (!schedule)
    return res.status(404).json({ message: "Availability not found." });
  if (availabilityStatus(schedule) === "expired")
    return res.status(409).json({
      message: "Expired availability cannot be edited or reactivated.",
    });
  if (req.body.startAt || req.body.endAt) {
    const startAt = new Date(req.body.startAt || schedule.startAt);
    const endAt = new Date(req.body.endAt || schedule.endAt);
    const validationError = validateSchedule({ startAt, endAt });
    if (validationError)
      return res.status(400).json({ message: validationError });
    const changesTime =
      startAt.getTime() !== schedule.startAt.getTime() ||
      endAt.getTime() !== schedule.endAt.getTime();
    if (
      changesTime &&
      (await Appointment.exists({
        availability: schedule.id,
        status: { $in: ["Pending", "Reschedule Proposed", "Confirmed"] },
      }))
    )
      return res.status(409).json({
        message:
          "An availability with consultation requests cannot have its time changed.",
      });
    if (
      changesTime &&
      (await Availability.exists({
        _id: { $ne: schedule.id },
        faculty: req.user.id,
        isActive: true,
        startAt: { $lt: endAt },
        endAt: { $gt: startAt },
      }))
    )
      return res
        .status(409)
        .json({ message: "This availability overlaps an existing schedule." });
    schedule.startAt = startAt;
    schedule.endAt = endAt;
  }
  if (typeof req.body.isActive === "boolean")
    schedule.isActive = req.body.isActive;
  const updatesModeFields = [
    "mode",
    "location",
    "meetingPlatform",
    "meetingLink",
  ].some((field) => req.body[field] !== undefined);
  if (updatesModeFields) {
    const mode = req.body.mode || schedule.mode;
    if (!["Face-to-Face", "Online"].includes(mode))
      return res
        .status(400)
        .json({ message: "Select a valid consultation mode." });
    const modeFields = {
      mode,
      location: req.body.location ?? schedule.location,
      meetingPlatform: req.body.meetingPlatform ?? schedule.meetingPlatform,
      meetingLink: req.body.meetingLink ?? schedule.meetingLink,
    };
    const modeValidation = validateModeFields(modeFields);
    if (modeValidation)
      return res.status(400).json({ message: modeValidation });
    schedule.mode = mode;
    schedule.location =
      mode === "Face-to-Face" ? modeFields.location.trim() : "";
    schedule.meetingPlatform =
      mode === "Online" ? modeFields.meetingPlatform.trim() : "";
    schedule.meetingLink =
      mode === "Online" ? modeFields.meetingLink.trim() : "";
  }
  await schedule.save();
  res.json({
    message: req.body.startAt
      ? "Availability updated."
      : `Availability ${schedule.isActive ? "activated" : "deactivated"}.`,
    availability: schedule,
  });
};

export const deleteAvailability = async (req, res) => {
  if (
    await Appointment.exists({
      availability: req.params.id,
      faculty: req.user.id,
      status: { $in: ["Pending", "Reschedule Proposed", "Confirmed"] },
    })
  )
    return res.status(409).json({
      message:
        "An availability with active consultation requests cannot be removed.",
    });
  const schedule = await Availability.findOneAndDelete({
    _id: req.params.id,
    faculty: req.user.id,
  });
  if (!schedule)
    return res.status(404).json({ message: "Availability not found." });
  res.json({ message: "Availability removed." });
};
