import Appointment from "../models/Appointment.js";
import Availability from "../models/Availability.js";
import SupportingDocument from "../models/SupportingDocument.js";
import Task from "../models/Task.js";
import { APPOINTMENT_STATUSES, getDateRangeFilter } from "./aiReportingService.js";
import { STUDENT_TERMINAL_STATUSES } from "./appointmentClassificationService.js";

const ACTIVE_STATUSES = ["Approved", "Rescheduled"];
const UPCOMING_STATUSES = ["Pending", "Approved", "Rescheduled", "Needs Reschedule"];
const MANILA_FORMAT = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
});
const TIME_FORMAT = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true,
});

const safeId = (value) => {
  if (!value) throw Object.assign(new Error("Authenticated user is required."), { code: "AI_AUTH_CONTEXT_REQUIRED" });
  return value;
};
const documentCount = (appointment, linked = 0) =>
  linked + (appointment.supportingDocument?.name ? 1 : 0) +
  (Array.isArray(appointment.supportingDocuments) ? appointment.supportingDocuments.length : 0);
const safeAppointment = (appointment, { includeStudent = false, linkedDocuments = 0 } = {}) => ({
  ...(includeStudent ? { student: appointment.student?.name || "Student" } : {}),
  ...(appointment.faculty?.name ? { faculty: appointment.faculty.name } : {}),
  subject: appointment.subject,
  status: appointment.status,
  dateTime: MANILA_FORMAT.format(appointment.startAt),
  time: `${TIME_FORMAT.format(appointment.startAt)} – ${TIME_FORMAT.format(appointment.endAt)}`,
  mode: appointment.consultationMode,
  ...(appointment.location ? { location: appointment.location } : {}),
  supportingDocuments: documentCount(appointment, linkedDocuments),
});
async function linkedCounts(appointments) {
  if (!appointments.length) return new Map();
  const rows = await SupportingDocument.aggregate([
    { $match: { appointment: { $in: appointments.map((item) => item._id) } } },
    { $group: { _id: "$appointment", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}
async function safeAppointments(filter, { limit = 10, includeStudent = false, sort = 1 } = {}) {
  const rows = await Appointment.find(filter)
    .select("student faculty subject status startAt endAt consultationMode location supportingDocument.name supportingDocuments")
    .populate(includeStudent ? "student" : "faculty", "name")
    .sort({ endAt: sort, startAt: sort }).limit(limit).lean();
  const counts = await linkedCounts(rows);
  return rows.map((row) => safeAppointment(row, {
    includeStudent, linkedDocuments: counts.get(String(row._id)) || 0,
  }));
}
async function statusSummary(owner, ownerId) {
  const rows = await Appointment.aggregate([
    { $match: { [owner]: ownerId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(APPOINTMENT_STATUSES.map((status) => [status, rows.find((row) => row._id === status)?.count || 0]));
}

export async function getMyStudentAppointmentSummary(_args = {}, context = {}) {
  const student = safeId(context.userId);
  const [statuses, upcoming] = await Promise.all([
    statusSummary("student", student),
    Appointment.countDocuments({ student, status: { $in: UPCOMING_STATUSES }, endAt: { $gt: context.now || new Date() } }),
  ]);
  return { statuses, upcoming };
}
export async function getMyUpcomingAppointments(_args = {}, context = {}) {
  const student = safeId(context.userId);
  const appointments = await safeAppointments({ student, status: { $in: UPCOMING_STATUSES }, endAt: { $gt: context.now || new Date() } });
  return { count: appointments.length, appointments, limited: appointments.length === 10 };
}
export async function getMyNextAppointment(_args = {}, context = {}) {
  const student = safeId(context.userId);
  const appointments = await safeAppointments({ student, status: { $in: ACTIVE_STATUSES }, endAt: { $gt: context.now || new Date() } }, { limit: 1 });
  return { appointment: appointments[0] || null };
}
export async function getMyNeedsRescheduleAppointments(_args = {}, context = {}) {
  const student = safeId(context.userId);
  const appointments = await safeAppointments({ student, status: "Needs Reschedule", endAt: { $gt: context.now || new Date() } });
  return { count: appointments.length, appointments };
}
export async function getMyConsultationHistorySummary(_args = {}, context = {}) {
  const student = safeId(context.userId);
  const now = context.now || new Date();
  const appointments = await safeAppointments({ student, $or: [{ status: { $in: STUDENT_TERMINAL_STATUSES } }, { endAt: { $lte: now } }] }, { sort: -1 });
  const totalCompleted = await Appointment.countDocuments({ student, status: "Completed" });
  return { totalCompleted, recentHistory: appointments, limited: appointments.length === 10 };
}
export async function getMyActionItemsSummary(_args = {}, context = {}) {
  const student = safeId(context.userId);
  const tasks = await Task.find({ student }).select("title description status dueAt -_id").sort({ status: -1, dueAt: 1 }).limit(20).lean();
  return { pending: tasks.filter((task) => task.status === "Pending").length, completed: tasks.filter((task) => task.status === "Completed").length, items: tasks.map((task) => ({ title: task.title, status: task.status, ...(task.dueAt ? { due: MANILA_FORMAT.format(task.dueAt) } : {}) })), limited: tasks.length === 20 };
}
export async function getMyFacultyAppointmentSummary(_args = {}, context = {}) {
  const faculty = safeId(context.userId);
  return { statuses: await statusSummary("faculty", faculty) };
}
export async function getMyUpcomingFacultyAppointments(_args = {}, context = {}) {
  const faculty = safeId(context.userId);
  const appointments = await safeAppointments({ faculty, status: { $in: ACTIVE_STATUSES }, startAt: { $gte: context.now || new Date() } }, { includeStudent: true });
  return { count: appointments.length, appointments, limited: appointments.length === 10 };
}
export async function getMyCurrentOrNextConsultation(_args = {}, context = {}) {
  const faculty = safeId(context.userId); const now = context.now || new Date();
  const current = await safeAppointments({ faculty, status: { $in: ACTIVE_STATUSES }, startAt: { $lte: now }, endAt: { $gt: now } }, { limit: 1, includeStudent: true });
  if (current[0]) return { current: current[0], next: null };
  const next = await safeAppointments({ faculty, status: { $in: ACTIVE_STATUSES }, startAt: { $gte: now } }, { limit: 1, includeStudent: true });
  return { current: null, next: next[0] || null };
}
export async function getMyPendingAppointmentRequests(_args = {}, context = {}) {
  const faculty = safeId(context.userId);
  const appointments = await safeAppointments({ faculty, status: "Pending" }, { includeStudent: true });
  return { count: await Appointment.countDocuments({ faculty, status: "Pending" }), requests: appointments, limited: appointments.length === 10 };
}
export async function getMyAvailabilitySummary(_args = {}, context = {}) {
  const faculty = safeId(context.userId); const now = context.now || new Date();
  const tomorrow = getDateRangeFilter("today", new Date(now.getTime() + 86400000)).startAt;
  const [activeUpcoming, tomorrowCount] = await Promise.all([
    Availability.countDocuments({ faculty, isActive: true, endAt: { $gt: now } }),
    Availability.countDocuments({ faculty, isActive: true, startAt: { $gte: tomorrow.$gte, $lt: tomorrow.$lt } }),
  ]);
  return { activeUpcoming, tomorrow: tomorrowCount };
}
export async function getMyConsultationWorkload(_args = {}, context = {}) {
  const faculty = safeId(context.userId);
  const filter = getDateRangeFilter("this_week", context.now || new Date());
  const [scheduled, completed, pending] = await Promise.all([
    Appointment.countDocuments({ faculty, status: { $in: ACTIVE_STATUSES }, ...filter }),
    Appointment.countDocuments({ faculty, status: "Completed", ...filter }),
    Appointment.countDocuments({ faculty, status: "Pending", ...filter }),
  ]);
  return { period: "this week (Asia/Manila)", scheduled, completed, pendingRequests: pending };
}

export const studentAiTools = Object.freeze({ getMyStudentAppointmentSummary, getMyUpcomingAppointments, getMyNextAppointment, getMyNeedsRescheduleAppointments, getMyConsultationHistorySummary, getMyActionItemsSummary });
export const facultyAiTools = Object.freeze({ getMyFacultyAppointmentSummary, getMyUpcomingFacultyAppointments, getMyCurrentOrNextConsultation, getMyPendingAppointmentRequests, getMyAvailabilitySummary, getMyConsultationWorkload });
