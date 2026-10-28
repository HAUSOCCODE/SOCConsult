import { countRequiredAttendance } from "./attendanceRequiredService.js";
import Appointment from "../models/Appointment.js";
import Notification from "../models/Notification.js";
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
  const pending = { ...owned, status: "Pending" };
  const upcoming = { ...owned, status: "Confirmed", startAt: { $gt: now }, endAt: { $gt: now } };
  const today = { ...owned, status: { $in: todayStatuses }, ...getDateRangeFilter("today", now) };
  const [pendingCount, upcomingCount, attendance, next, todayTotal, todayRows, requests, notices] = await Promise.all([
    Appointment.countDocuments(pending).maxTimeMS(TIMEOUT),
    Appointment.countDocuments(upcoming).maxTimeMS(TIMEOUT),
    countRequiredAttendance(user.id, "faculty", now),
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
  return { asOf: now.toISOString(), pendingCount, upcomingCount, attendanceRequiredCount: attendance,
    nextConsultation: summary(next[0]), todayTotal, todayConsultations: todayRows.map(summary),
    recentRequests: requests.map(summary), recentNotifications: notices.map(row => {
      const safe = publicNotification(row, user);
      return { _id: safe._id, title: safe.title, message: safe.message, isRead: safe.isRead,
        createdAt: safe.createdAt, actionUrl: safe.actionUrl };
    }) };
}
