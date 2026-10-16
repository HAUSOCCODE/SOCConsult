import Appointment from "../models/Appointment.js";
import {
  APPOINTMENT_STATUSES,
  LEGACY_APPOINTMENT_STATUSES,
} from "../config/appointmentStatus.js";
import { ATTENDANCE_OUTCOMES } from "../config/attendance.js";
import { parseConsultationQuery } from "./deanConsultationService.js";
import { attendanceClassification } from "./attendanceReportingService.js";
import { formatFullName } from "./personNameService.js";
export const REPORT_LIMIT = 1000;
const fail = (statusCode = 400) => {
  throw Object.assign(new Error("Report unavailable."), { statusCode });
};
export function parseReportFilters(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "start",
          "end",
          "facultyId",
          "status",
          "attendanceOutcome",
          "mode",
        ].includes(key),
    ) ||
    Object.values(input).some((value) => typeof value !== "string")
  )
    fail();
  if (
    !input.start ||
    !input.end ||
    (input.status !== undefined &&
      !APPOINTMENT_STATUSES.includes(input.status)) ||
    (input.attendanceOutcome !== undefined &&
      !ATTENDANCE_OUTCOMES.includes(input.attendanceOutcome))
  )
    fail();
  const { attendanceOutcome, ...rest } = input;
  const parsed = parseConsultationQuery(rest);
  if (attendanceOutcome !== undefined) {
    // An outcome is authoritative only for a finalized workflow with trusted provenance.
    parsed.filter.$and = [
      {
        status: "Completed",
        "attendance.finalOutcome": attendanceOutcome,
        "attendance.finalizationSource": {
          $in: ["participant_agreement", "dean_review"],
        },
      },
    ];
  }
  return {
    filter: parsed.filter,
    filters: {
      ...rest,
      ...(attendanceOutcome !== undefined && { attendanceOutcome }),
    },
  };
}
export const attendanceLabels = Object.freeze({
  verifiedCompleted: "Completed",
  studentNoShow: "Student No-show",
  facultyNoShow: "Faculty No-show",
  historicalUnverifiedCompleted: "Historical unverified Completed",
  attendanceReview: "Attendance Review",
  other: "No verified final outcome",
});
export function safeParticipant(person) {
  if (!person || typeof person !== "object") return "Unavailable";
  const name = formatFullName(person);
  // Historical names may predate validation. Reject links/credentials/identifiers rather than printing them.
  return name.length <= 242 && /^[\p{L}\p{M} .’'\-]+$/u.test(name)
    ? name
    : "Unavailable";
}
export function buildReport(rows, filters, generatedAt) {
  const summary = {
    total: rows.length,
    status: Object.fromEntries(APPOINTMENT_STATUSES.map((value) => [value, 0])),
    attendance: Object.fromEntries(
      Object.values(attendanceLabels).map((value) => [value, 0]),
    ),
    mode: { Online: 0, "Face-to-Face": 0, Unavailable: 0 },
  };
  const records = rows.map((row) => {
    const status = APPOINTMENT_STATUSES.includes(row.status)
      ? row.status
      : LEGACY_APPOINTMENT_STATUSES.includes(row.status)
        ? `Legacy: ${row.status}`
        : "Legacy: Unknown";
    const attendance = attendanceLabels[attendanceClassification(row)];
    const mode = ["Online", "Face-to-Face"].includes(row.consultationMode)
      ? row.consultationMode
      : "Unavailable";
    summary.status[status] = (summary.status[status] || 0) + 1;
    summary.attendance[attendance]++;
    summary.mode[mode]++;
    return {
      student: safeParticipant(row.student),
      faculty: safeParticipant(row.faculty),
      createdAt: row.createdAt,
      startAt: row.startAt,
      endAt: row.endAt,
      mode,
      status,
      attendance,
    };
  });
  return { records, summary, filters, generatedAt };
}
export async function loadReportData(input, actor, includeParticipants = false) {
  if (actor?.role !== "dean" || actor.accountStatus !== "Active") fail(403);
  const { filter, filters } = parseReportFilters(input);
  // Same deployment boundary as DEA-11: this database contains authorized SOC records only.
  const rows = await Appointment.aggregate([
    { $match: filter },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: REPORT_LIMIT + 1 },
    {
      $project: {
        _id: 0,
        ...(includeParticipants && { student: 1, faculty: 1 }),

        createdAt: 1,
        startAt: 1,
        endAt: 1,
        status: 1,
        consultationMode: 1,
        "attendance.finalOutcome": 1,
        "attendance.finalizationSource": 1,
      },
    },
  ]).option({ maxTimeMS: 10000 });
  if (rows.length > REPORT_LIMIT) fail(413);
  return { rows, filters, summary: buildReport(rows, filters, new Date()).summary };
}
