import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import AttendanceResponse from "../models/AttendanceResponse.js";
import { APPOINTMENT_STATUSES, TERMINAL_STATUSES } from "../config/appointmentStatus.js";
import { facultyRequestDetails } from "./facultyRequestService.js";
import { readAttendance } from "./attendanceService.js";
import { assertTransition } from "./appointmentTransitionService.js";
import { initiatorReportingRole } from "../config/attendance.js";

export const SECTIONS = ["All", "Sent Requests", "Upcoming", "Pending", "Reschedule Proposed", "Awaiting Attendance Update", "Attendance Review", "Recently Finalized", "Compatibility"];
const fail = code => { throw Object.assign(new Error("Consultation unavailable."), { statusCode: code }); };
const stamp = value => value == null ? NaN : +new Date(value);
export const validSchedule = row => Number.isFinite(stamp(row.startAt)) && stamp(row.endAt) > stamp(row.startAt);
export function sectionFor(row, now) {
  if (row.status === "Pending" || row.status === "Reschedule Proposed" || row.status === "Attendance Review") return row.status;
  if (row.status === "Awaiting Attendance Update") return row.status;
  if (row.status === "Confirmed" && validSchedule(row)) return stamp(row.endAt) > +now ? "Upcoming" : "Awaiting Attendance Update";
  if ([...TERMINAL_STATUSES, "No Show"].includes(row.status)) return "Recently Finalized";
  return "Compatibility";
}
export function parseConsultationQuery(input = {}) {
  if (Object.keys(input).some(key => !["section", "page"].includes(key))) fail(400);
  const section = input.section ?? "All", page = input.page ?? "1";
  if (!SECTIONS.includes(section) || typeof page !== "string" || !/^[1-9]\d*$/.test(page) || +page > 10000) fail(400);
  if (["Recently Finalized", "Compatibility"].includes(section) && page !== "1") fail(400);
  return { section, page: +page };
}
const validMeetingLink = value => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; }
  catch { return false; }
};
const safeDate = value => Number.isFinite(stamp(value)) ? value : null;
export function personalRecord(row) {
  return { _id: String(row._id), student: { name: typeof row.student?.name === "string" ? row.student.name : "Student unavailable" },
    subject: row.subject, status: row.status, startAt: safeDate(row.startAt), endAt: safeDate(row.endAt),
    consultationMode: row.consultationMode, createdAt: row.createdAt,
    initiatedByRole: row.initiatedByRole === "faculty" ? "faculty" : "student",
    attendanceWorkflow: initiatorReportingRole(row) ? "initiator_report" : "two_party" };
}
export async function listFacultyConsultations({ faculty, input, now = new Date() }) {
  const { section, page } = parseConsultationQuery(input);
  const valid = { $and: [{ $eq: [{ $type: "$startAt" }, "date"] }, { $eq: [{ $type: "$endAt" }, "date"] }, { $gt: ["$endAt", "$startAt"] }] };
  const branches = [
    ...["Pending", "Reschedule Proposed", "Awaiting Attendance Update", "Attendance Review"].map(status => ({ case: { $eq: ["$status", status] }, then: status })),
    { case: { $and: [{ $eq: ["$status", "Confirmed"] }, valid] }, then: { $cond: [{ $gt: ["$endAt", now] }, "Upcoming", "Awaiting Attendance Update"] } },
    { case: { $in: ["$status", [...TERMINAL_STATUSES, "No Show"]] }, then: "Recently Finalized" },
  ];
  const bounded = ["Recently Finalized", "Compatibility"].includes(section);
  const sort = section === "Upcoming" ? { startAt: 1, _id: 1 } : ["Pending", "Sent Requests"].includes(section) ? { unscheduled: 1, startAt: 1, createdAt: 1, _id: 1 }
    : section === "Reschedule Proposed" ? { proposedAt: -1, _id: -1 } : section === "Awaiting Attendance Update" ? { endAt: 1, _id: 1 }
      : section === "Attendance Review" ? { reviewSort: 1, _id: 1 } : { finalizedSort: -1, _id: -1 };
  const sectionMatch = section === "All" ? { personalSection: { $in: ["Pending", "Reschedule Proposed", "Upcoming", "Awaiting Attendance Update", "Attendance Review"] } }
    : section === "Sent Requests" ? { personalSection: "Pending", initiatedByRole: "faculty" }
      : { personalSection: section };
  const pipeline = [{ $match: { faculty: new mongoose.Types.ObjectId(faculty) } }, { $set: {
    personalSection: { $switch: { branches, default: "Compatibility" } },
    unscheduled: { $cond: [{ $eq: [{ $type: "$startAt" }, "date"] }, 0, 1] },
    reviewSort: { $ifNull: ["$attendance.reviewStartedAt", "$endAt"] },
    finalizedSort: { $ifNull: [{ $max: { $map: { input: { $filter: { input: { $ifNull: ["$statusHistory", []] }, as: "event", cond: { $in: ["$$event.newStatus", [...TERMINAL_STATUSES, "No Show"]] } } }, as: "event", in: "$$event.changedAt" } } }, "$attendance.finalizedAt", "$updatedAt", "$endAt", "$createdAt"] },
  } }, { $match: sectionMatch }, { $facet: {
    count: [{ $count: "total" }], records: [{ $sort: sort }, { $skip: (page - 1) * 20 }, { $limit: 20 },
      { $project: { student: 1, initiatedByRole: 1, subject: 1, status: 1, startAt: 1, endAt: 1, consultationMode: 1, createdAt: 1,
        "attendance.policyVersion": 1, "attendance.initiatorRole": 1, "attendance.studentResponded": 1,
        "attendance.facultyResponded": 1, "attendance.finalOutcome": 1, "attendance.finalizationSource": 1,
        "attendance.reviewReason": 1, "attendance.reviewStartedAt": 1 } }],
  } }];
  const [result] = await Appointment.aggregate(pipeline).option({ maxTimeMS: 10000 });
  const rows = await Appointment.populate(result?.records || [], { path: "student", select: "name" });
  const total = result?.count?.[0]?.total || 0;
  return { appointments: rows.map(personalRecord), section, asOf: now, pagination: { page, limit: 20, total, totalPages: bounded ? Math.min(1, Math.ceil(total / 20)) : Math.ceil(total / 20) } };
}
export function detailRecord(row, actor, now, hasAttendanceResponse = false) {
  const lifecycle = ["Confirmed", "Awaiting Attendance Update", "Attendance Review", "Completed"].includes(row.status);
  const history = (row.statusHistory || []).filter(event => Number.isFinite(stamp(event.changedAt))).slice().sort((a, b) => stamp(a.changedAt) - stamp(b.changedAt));
  const owned = String(row.faculty?._id || row.faculty) === String(actor.id) && ["faculty", "dean"].includes(actor.role) && !actor.management;
  const actions = {};
  for (const action of ["confirm", "reject", "propose", "cancel"]) {
    try { assertTransition({ appointment: row, actor, action, now, reason: "Eligibility check", hasAttendanceResponse }); actions[action] = Number.isInteger(row.__v); }
    catch { actions[action] = false; }
  }
  for (const action of ["accept_proposal", "reject_proposal"]) {
    try { assertTransition({ appointment: row, actor, action, now, expectedProposalAt: row.proposedAt, hasAttendanceResponse }); actions[action] = Number.isInteger(row.__v); }
    catch { actions[action] = false; }
  }
  return { ...personalRecord(row), estimatedDurationMinutes: validSchedule(row) ? Math.round((stamp(row.endAt) - stamp(row.startAt)) / 60000) : undefined, reason: row.reason, __v: row.__v, bookingMethod: row.bookingMethod,
    location: row.consultationMode === "Face-to-Face" ? row.location : null, meetingPlatform: row.meetingPlatform,
    meetingLink: owned && lifecycle && validSchedule(row) && row.consultationMode === "Online" && validMeetingLink(row.meetingLink) ? row.meetingLink : undefined,
    confirmedSchedule: validSchedule(row) && (lifecycle || history.some(event => event.newStatus === "Confirmed")),
    proposedStartAt: safeDate(row.proposedStartAt), proposedEndAt: safeDate(row.proposedEndAt), proposedConsultationMode: row.proposedConsultationMode,
    proposedLocation: row.proposedConsultationMode === "Face-to-Face" ? row.proposedLocation : null, proposedMeetingPlatform: row.proposedMeetingPlatform,
    statusHistory: history.map(event => ({ previousStatus: event.previousStatus, newStatus: event.newStatus, changedAt: event.changedAt, changedByRole: event.changedByRole,
      reason: ["confirm", "reject", "propose", "accept_proposal", "reject_proposal", "cancel", "request"].includes(event.source) ? event.reason : undefined })),
    actions: owned && sectionFor(row, now) !== "Compatibility" && APPOINTMENT_STATUSES.includes(row.status) ? actions : {},
  };
}
export async function facultyConsultationDetails({ faculty, id, input = {}, now = new Date(), actor }) {
  if (Object.keys(input).length) fail(400);
  if (!/^[a-f\d]{24}$/i.test(id)) fail(404);
  const row = await Appointment.findOne({ _id: id, faculty }).select("student faculty initiatedByRole subject reason status startAt endAt consultationMode location meetingPlatform +meetingLink createdAt __v bookingMethod statusHistory proposedStartAt proposedEndAt proposedConsultationMode proposedLocation proposedMeetingPlatform proposedAt proposedBy +attendance").populate("student", "name").maxTimeMS(10000).lean();
  if (!row) fail(404);
  const metadata = await facultyRequestDetails({ faculty, id });
  const hasAttendanceResponse = Boolean(await AttendanceResponse.exists({ appointment: row._id }).maxTimeMS(10000));
  const appointment = detailRecord(row, actor, now, hasAttendanceResponse);
  appointment.supportingDocuments = metadata.appointment.supportingDocuments;
  appointment.supportingDocument = metadata.appointment.supportingDocument;
  appointment.attendance = await readAttendance({ id, actor, now });
  return { appointment, asOf: now };
}
