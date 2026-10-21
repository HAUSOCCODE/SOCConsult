import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import { ATTENDANCE_OUTCOMES } from "../config/attendance.js";
import { manilaHistoryBoundary } from "./studentConsultationHistoryService.js";

export const FACULTY_HISTORY_STATUSES = Object.freeze(["Completed", "Cancelled", "Rejected", "Expired", "Attendance Review"]);
export const FACULTY_HISTORY_MODES = Object.freeze(["Online", "Face-to-Face"]);
export const FACULTY_HISTORY_DEFAULT_LIMIT = 10;
export const FACULTY_HISTORY_MAX_LIMIT = 50;
const ALLOWED_KEYS = new Set(["page", "limit", "from", "to", "status", "attendanceOutcome", "mode", "search"]);
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseFacultyHistoryInput(input = {}) {
  if (Object.keys(input).some(key => !ALLOWED_KEYS.has(key)) || Object.values(input).some(value => value !== undefined && typeof value !== "string")) fail("Invalid Faculty history filter.");
  const page = Number(input.page || 1), limit = Number(input.limit || FACULTY_HISTORY_DEFAULT_LIMIT);
  if (!Number.isInteger(page) || page < 1 || page > 10000) fail("Invalid history page.");
  if (!Number.isInteger(limit) || limit < 1 || limit > FACULTY_HISTORY_MAX_LIMIT) fail("Invalid history page size.");
  if (input.status && !FACULTY_HISTORY_STATUSES.includes(input.status)) fail("Invalid history status filter.");
  if (input.attendanceOutcome && !ATTENDANCE_OUTCOMES.includes(input.attendanceOutcome)) fail("Invalid attendance outcome filter.");
  if (input.mode && !FACULTY_HISTORY_MODES.includes(input.mode)) fail("Invalid consultation mode filter.");
  const from = input.from ? manilaHistoryBoundary(input.from) : null;
  const to = input.to ? manilaHistoryBoundary(input.to, true) : null;
  if ((input.from && !from) || (input.to && !to)) fail("Invalid history date filter.");
  if (from && to && from >= to) fail("From date must be on or before To date.");
  const search = (input.search || "").trim();
  if (search.length > 100) fail("Student search is too long.");
  return { page, limit, from, to, status: input.status, attendanceOutcome: input.attendanceOutcome, mode: input.mode, search };
}

export function facultyHistoryQuery({ faculty, filters, studentIds }) {
  const query = { faculty, status: filters.status || { $in: FACULTY_HISTORY_STATUSES } };
  if (filters.from || filters.to) query.startAt = { ...(filters.from && { $gte: filters.from }), ...(filters.to && { $lt: filters.to }) };
  if (filters.attendanceOutcome) query["attendance.finalOutcome"] = filters.attendanceOutcome;
  if (filters.mode) query.consultationMode = filters.mode;
  if (studentIds) query.student = { $in: studentIds };
  return query;
}

export function safeFacultyHistoryRecord(row) {
  const student = row.student ? { _id: row.student._id, name: row.student.name, firstName: row.student.firstName, middleName: row.student.middleName, lastName: row.student.lastName, studentId: row.student.studentId, institutionalId: row.student.institutionalId } : null;
  return { _id: row._id, student, subject: row.subject, reason: row.reason, startAt: row.startAt, endAt: row.endAt, consultationMode: row.consultationMode, status: row.status, finalAttendanceOutcome: row.attendance?.finalOutcome || null, hasSupportingDocuments: Boolean(row.supportingDocument?.name || row.supportingDocuments?.length) };
}

async function matchingStudents(search, faculty, filters) {
  if (!search) return null;
  const owned = await Appointment.distinct("student", facultyHistoryQuery({ faculty, filters }));
  if (!owned.length) return [];
  const pattern = new RegExp(escaped(search), "i");
  const rows = await User.find({ _id: { $in: owned }, $or: [{ name: pattern }, { firstName: pattern }, { middleName: pattern }, { lastName: pattern }, { studentId: pattern }, { institutionalId: pattern }] }).select("_id").lean();
  return rows.map(row => row._id);
}

export async function listFacultyConsultationHistory({ faculty, input }) {
  if (!mongoose.isValidObjectId(faculty)) fail("Invalid Faculty account.");
  const filters = parseFacultyHistoryInput(input);
  const studentIds = await matchingStudents(filters.search, faculty, filters);
  const query = facultyHistoryQuery({ faculty, filters, studentIds });
  const projection = "student subject reason startAt endAt consultationMode status supportingDocument.name supportingDocuments +attendance";
  const [rows, total] = await Promise.all([
    Appointment.find(query).select(projection).populate("student", "name firstName middleName lastName studentId institutionalId").sort({ startAt: -1, _id: -1 }).skip((filters.page - 1) * filters.limit).limit(filters.limit).lean(),
    Appointment.countDocuments(query),
  ]);
  return { consultations: rows.map(safeFacultyHistoryRecord), pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.max(1, Math.ceil(total / filters.limit)) } };
}
