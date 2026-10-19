import { BLOCKING_STATUSES } from "../config/appointmentStatus.js";
import Availability from "../models/Availability.js";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import StudentAvailability from "../models/StudentAvailability.js";
import mongoose from "mongoose";
import { mutateAvailability } from "../services/availabilityManagementService.js";
import {
  availabilityStatus,
} from "../services/availabilityExpirationService.js";

const legacyPlatform = (availability) => {
  if (availability.meetingPlatform) return availability.meetingPlatform;
  return "Meeting platform not provided";
};

const scheduleShape = (availability) => ({
  _id: availability.id || String(availability._id),
  availabilityId: availability.id || String(availability._id),
  startAt: availability.startAt,
  endAt: availability.endAt,
  mode: availability.mode || "Online",
  location:
    availability.mode === "Face-to-Face" ? availability.location : undefined,
  meetingPlatform:
    availability.mode === "Online" ? legacyPlatform(availability) : undefined,
});

export const getAvailableFaculty = async (_req, res) => {
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
  const appointments = await Appointment.find({ faculty: { $in: ids }, status: { $in: BLOCKING_STATUSES } })
    .select("faculty availability startAt endAt");
  const counts = Object.fromEntries(faculty.map((item) => [item.id, 0]));
  const modes = Object.fromEntries(faculty.map((item) => [item.id, new Set()]));
  availability.forEach((item) => {
    if (appointments.some(appointment => String(appointment.faculty) === String(item.faculty) &&
      (String(appointment.availability) === String(item._id) ||
        (item.startAt < appointment.endAt && item.endAt > appointment.startAt)))) return;
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
        status: { $in: BLOCKING_STATUSES },
        startAt: { $exists: true },
        endAt: { $gt: now },
      }).select("startAt endAt"),
      Appointment.find({
        faculty: facultyId,
        status: { $in: BLOCKING_STATUSES },
      }).select("availability startAt endAt"),
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
          String(appointment.availability) === String(schedule._id) || overlaps(schedule, appointment),
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
  const now = new Date();
  const availability = await Availability.find({ faculty: req.user.id })
    .select("+meetingLink +reservationToken")
    .lean();
  const linked = await Appointment.find({ faculty: req.user.id, status: { $in: BLOCKING_STATUSES } }).select("availability status").lean();
  const shaped = availability
    .map((schedule) => ({
      ...schedule,
      reservationToken: undefined,
      protected: Boolean(schedule.reservationToken) || linked.some(item => String(item.availability) === String(schedule._id)),
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

      },
    },
  ]);
  const bySchedule = new Map(totals.map((item) => [String(item._id), item]));
  res.json({
    schedules: schedules.map((schedule) => ({
      ...schedule,
      availabilityId: String(schedule._id),
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      ...bySchedule.get(String(schedule._id)),
      _id: schedule._id,
    })),
  });
};

export const getAvailabilityDetails = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ message: "Invalid availability ID." });
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
  const availability = await mutateAvailability({ actor: req.user, input: req.body, action: "create" });
  res.status(201).json({ message: "Availability published successfully.", availability });
};
export const updateAvailability = async (req, res) => {
  const availability = await mutateAvailability({ actor: req.user, id: req.params.id, input: req.body, action: "update" });
  res.json({ message: "Availability updated.", availability });
};
export const deleteAvailability = async (req, res) => {
  await mutateAvailability({ actor: req.user, id: req.params.id, input: req.body, action: "delete" });
  res.json({ message: "Availability removed." });
};
