import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import SupportingDocument from "../models/SupportingDocument.js";
import { monitoringAttendance } from "./attendancePrivacyService.js";

export const STUDENT_HISTORY_STATUSES = Object.freeze([
  "Completed",
  "Rejected",
  "Cancelled",
  "Expired",
  "Attendance Review",
]);
export const STUDENT_HISTORY_MODES = Object.freeze(["Online", "Face-to-Face"]);
export const STUDENT_HISTORY_PAGE_SIZE = 10;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const fail = (message) => {
  throw Object.assign(new Error(message), { statusCode: 400 });
};
export function manilaHistoryBoundary(value, nextDay = false) {
  if (!DATE_PATTERN.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + (nextDay ? 1 : 0)) - MANILA_OFFSET_MS);
  const check = new Date(utc.getTime() + MANILA_OFFSET_MS - (nextDay ? 86400000 : 0));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    return null;
  return utc;
}
const safeStatusHistory = (entries = []) => entries
  .filter(entry => entry?.newStatus && Number.isFinite(new Date(entry.changedAt).getTime()))
  .map(entry => ({
    previousStatus: entry.previousStatus || "Previous state",
    newStatus: entry.newStatus,
    changedByRole: entry.changedByRole || "System",
    changedAt: entry.changedAt,
  }))
  .sort((left, right) => new Date(left.changedAt) - new Date(right.changedAt));
const safeDocument = document => ({
  _id: document?._id,
  originalName: document?.originalName,
  mimeType: document?.mimeType,
  size: document?.size,
  uploadedAt: document?.uploadedAt || document?.createdAt,
});
async function safeDocuments(appointments) {
  const legacyIds = appointments.flatMap(row => (row.supportingDocuments || [])
    .filter(document => mongoose.isValidObjectId(document) && !document?.originalName));
  const legacy = legacyIds.length
    ? await SupportingDocument.find({ _id: { $in: legacyIds } }).select("originalName mimeType size createdAt").lean()
    : [];
  const byId = new Map(legacy.map(document => [String(document._id), document]));
  return appointments.map(row => ({
    ...row,
    supportingDocuments: (row.supportingDocuments || []).map(document =>
      document?.originalName ? safeDocument(document) : safeDocument(byId.get(String(document))))
      .filter(document => document.originalName),
  }));
}
function historicalEligibility(now) {
  return {
    $or: [
      { status: { $in: ["Completed", "Rejected", "Cancelled", "Expired"] } },
      { status: "Attendance Review", $or: [
        { "attendance.studentResponded": true },
        { "attendance.responseDeadlineAt": { $lte: now } },
      ] },
    ],
  };
}
export function studentHistoryQuery({ student, status, mode, faculty, from, to, now = new Date() }) {
  if (status && !STUDENT_HISTORY_STATUSES.includes(status)) fail("Invalid history status filter.");
  if (mode && !STUDENT_HISTORY_MODES.includes(mode)) fail("Invalid consultation mode filter.");
  if (faculty && !mongoose.isValidObjectId(faculty)) fail("Invalid Faculty filter.");
  const fromDate = from ? manilaHistoryBoundary(from) : null;
  const toDate = to ? manilaHistoryBoundary(to, true) : null;
  if ((from && !fromDate) || (to && !toDate)) fail("Invalid history date filter.");
  if (fromDate && toDate && fromDate >= toDate) fail("From date must be on or before To date.");
  const query = { student, ...historicalEligibility(now) };
  if (status) query.status = status;
  if (mode) query.consultationMode = mode;
  if (faculty) query.faculty = faculty;
  if (fromDate || toDate) query.startAt = {
    ...(fromDate && { $gte: fromDate }),
    ...(toDate && { $lt: toDate }),
  };
  return query;
}
export function safeStudentHistoryRecord(row) {
  return {
    _id: row._id,
    faculty: row.faculty ? {
      _id: row.faculty._id,
      name: row.faculty.name,
      firstName: row.faculty.firstName,
      middleName: row.faculty.middleName,
      lastName: row.faculty.lastName,
      position: row.faculty.position,
      specialization: row.faculty.specialization,
      office: row.faculty.office,
    } : null,
    subject: row.subject,
    reason: row.reason,
    startAt: row.startAt,
    endAt: row.endAt,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    consultationMode: row.consultationMode,
    location: row.location,
    meetingPlatform: row.meetingPlatform,
    status: row.status,
    createdAt: row.createdAt,
    responseNote: row.status === "Rejected" ? row.responseNote : undefined,
    cancellationReason: row.status === "Cancelled" ? row.cancellationReason : undefined,
    expirationReason: row.status === "Expired" ? row.expirationReason : undefined,
    attendanceSummary: monitoringAttendance(row),
    supportingDocument: row.supportingDocument?.name ? {
      name: row.supportingDocument.name,
      mimeType: row.supportingDocument.mimeType,
      size: row.supportingDocument.size,
    } : undefined,
    supportingDocuments: (row.supportingDocuments || []).map(safeDocument).filter(document => document.originalName),
    statusHistory: safeStatusHistory(row.statusHistory),
  };
}
export async function listStudentConsultationHistory({ student, input, now = new Date() }) {
  const page = Number(input.page || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) fail("Invalid history page.");
  const query = studentHistoryQuery({ student, status: input.status, mode: input.mode,
    faculty: input.faculty, from: input.from, to: input.to, now });
  const base = { student, ...historicalEligibility(now) };
  const projection = "faculty subject reason startAt endAt estimatedDurationMinutes consultationMode location meetingPlatform status createdAt responseNote cancellationReason expirationReason supportingDocument.name supportingDocument.mimeType supportingDocument.size supportingDocuments statusHistory +attendance";
  const [rows, total, providerRows] = await Promise.all([
    Appointment.find(query).select(projection).populate("faculty", "name firstName middleName lastName position specialization office").sort({ startAt: -1, _id: -1 }).skip((page - 1) * STUDENT_HISTORY_PAGE_SIZE).limit(STUDENT_HISTORY_PAGE_SIZE).lean(),
    Appointment.countDocuments(query),
    Appointment.find(base).select("faculty").populate("faculty", "name firstName middleName lastName").lean(),
  ]);
  const hydrated = await safeDocuments(rows);
  const providers = [...new Map(providerRows.filter(row => row.faculty).map(row => [String(row.faculty._id), {
    _id: row.faculty._id,
    name: row.faculty.name,
    firstName: row.faculty.firstName,
    middleName: row.faculty.middleName,
    lastName: row.faculty.lastName,
  }])).values()];
  return {
    consultations: hydrated.map(safeStudentHistoryRecord),
    providers,
    pagination: { page, pageSize: STUDENT_HISTORY_PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / STUDENT_HISTORY_PAGE_SIZE)) },
  };
}
