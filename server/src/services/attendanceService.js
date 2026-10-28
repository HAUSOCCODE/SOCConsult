import { createEventNotification } from "./notificationService.js";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import AttendanceResponse, { assertAttendanceIndexes } from "../models/AttendanceResponse.js";
import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";
import { ATTENDANCE_POLICY, ATTENDANCE_OUTCOMES, RESPONSE_WINDOW_MS } from "../config/attendance.js";
import { safeReason, statusHistoryEntry } from "./appointmentHistoryService.js";
import { participation, participantAttendance } from "./attendancePrivacyService.js";
import { ATTENDANCE_TRANSITIONS } from "../config/appointmentStatus.js";
import { bestEffortFacultyConsultationEmail, bestEffortStudentConsultationEmail,
  createFacultyConsultationNotification, createStudentConsultationNotification } from "./consultationNotificationService.js";

const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
export function validAttendance(row) {
  const a = row.attendance;
  return a?.policyVersion === ATTENDANCE_POLICY && row.endAt != null &&
    Number.isFinite(new Date(row.endAt).getTime()) && new Date(row.endAt) > new Date(row.startAt) &&
    +new Date(a.attendanceOpensAt) === +new Date(row.endAt) &&
    +new Date(a.responseDeadlineAt) === +new Date(row.endAt) + RESPONSE_WINDOW_MS;
}
export function attendanceDecision(responses, deadlinePassed) {
  if (responses.length === 2) return responses[0].outcome === responses[1].outcome
    ? { status: "Completed", finalOutcome: responses[0].outcome }
    : { status: "Attendance Review", reviewReason: "responses_conflict", missingRoles: [] };
  if (!deadlinePassed) return null;
  const missingRoles = ["student", "faculty"].filter(role => !responses.some(r => r.participantRole === role));
  return { status: "Attendance Review", reviewReason: missingRoles.length === 2 ? "both_responses_missing" : `${missingRoles[0]}_response_missing`, missingRoles };
}
async function audit(row, actor, action, session, now, before, after) {
  await AuditLog.create([{ subjectUser: row.student, subjectRole: "student", subjectUsers: [row.student, row.faculty],
    actorUser: actor.id || undefined, actorRole: actor.role, action, category: "Appointment",
    description: "Attendance workflow event", relatedEntityType: "Appointment", relatedEntityId: row._id,
    changes: before ? { before: { status: before }, after: { status: after } } : undefined,
    metadata: { source: action }, createdAt: now }], { session });
}
async function transition(row, to, session, now) {
  if (!ATTENDANCE_TRANSITIONS[row.status]?.includes(to)) fail("Attendance transition is unavailable.");
  const from = row.status, action = to === "Awaiting Attendance Update" ? "attendance_open" : to === "Completed" ? "attendance_finalize" : "attendance_review";
  const last = row.statusHistory?.at(-1)?.changedAt;
  if (last && !Number.isFinite(+new Date(last))) fail("Appointment history requires review.");
  const timestamp = new Date(Math.max(+now, last ? +new Date(last) + 1 : 0));
  (row.statusHistory ||= []).push(statusHistoryEntry({ from, to, actor: { role: "system" }, action, now: timestamp }));
  row.status = to;
  await audit(row, { role: "system" }, action, session, timestamp, from, to);
  if (to === "Attendance Review") {
    const deans = await User.find({ role: "dean", accountStatus: "Active" }).select("_id").session(session).lean();
    for (const dean of deans) await createEventNotification({ recipient: dean._id, event: "attendance_review_created", relatedEntityId: row._id,
      actionUrl: `/dean/attendance-review/${row._id}`, key: String(row._id), session });
  }
  const event = to === "Awaiting Attendance Update" ? "attendance_update_required"
    : to === "Completed" ? "finalized" : "attendance_review";
  const facultyEvent = to === "Awaiting Attendance Update" ? "faculty_attendance_update_required"
    : to === "Completed" ? "faculty_finalized" : "faculty_attendance_review";
  await createStudentConsultationNotification({ student: row.student, appointmentId: row._id, event, session });
  await createFacultyConsultationNotification({ faculty: row.faculty, appointmentId: row._id, event: facultyEvent, session });
  return { studentEvent: event, facultyEvent };
}
export async function readAttendance({ id, actor, now = new Date() }) {
  if (!mongoose.isValidObjectId(id)) fail("Invalid appointment reference.", 400);
  const row = await Appointment.findById(id).select("student faculty status startAt endAt +attendance").lean();
  if (!row || !participation(row, actor)) fail("Appointment not found.", 404);
  // Read only the author's private reason; never fetch the counterpart's reason.
  const responses = await AttendanceResponse.find({ appointment: id }).lean();
  const own = await AttendanceResponse.findOne({ appointment: id, participant: actor.id }).select("+reason").lean();
  return participantAttendance(row, responses.map(r => String(r.participant) === String(actor.id) ? own || r : r), participation(row, actor), now);
}
export async function processAttendance({ id, actor, input, now = new Date() }) {
  if (!mongoose.isValidObjectId(id)) fail("Invalid appointment reference.", 400);
  const submitting = input !== undefined;
  if (submitting && (!input || Object.keys(input).some(k => !["outcome", "reason"].includes(k)) || !ATTENDANCE_OUTCOMES.includes(input.outcome))) fail("Invalid attendance response.", 400);
  if (submitting && input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 500)) fail("Reason must be text of 500 characters or fewer.", 400);
  const reason = submitting ? safeReason(input.reason ?? "") : "";
  await assertAttendanceIndexes();
  const session = await mongoose.startSession();
  let changed = false;
  const studentEmailEvents = new Set();
  const facultyEmailEvents = new Set();
  let studentId, facultyId;
  try {
    await session.withTransaction(async () => {
      changed = false;
      const row = await Appointment.findById(id).select("+attendance").session(session).lean();
      if (row) { studentId = row.student; facultyId = row.faculty; }
      const role = submitting && row ? participation(row, actor) : null;
      if (submitting && (!row || !role)) fail("Appointment not found.", 404);
      if (!row || !validAttendance(row) || !["Confirmed", "Awaiting Attendance Update"].includes(row.status)) {
        if (submitting) fail("Attendance submission is unavailable.");
        return;
      }
      if (now < new Date(row.endAt)) { if (submitting) fail("Attendance has not opened."); return; }
      const deadlinePassed = now >= new Date(row.attendance.responseDeadlineAt);
      if (submitting && deadlinePassed) fail("The attendance response deadline has passed.");
      const responses = await AttendanceResponse.find({ appointment: id }).session(session).lean();
      if (submitting && responses.some(r => r.participantRole === role)) fail("Your attendance response has already been submitted.");
      const originalStatus = row.status;
      if (row.status === "Confirmed") {
        const events = await transition(row, "Awaiting Attendance Update", session, now);
        studentEmailEvents.add(events.studentEvent); facultyEmailEvents.add(events.facultyEvent);
      }
      if (submitting) {
        const [response] = await AttendanceResponse.create([{ appointment: row._id, participant: actor.id,
          participantRole: role, outcome: input.outcome, reason, submittedAt: now, policyVersion: row.attendance.policyVersion }], { session });
        responses.push(response);
        row.attendance[`${role}Responded`] = true;
        await audit(row, actor, "attendance_response_submitted", session, now);
        if (role === "student") {
          await createStudentConsultationNotification({ student: row.student, appointmentId: row._id,
            event: "attendance_response_received", session });
          await createFacultyConsultationNotification({ faculty: row.faculty, appointmentId: row._id,
            event: "faculty_student_attendance_submitted", session });
          studentEmailEvents.add("attendance_response_received");
          facultyEmailEvents.add("faculty_student_attendance_submitted");
        }
      }
      const decision = attendanceDecision(responses, deadlinePassed);
      if (decision) {
        if (decision.status === "Completed") Object.assign(row.attendance, { finalOutcome: decision.finalOutcome, finalizedAt: now, finalizationSource: "participant_agreement" });
        else Object.assign(row.attendance, { finalOutcome: null, reviewReason: decision.reviewReason, missingRoles: decision.missingRoles, reviewStartedAt: now });
        const events = await transition(row, decision.status, session, now);
        studentEmailEvents.add(events.studentEvent); facultyEmailEvents.add(events.facultyEvent);
      }
      if (!submitting && row.status === originalStatus) return;
      const updated = await Appointment.findOneAndUpdate({ _id: row._id, status: originalStatus,
        __v: row.__v == null ? { $exists: false } : row.__v, updatedAt: row.updatedAt },
      { $set: { status: row.status, attendance: row.attendance, statusHistory: row.statusHistory }, $inc: { __v: 1 } }, { session, runValidators: true, new: true });
      if (!updated) throw Object.assign(new Error("Appointment changed. Please retry."), { statusCode: 409, code: "APPOINTMENT_CONCURRENT_CHANGE" });
      changed = true;
    });
  } catch (error) {
    if (error.code === 11000) fail("Your attendance response has already been submitted.");
    throw error;
  } finally { await session.endSession(); }
  for (const event of studentEmailEvents) if (event) await bestEffortStudentConsultationEmail({ student: studentId, appointmentId: id, event });
  for (const event of facultyEmailEvents) if (event) await bestEffortFacultyConsultationEmail({ faculty: facultyId, appointmentId: id, event });
  return changed;
}
