import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import AttendanceResponse from "../models/AttendanceResponse.js";
import AttendanceReview, { assertReviewIndex } from "../models/AttendanceReview.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import Notification from "../models/Notification.js";
import { REVIEW_ACTIONS } from "../config/attendanceReview.js";
import { REVIEW_REASONS } from "../config/attendance.js";
import { safeReason, statusHistoryEntry } from "./appointmentHistoryService.js";
import { validAttendance } from "./attendanceService.js";
import { consultationDetails, consultationFilterOptions, listRecord, parseConsultationQuery, validRecordId } from "./deanConsultationService.js";

const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
const requireDean = actor => { if (actor?.role !== "dean" || actor.management !== true || actor.accountStatus !== "Active") fail("Dean management access required.", 403); };
const validId = id => { if (!validRecordId(id)) fail("Invalid appointment reference.", 400); };
export function parseReviewQuery(query = {}) {
  if (Object.keys(query).some(key => !["start", "end", "studentId", "facultyId", "reviewReason", "page", "limit", "sort"].includes(key))) fail("Invalid review filters.", 400);
  const { reviewReason, ...rest } = query;
  const parsed = parseConsultationQuery(rest);
  if (reviewReason !== undefined && !REVIEW_REASONS.includes(reviewReason)) fail("Invalid review trigger.", 400);
  if (parsed.filter.createdAt) { parsed.filter["attendance.reviewStartedAt"] = parsed.filter.createdAt; delete parsed.filter.createdAt; }
  parsed.filter.status = "Attendance Review";
  if (reviewReason) parsed.filter["attendance.reviewReason"] = reviewReason;
  parsed.filters.reviewReason = reviewReason || "";
  parsed.sort = { "attendance.reviewStartedAt": query.sort === "oldest" ? 1 : -1, _id: query.sort === "oldest" ? 1 : -1 };
  return parsed;
}
export async function listReviews(query, actor) {
  requireDean(actor);
  const parsed = parseReviewQuery(query);
  const [result] = await Appointment.aggregate([{ $match: parsed.filter }, { $facet: {
    count: [{ $count: "total" }], records: [{ $sort: parsed.sort }, { $skip: (parsed.page - 1) * parsed.limit }, { $limit: parsed.limit },
      { $project: { student: 1, faculty: 1, subject: 1, startAt: 1, endAt: 1, consultationMode: 1, status: 1,
        "attendance.reviewReason": 1, "attendance.reviewStartedAt": 1 } }],
  } }]).option({ maxTimeMS: 10000 });
  const rows = await Appointment.populate(result?.records || [], { path: "student faculty", select: "name firstName middleName lastName", options: { maxTimeMS: 10000 } });
  const total = result?.count?.[0]?.total || 0;
  return { reviews: rows.map(row => {
    const safe = listRecord(row);
    return { recordId: safe.recordId, studentName: safe.studentName, facultyName: safe.facultyName, subject: safe.subject,
      startAt: safe.startAt, endAt: safe.endAt, mode: safe.mode, reviewReason: row.attendance?.reviewReason,
      reviewStartedAt: row.attendance?.reviewStartedAt, state: "Unresolved" };
  }), pagination: { page: parsed.page, limit: parsed.limit, total, totalPages: Math.ceil(total / parsed.limit) }, filters: parsed.filters };
}
export async function reviewOptions(query, actor) { requireDean(actor); return consultationFilterOptions(query); }
export async function reviewDetails(id, actor) {
  requireDean(actor); validId(id);
  const row = await Appointment.findById(id).select("status __v +attendance").maxTimeMS(10000).lean();
  if (!row || !(row.status === "Attendance Review" || row.status === "Completed" && row.attendance?.finalizationSource === "dean_review")) fail("Review not found.", 404);
  const { consultation } = await consultationDetails(id);
  const responses = await AttendanceResponse.find({ appointment: id }).select("+reason").maxTimeMS(10000).lean();
  const actions = await AttendanceReview.find({ appointment: id }).select("+reason").sort({ reviewedAt: 1, _id: 1 }).maxTimeMS(10000).lean();
  const current = await Appointment.findById(id).select("status __v").maxTimeMS(10000).lean();
  if (!current || current.__v !== row.__v || current.status !== row.status) fail("This review changed while loading. Refresh the details.");
  return { review: { ...consultation, status: row.status, attendance: consultation.attendance, version: row.__v,
    state: row.status === "Attendance Review" ? "Unresolved" : "Resolved",
    responses: Object.fromEntries(["student", "faculty"].map(role => {
      const response = responses.find(item => item.participantRole === role);
      return [role, response ? { responseId: String(response._id), outcome: response.outcome, reason: response.reason || "", submittedAt: response.submittedAt } : null];
    })),
    actions: actions.map(action => ({ reviewId: String(action._id), deanId: String(action.dean), action: action.action, reason: action.reason,
      reviewedAt: action.reviewedAt, previousStatus: action.previousStatus, resultingStatus: action.resultingStatus,
      finalOutcome: action.finalOutcome, isFinal: action.isFinal })),
  } };
}
export async function submitReview({ id, actor, input, now = new Date() }) {
  requireDean(actor); validId(id);
  if (!input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some(key => !["action", "reason", "expectedVersion"].includes(key)) ||
    typeof input.action !== "string" || !Object.hasOwn(REVIEW_ACTIONS, input.action) || typeof input.reason !== "string" || input.reason.length > 500 ||
    !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) fail("Invalid review action, reason, or version.", 400);
  const reason = safeReason(input.reason);
  if (!reason) fail("A resolution reason is required.", 400);
  await assertReviewIndex();
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = undefined;
      const dean = await User.findById(actor.id).select("role accountStatus").session(session);
      if (dean?.role !== "dean" || dean.accountStatus !== "Active") fail("Active Dean required.", 403);
      const row = await Appointment.findById(id).select("+attendance").session(session).lean();
      if (!row) fail("Review not found.", 404);
      if (row.status !== "Attendance Review" || row.__v !== input.expectedVersion || row.attendance?.finalOutcome != null || row.attendance?.finalizedAt ||
        await AttendanceReview.exists({ appointment: id, isFinal: true }).session(session)) fail("This review changed or was resolved. Refresh before continuing.");
      if (!validAttendance(row) || !REVIEW_REASONS.includes(row.attendance.reviewReason) || row.attendance.reviewStartedAt == null || !Number.isFinite(+new Date(row.attendance.reviewStartedAt))) fail("Attendance data requires investigation.");
      const responses = await AttendanceResponse.find({ appointment: id }).session(session).lean();
      for (const role of ["student", "faculty"]) {
        const matches = responses.filter(response => response.participantRole === role);
        if (matches.length > 1 || matches.some(response => String(response.participant) !== String(row[role]) || response.policyVersion !== row.attendance.policyVersion)) fail("Attendance data requires investigation.");
      }
      if (responses.length > 2 || responses.some(response => !["student", "faculty"].includes(response.participantRole))) fail("Attendance data requires investigation.");
      const last = row.statusHistory?.at(-1)?.changedAt;
      if (last && !Number.isFinite(+new Date(last))) fail("Appointment history requires investigation.");
      const reviewedAt = new Date(Math.max(+now, +new Date(row.attendance.reviewStartedAt), last ? +new Date(last) + 1 : 0));
      const finalOutcome = REVIEW_ACTIONS[input.action], isFinal = finalOutcome !== null;
      const status = isFinal ? "Completed" : "Attendance Review";
      const set = { status };
      if (isFinal) set.attendance = { ...row.attendance, finalOutcome, finalizedAt: reviewedAt, finalizationSource: "dean_review" };
      const updated = await Appointment.findOneAndUpdate({ _id: row._id, status: "Attendance Review", __v: input.expectedVersion, updatedAt: row.updatedAt },
        { $set: set, $inc: { __v: 1 }, ...(isFinal && { $push: { statusHistory: statusHistoryEntry({ from: row.status, to: status, actor,
          action: "attendance_review_resolved", reason: "Attendance record reviewed by Dean.", now: reviewedAt }) } }) }, { session, runValidators: true, new: true });
      if (!updated) fail("This review changed. Refresh before continuing.");
      const [review] = await AttendanceReview.create([{ appointment: id, dean: actor.id, action: input.action, reason, reviewedAt,
        previousStatus: row.status, resultingStatus: status, finalOutcome, isFinal, appointmentVersion: input.expectedVersion,
        studentResponse: responses.find(response => response.participantRole === "student")?._id || null,
        facultyResponse: responses.find(response => response.participantRole === "faculty")?._id || null }], { session });
      await AuditLog.create([{ subjectUser: row.student, subjectRole: "student", subjectUsers: [row.student, row.faculty],
        actorUser: actor.id, actorRole: "dean", action: isFinal ? "attendance_review_resolved" : "attendance_review_retained", category: "Appointment",
        description: "Dean attendance review action recorded", relatedEntityType: "Appointment", relatedEntityId: row._id,
        changes: { before: { status: row.status }, after: { status, finalOutcome } }, metadata: { reviewId: String(review._id), action: input.action }, createdAt: reviewedAt }], { session });
      if (isFinal) {
        const faculty = await User.findById(row.faculty).select("role").session(session);
        await Notification.create([{ recipient: row.student, actionUrl: "/student/consultations" },
          { recipient: row.faculty, actionUrl: faculty?.role === "dean" ? "/dean/faculty/consultations" : "/faculty/appointments" }]
          .map(target => ({ ...target, type: "appointment", title: "Attendance Record Reviewed", relatedEntityId: row._id,
            message: `The attendance record was reviewed. Recorded outcome: ${finalOutcome}.` })), { session });
      }
      result = { reviewId: String(review._id), status, finalOutcome, version: updated.__v, state: isFinal ? "Resolved" : "Unresolved" };
    });
  } catch (error) { if (error.code === 11000) fail("This review was already resolved. Refresh before continuing."); throw error; }
  finally { await session.endSession(); }
  return result;
}
