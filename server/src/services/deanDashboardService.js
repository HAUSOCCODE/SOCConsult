import { attendanceCounts } from "./attendanceReportingService.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import AccountImport from "../models/AccountImport.js";
import { formatFullName } from "./personNameService.js";

const DAY = 86400000;
const OFFSET = 8 * 3600000;
export function parseDashboardRange(query = {}, now = new Date()) {
  let { start, end } = query;
  if (start === undefined && end === undefined) {
    const local = new Date(now.getTime() + OFFSET);
    start = `${local.toISOString().slice(0, 7)}-01`;
    end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
  }
  const parse = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return NaN;
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === value
      ? time
      : NaN;
  };
  const first = parse(start),
    last = parse(end);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last < first ||
    (last - first) / DAY + 1 > 366
  )
    return null;
  return {
    range: {
      start,
      end,
      timezone: "Asia/Manila",
      basis: "createdAt",
      label: `${start} to ${end} (Asia/Manila)`,
    },
    filter: {
      createdAt: {
        $gte: new Date(first - OFFSET),
        $lt: new Date(last + DAY - OFFSET),
      },
    },
  };
}

export async function readDeanDashboard(parsed, now = new Date()) {
  // This deployment's database contains only authorized School of Computing records.
  // Optional program fields cannot reliably identify school membership.
  const active = {
    accountStatus: "Active",
    registrationStatus: { $in: ["Approved", null] },
  };
  const [activeStudents, activeFaculty, counts, imports, appointments] =
    await Promise.all([
      User.countDocuments({ ...active, role: "student" }).maxTimeMS(10000),
      User.countDocuments({ ...active, role: "faculty" }).maxTimeMS(10000),
      Appointment.aggregate([
        { $match: parsed.filter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] },
            },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
            },
          },
        },
      ]).option({ maxTimeMS: 10000 }),
      AccountImport.find({
        status: "completed",
        importedAt: { $type: "date" },
        successfulRows: { $gte: 0 },
        failedRows: { $gte: 0 },
      })
        .select("previewId importedAt successfulRows failedRows status")
        .sort({ importedAt: -1, _id: -1 })
        .limit(5)
        .maxTimeMS(10000)
        .lean(),
      Appointment.find(parsed.filter)
        .select("subject status startAt updatedAt student faculty")
        .sort({ updatedAt: -1, _id: -1 })
        .limit(5)
        .maxTimeMS(10000)
        .populate({
          path: "student faculty",
          select: "name firstName middleName lastName",
          options: { maxTimeMS: 10000 },
        })
        .lean(),
    ]);
  const summary = counts[0];
  return {
    range: parsed.range,
    accounts: { activeStudents, activeFaculty, asOf: now.toISOString() },
    consultations: {
      total: summary?.total ?? 0,
      attendanceSummary: await attendanceCounts(parsed.filter),
      byStatus: {
        pending: summary?.pending ?? 0,
        completed: summary?.completed ?? 0,
      },
    },
    recentImports: imports.map((batch) => ({
      importId: batch.previewId,
      completedAt: batch.importedAt,
      successfulRows: batch.successfulRows,
      failedRows: batch.failedRows,
      status: batch.status,
    })),
    recentConsultations: appointments.map((record) => ({
      reference: String(record._id),
      studentName: record.student ? formatFullName(record.student) : null,
      facultyName: record.faculty ? formatFullName(record.faculty) : null,
      subject: record.subject,
      status: record.status,
      scheduledAt: record.startAt ?? null,
      updatedAt: record.updatedAt,
    })),
    limits: { recentImports: 5, recentConsultations: 5 },
  };
}
