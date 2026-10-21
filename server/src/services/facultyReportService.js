import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import ReportExport from "../models/ReportExport.js";
import { ATTENDANCE_OUTCOMES } from "../config/attendance.js";
import { FACULTY_HISTORY_MODES, FACULTY_HISTORY_STATUSES } from "./facultyConsultationHistoryService.js";
import { manilaHistoryBoundary } from "./studentConsultationHistoryService.js";
import { formatFullName } from "./personNameService.js";
import { recordFacultyReportExportAudit } from "./activityService.js";
import { generateFacultyReportPdf } from "./facultyReportPdfService.js";

export const FACULTY_REPORT_MAX_DAYS = 366;
export const FACULTY_REPORT_MAX_RECORDS = 1000;
const KEYS = new Set(["startDate", "endDate", "status", "attendanceOutcome", "mode"]);
const fail = statusCode => { throw Object.assign(new Error("Faculty report unavailable."), { statusCode }); };

export function parseFacultyReportFilters(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !KEYS.has(key)) || Object.values(input).some(value => typeof value !== "string")) fail(400);
  if (!input.startDate || !input.endDate) fail(400);
  const start = manilaHistoryBoundary(input.startDate), endExclusive = manilaHistoryBoundary(input.endDate, true);
  if (!start || !endExclusive || start >= endExclusive || (endExclusive - start) / 86400000 > FACULTY_REPORT_MAX_DAYS) fail(400);
  if (input.status && !FACULTY_HISTORY_STATUSES.includes(input.status)) fail(400);
  if (input.attendanceOutcome && !ATTENDANCE_OUTCOMES.includes(input.attendanceOutcome)) fail(400);
  if (input.mode && !FACULTY_HISTORY_MODES.includes(input.mode)) fail(400);
  return { start, endExclusive, normalized: { startDate: input.startDate, endDate: input.endDate, status: input.status || "", attendanceOutcome: input.attendanceOutcome || "", mode: input.mode || "" } };
}

export function facultyReportQuery(faculty, parsed) {
  const query = { faculty, status: parsed.normalized.status || { $in: FACULTY_HISTORY_STATUSES }, startAt: { $gte: parsed.start, $lt: parsed.endExclusive } };
  if (parsed.normalized.attendanceOutcome) query["attendance.finalOutcome"] = parsed.normalized.attendanceOutcome;
  if (parsed.normalized.mode) query.consultationMode = parsed.normalized.mode;
  return query;
}

const text = (value, fallback = "Not provided", max = 500) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
export function buildFacultyReport(rows, faculty, filters, generatedAt) {
  const summary = { total: rows.length, status: Object.fromEntries(FACULTY_HISTORY_STATUSES.map(value => [value, 0])), attendance: Object.fromEntries([...ATTENDANCE_OUTCOMES, "Not finalized"].map(value => [value, 0])) };
  const records = rows.map(row => {
    const status = FACULTY_HISTORY_STATUSES.includes(row.status) ? row.status : "Unavailable";
    const attendanceOutcome = ATTENDANCE_OUTCOMES.includes(row.attendance?.finalOutcome) ? row.attendance.finalOutcome : "Not finalized";
    summary.status[status] = (summary.status[status] || 0) + 1;
    summary.attendance[attendanceOutcome]++;
    return { startAt: row.startAt, student: text(formatFullName(row.student), "Student unavailable", 242), institutionalId: text(row.student?.studentId || row.student?.institutionalId, "—", 80), subject: text(row.subject, "Consultation", 180), concern: text(row.reason, "Not provided", 500), mode: FACULTY_HISTORY_MODES.includes(row.consultationMode) ? row.consultationMode : "Unavailable", status, attendanceOutcome };
  });
  return { title: "Faculty Consultation Report", facultyName: text(formatFullName(faculty), "Faculty", 242), filters, generatedAt, summary, records };
}

export async function createFacultyReport(input, actor) {
  if (!actor?.id || !["faculty", "dean"].includes(actor.role) || actor.accountStatus !== "Active") fail(403);
  const parsed = parseFacultyReportFilters(input), query = facultyReportQuery(actor.id, parsed);
  const rows = await Appointment.find(query).select("student subject reason startAt consultationMode status +attendance").populate("student", "name firstName middleName lastName studentId institutionalId").sort({ startAt: -1, _id: -1 }).limit(FACULTY_REPORT_MAX_RECORDS + 1).lean();
  if (rows.length > FACULTY_REPORT_MAX_RECORDS) fail(413);
  if (!rows.length) fail(404);
  const faculty = await User.findOne({ _id: actor.id, role: actor.role, accountStatus: "Active" }).select("name firstName middleName lastName role accountStatus").lean();
  if (!faculty) fail(403);
  const generatedAt = new Date(), report = buildFacultyReport(rows, faculty, parsed.normalized, generatedAt);
  const bytes = await generateFacultyReportPdf(report);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await User.findOne({ _id: actor.id, role: actor.role, accountStatus: "Active" }).select("role accountStatus").session(session);
      if (!current) fail(403);
      const [metadata] = await ReportExport.create([{ requestingUser: current._id, requestingRole: current.role, reportType: "faculty_consultation_report", generatedAt, dateBasis: "startAt", timezone: "Asia/Manila", filters: parsed.normalized, summary: report.summary }], { session });
      await recordFacultyReportExportAudit({ actor: current._id, role: current.role, report: metadata, summary: report.summary, session });
    });
  } finally { await session.endSession(); }
  return { bytes, total: report.summary.total, filename: `faculty-consultation-report-${parsed.normalized.startDate}-to-${parsed.normalized.endDate}.pdf` };
}
