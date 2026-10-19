import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import AttendanceResponse from "../models/AttendanceResponse.js";
import Notification from "../models/Notification.js";
import { ATTENDANCE_POLICY, RESPONSE_WINDOW_MS } from "../config/attendance.js";
import { getDateRangeFilter } from "./calendarRangeService.js";
import { categoryExpression, notificationProjection, publicNotification } from "./notificationService.js";
import { formatFullName } from "./personNameService.js";

const TIMEOUT = 10000;
const projection = "student subject status startAt endAt consultationMode createdAt";
const todayStatuses = ["Confirmed", "Awaiting Attendance Update", "Completed", "Attendance Review"];
const personalDestinations = ["/faculty/appointments", "/faculty/consultations", "/faculty/requests", "/faculty/history",
  "/dean/faculty/consultations", "/dean/faculty/requests", "/dean/faculty/history"];
const summary = row => row ? { _id: row._id, subject: row.subject, status: row.status,
  startAt: row.startAt ?? null, endAt: row.endAt ?? null, consultationMode: row.consultationMode,
  studentName: row.student ? formatFullName(row.student) : null, createdAt: row.createdAt } : null;
const list = (filter, sort, limit) => Appointment.find(filter).select(projection)
  .populate({ path: "student", select: "name firstName middleName lastName", options: { maxTimeMS: TIMEOUT } })
  .sort(sort).limit(limit).maxTimeMS(TIMEOUT).lean();

export async function readFacultyDashboard(user, now = new Date()) {
  const owned = { faculty: user.id };
  const facultyId = new mongoose.Types.ObjectId(user.id);
  const pending = { ...owned, status: "Pending" };
  const upcoming = { ...owned, status: "Confirmed", startAt: { $gt: now }, endAt: { $gt: now } };
  const today = { ...owned, status: { $in: todayStatuses }, ...getDateRangeFilter("today", now) };
  const [pendingCount, upcomingCount, attendance, next, todayTotal, todayRows, requests, notices] = await Promise.all([
    Appointment.countDocuments(pending).maxTimeMS(TIMEOUT),
    Appointment.countDocuments(upcoming).maxTimeMS(TIMEOUT),
    // Count authoritative response absence without fetching response content or unbounded candidate lists.
    Appointment.aggregate([
      { $match: { faculty: facultyId, status: { $in: ["Confirmed", "Awaiting Attendance Update"] },
        "attendance.policyVersion": ATTENDANCE_POLICY, startAt: { $type: "date" }, endAt: { $type: "date", $lte: now },
        "attendance.responseDeadlineAt": { $gt: now },
        $expr: { $and: [{ $gt: ["$endAt", "$startAt"] },
          { $eq: ["$attendance.attendanceOpensAt", "$endAt"] },
          { $eq: ["$attendance.responseDeadlineAt", { $add: ["$endAt", RESPONSE_WINDOW_MS] }] }] } } },
      { $lookup: { from: AttendanceResponse.collection.name, let: { appointmentId: "$_id" }, pipeline: [
        { $match: { participant: facultyId, participantRole: "faculty", $expr: { $eq: ["$appointment", "$$appointmentId"] } } },
        { $project: { _id: 1 } }, { $limit: 1 },
      ], as: "ownResponse" } },
      { $match: { "ownResponse.0": { $exists: false } } }, { $count: "count" },
    ]).option({ maxTimeMS: TIMEOUT }),
    list(upcoming, { startAt: 1, _id: 1 }, 1),
    Appointment.countDocuments(today).maxTimeMS(TIMEOUT),
    list(today, { startAt: 1, _id: 1 }, 10),
    list(pending, { createdAt: -1, _id: -1 }, 5),
    // FAC-15: notification-center workspace filtering remains separate. Recheck these
    // destinations/categories when FAC-11–20 adds producers or changes personal routes.
    Notification.find({ recipient: user.id, type: { $nin: ["task", "attendance_review_created", "ai_summary_failed"] },
      $expr: { $in: [categoryExpression, ["Consultation", "Attendance"]] },
      actionUrl: { $in: user.role === "dean" ? personalDestinations : personalDestinations.filter(path => path.startsWith("/faculty/")) } })
      .select(notificationProjection).sort({ createdAt: -1, _id: -1 }).limit(5).maxTimeMS(TIMEOUT).lean(),
  ]);
  return { asOf: now.toISOString(), pendingCount, upcomingCount, attendanceRequiredCount: attendance[0]?.count ?? 0,
    nextConsultation: summary(next[0]), todayTotal, todayConsultations: todayRows.map(summary),
    recentRequests: requests.map(summary), recentNotifications: notices.map(row => {
      const page = row.actionUrl.split("/").at(-1);
      const actionUrl = `${user.role === "dean" ? "/dean/faculty" : "/faculty"}/${page === "appointments" ? "consultations" : page}`;
      const safe = publicNotification({ ...row, actionUrl }, user);
      return { _id: safe._id, title: safe.title, message: safe.message, isRead: safe.isRead,
        createdAt: safe.createdAt, actionUrl: safe.actionUrl };
    }) };
}
