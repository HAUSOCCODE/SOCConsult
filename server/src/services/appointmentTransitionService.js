import mongoose from "mongoose";
import crypto from "node:crypto";
import Appointment from "../models/Appointment.js";
import AttendanceResponse from "../models/AttendanceResponse.js";
import Availability from "../models/Availability.js";
import OneTimeScheduleHold from "../models/OneTimeScheduleHold.js";
import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import { lockProviderSchedules } from "./providerSchedulingLock.js";
import { attendanceEnrollment } from "../config/attendance.js";
import { BLOCKING_STATUSES, TRANSITION_RULES } from "../config/appointmentStatus.js";
import { safeReason, scheduleSnapshot, statusHistoryEntry } from "./appointmentHistoryService.js";
import { appointmentEvent, bestEffortStudentConsultationEmail, createStudentConsultationNotification } from "./consultationNotificationService.js";

const fail = (message, statusCode = 409, code = "APPOINTMENT_TRANSITION_BLOCKED") => {
  throw Object.assign(new Error(message), { statusCode, code });
};
const idOf = (value) => String(value?._id || value?.id || value || "");
const date = (value) => value == null ? NaN : new Date(value).getTime();
const proposalFields = ["proposedAvailability", "proposedStartAt", "proposedEndAt", "proposedConsultationMode", "proposedLocation", "proposedMeetingPlatform", "proposedMeetingLink", "proposalNote", "proposedAt", "proposedBy"];

export function assertTransition({ appointment, action, actor, now = new Date(), reason = "", expectedProposalAt, hasAttendanceResponse = false }) {
  const rule = TRANSITION_RULES[action];
  if (!rule || !rule.from.includes(appointment.status)) fail("This status transition is not allowed.");
  if (actor.management) fail("Dean management access is read-only.", 403);
  if (["propose", "accept_proposal"].includes(action) && appointment.attendance &&
    (appointment.attendance.studentResponded || appointment.attendance.facultyResponded ||
      date(now) >= date(appointment.attendance.attendanceOpensAt)))
    fail("Attendance has opened; this consultation cannot be rescheduled.");
  const student = actor.role === "student" && idOf(appointment.student) === idOf(actor.id);
  const faculty = ["faculty", "dean"].includes(actor.role) && idOf(appointment.faculty) === idOf(actor.id);
  if (!(rule.actor === "system" ? actor.role === "system" && !actor.id
    : rule.actor === "student" ? student : rule.actor === "faculty" ? faculty : student || faculty))
    fail("Unauthorized for this appointment action.", 403);
  if (["reject", "propose"].includes(action) && !safeReason(reason)) fail("A decision reason is required.", 400);
  if (action === "cancel") {
    if (hasAttendanceResponse || appointment.attendance?.studentResponded || appointment.attendance?.facultyResponded ||
      date(now) >= date(appointment.attendance?.attendanceOpensAt))
      fail("Attendance has opened or a response exists; this consultation cannot be cancelled.");
    if (faculty && !safeReason(reason)) fail("A cancellation reason is required.", 400);
    const unscheduled = appointment.bookingMethod === "schedule_request" && appointment.status === "Pending" && appointment.startAt == null;
    if (!unscheduled && !(date(appointment.startAt) > date(now))) fail("This consultation has already started or has no valid schedule.");
  }
  if (action === "confirm" && appointment.startAt != null && !(date(appointment.startAt) > date(now)))
    fail("This consultation has already started.");
  if (action === "propose" && appointment.status === "Confirmed" && !(date(appointment.startAt) > date(now)))
    fail("An appointment that has started or passed cannot be rescheduled.");
  if (action.endsWith("_proposal")) {
    if (!expectedProposalAt || date(expectedProposalAt) !== date(appointment.proposedAt)) fail("This proposal changed. Refresh and try again.");
  }
  if (action === "expire" && !(Number.isFinite(date(appointment.startAt)) && date(appointment.startAt) <= date(now)))
    fail("Only a scheduled Pending request at its start deadline can expire.");
  return rule.to;
}

function validSchedule(schedule, now) {
  if (!(date(schedule.startAt) > date(now)) || !(date(schedule.endAt) > date(schedule.startAt))) fail("Choose a valid future schedule.", 400);
  const duration = (date(schedule.endAt) - date(schedule.startAt)) / 60000;
  if (duration < 5 || duration > 1440 || !Number.isInteger(duration)) fail("Invalid consultation duration.", 400);
  if (!["Online", "Face-to-Face"].includes(schedule.mode)) fail("Choose a valid consultation mode.", 400);
  if (schedule.mode === "Face-to-Face" && (!schedule.location?.trim() || schedule.location.length > 150)) fail("Enter a valid location.", 400);
  if (schedule.mode === "Online") {
    if (!schedule.meetingPlatform?.trim() || schedule.meetingPlatform.length > 100) fail("Enter a valid meeting platform.", 400);
    if (schedule.meetingLink) {
      let url;
      try { url = new URL(schedule.meetingLink); } catch { fail("Invalid meeting link.", 400); }
      if (!["http:", "https:"].includes(url.protocol) || schedule.meetingLink.length > 500) fail("Invalid meeting link.", 400);
    }
  }
}

async function conflicts(appointment, schedule, session) {
  const overlap = { _id: { $ne: appointment._id }, status: { $in: BLOCKING_STATUSES },
    startAt: { $lt: schedule.endAt }, endAt: { $gt: schedule.startAt },
    $or: [{ faculty: appointment.faculty }, { student: appointment.student }] };
  if (await Appointment.exists(overlap).session(session)) fail("The schedule conflicts with an active consultation.");
  if (await OneTimeScheduleHold.exists({ appointment: { $ne: appointment._id },
    minute: { $gte: Math.floor(date(schedule.startAt) / 60000), $lt: Math.ceil(date(schedule.endAt) / 60000) },
    $or: [{ faculty: appointment.faculty }, { student: appointment.student }] }).session(session))
    fail("The schedule conflicts with a one-time consultation.");
}

async function release(appointment, session, releaseHolds = true) {
  if (appointment.availability && appointment.reservationToken)
    await Availability.updateOne({ _id: appointment.availability, reservationToken: appointment.reservationToken },
      { $unset: { reservationToken: 1 } }, { session });
  if (releaseHolds) await OneTimeScheduleHold.deleteMany({ appointment: appointment._id }, { session });
}

async function reserve(appointment, schedule, session) {
  // A shared minute lock prevents races between published and custom schedules.
  const first = Math.floor(date(schedule.startAt) / 60000), last = Math.ceil(date(schedule.endAt) / 60000);
  // Reuse owned minutes during confirmation/overlapping reschedules. Deleting and
  // reinserting the same unique key inside a MongoDB transaction is unsafe.
  await OneTimeScheduleHold.bulkWrite(Array.from({ length: last - first }, (_, index) => ({
    updateOne: { filter: { appointment: appointment._id, faculty: appointment.faculty,
      student: appointment.student, minute: first + index },
    update: { $set: { expiresAt: schedule.endAt } }, upsert: true },
  })), { session, ordered: true });
  await OneTimeScheduleHold.deleteMany({ appointment: appointment._id,
    $or: [{ minute: { $lt: first } }, { minute: { $gte: last } }] }, { session });
  if (schedule.availability) {
    if (await Appointment.exists({ availability: schedule.availability, _id: { $ne: appointment._id },
      status: { $in: BLOCKING_STATUSES } }).session(session)) fail("This slot already has an active consultation request.");
    const owned = idOf(schedule.availability) === idOf(appointment.availability) && appointment.reservationToken;
    const token = owned || crypto.randomUUID();
    const slot = await Availability.findOneAndUpdate({ _id: schedule.availability, faculty: appointment.faculty,
      isActive: true, startAt: schedule.startAt, endAt: schedule.endAt,
      ...(owned ? { reservationToken: appointment.reservationToken } : { reservationToken: { $exists: false } }),
    }, { $set: { reservationToken: token } }, { new: true, session });
    if (!slot) fail("This schedule is no longer available.");
    return token;
  }
  return undefined;
}

export const safeAppointment = (record, role) => {
  const result = record.toObject ? record.toObject() : { ...record };
  delete result.reservationToken; delete result.proposedMeetingLink;
  delete result.decisionLock; delete result.decisionLockAt;
  delete result.attendance;
  if (role === "student" && !["Confirmed", "Completed"].includes(result.status)) delete result.meetingLink;
  return result;
};

async function events({ appointment, from, to, actor, action, reason, now, session, transitionVersion }) {
  await AuditLog.create([{
    subjectUser: appointment.student, subjectRole: "student",
    subjectUsers: [appointment.student, appointment.faculty],
    actorUser: actor.id || undefined, actorRole: actor.role, action: `appointment_${action}`,
    category: "Appointment", description: "Appointment status changed",
    relatedEntityType: "Appointment", relatedEntityId: appointment._id,
    changes: { before: { status: from }, after: { status: to } },
    metadata: { source: action }, createdAt: now,
  }], { session });
  if (actor.role === "student") {
    const targetUser = await User.findById(appointment.faculty).select("role").session(session);
    await Notification.create([{ recipient: appointment.faculty, type: "appointment", category: "Consultation",
      title: action === "request" ? "Consultation Request Submitted" : action.endsWith("_proposal") ? "Reschedule Response Recorded" : `Consultation ${to}`,
      message: action === "request" ? "A Student submitted a consultation request." : `The consultation status is now ${to}.`,
      relatedEntityId: appointment._id,
      actionUrl: targetUser?.role === "dean" ? "/dean/faculty/consultations" : "/faculty/appointments" }], { session });
  }
  const event = appointmentEvent(action);
  if (event) await createStudentConsultationNotification({ student: appointment.student, appointmentId: appointment._id, event, session, transitionVersion });
}

export async function transitionAppointment({ id, actor, action, reason = "", schedule: inputSchedule, availabilityId,
  expectedProposalAt, expectedVersion, expectedUpdatedAt, now = new Date(), bookingMethod }) {
  if (!mongoose.isValidObjectId(id)) fail("Invalid appointment ID.", 400);
  reason = safeReason(reason);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      let schedule = inputSchedule;
      const appointment = await Appointment.findOne({ _id: id,
        ...(actor.role === "student" ? { student: actor.id } : actor.role === "system" ? {} : { faculty: actor.id }),
      })
        .select("+reservationToken +meetingLink +proposedMeetingLink +attendance").session(session);
      if (!appointment) fail("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
      // Includes proposals, confirmations, acceptance and reservation releases.
      // A stale transaction snapshot retries when this provider write conflicts.
      await lockProviderSchedules([appointment.faculty], session);
      if (action === "expire" && appointment.status !== "Pending")
        fail("This appointment changed.", 409, "APPOINTMENT_CONCURRENT_CHANGE");
      if (bookingMethod && appointment.bookingMethod !== bookingMethod) fail("Appointment not found.", 404);
      if (expectedVersion != null && expectedVersion !== appointment.__v) fail("This appointment changed. Refresh and try again.", 409, "APPOINTMENT_CONCURRENT_CHANGE");
      if (expectedUpdatedAt != null && date(expectedUpdatedAt) !== date(appointment.updatedAt)) fail("This appointment changed. Refresh and try again.", 409, "APPOINTMENT_CONCURRENT_CHANGE");
      const hasAttendanceResponse = action === "cancel" && Boolean(await AttendanceResponse.exists({ appointment: appointment._id }).session(session));
      const to = assertTransition({ appointment, actor, action, reason, expectedProposalAt, now, hasAttendanceResponse });
      const last = appointment.statusHistory?.at(-1);
      if (last && !Number.isFinite(date(last.changedAt))) fail("Appointment history requires manual review.");
      const changedAt = new Date(Math.max(date(now), Number.isFinite(date(last?.changedAt)) ? date(last.changedAt) + 1 : 0));
      const set = { status: to, responseNote: reason }, unset = {}, push = {};
      if (action === "propose" || action === "confirm") {
        if (action === "confirm" && appointment.availability && availabilityId && idOf(availabilityId) !== idOf(appointment.availability))
          fail("A changed schedule requires a Student proposal response.");
        if (action === "confirm" && appointment.bookingMethod !== "schedule_request" && schedule)
          fail("A changed schedule requires a Student proposal response.");
        if (availabilityId || (!schedule && appointment.availability)) {
          const slot = await Availability.findOne({ _id: availabilityId || appointment.availability,
            faculty: appointment.faculty, isActive: true }).select("+meetingLink +reservationToken").session(session);
          if (!slot) fail("Select a valid future availability schedule.");
          // Confirmation must not silently adopt an edited published schedule.
          if (action === "confirm" && appointment.startAt &&
            (date(slot.startAt) !== date(appointment.startAt) || date(slot.endAt) !== date(appointment.endAt))) fail("The booked schedule changed.");
          schedule = { startAt: slot.startAt, endAt: slot.endAt, mode: slot.mode,
            location: slot.location, meetingPlatform: slot.meetingPlatform, meetingLink: slot.meetingLink, availability: slot._id };
        }
        if (action === "confirm" && !schedule && appointment.currentScheduleSource === "faculty_assigned")
          schedule = { startAt: appointment.startAt, endAt: appointment.endAt, mode: appointment.consultationMode,
            location: appointment.location, meetingPlatform: appointment.meetingPlatform, meetingLink: appointment.meetingLink };
        if (!schedule) fail("Assign a consultation schedule.", 400);
        validSchedule(schedule, now);
        await conflicts(appointment, schedule, session);
      }
      if (action === "propose") {
        if (!reason) fail("A proposal reason is required.", 400);
        if (date(schedule.startAt) === date(appointment.startAt) && date(schedule.endAt) === date(appointment.endAt)) fail("The proposed schedule must differ from the current schedule.");
        Object.assign(set, { proposedStartAt: schedule.startAt, proposedEndAt: schedule.endAt,
          proposedConsultationMode: schedule.mode, proposedLocation: schedule.location || "",
          proposedMeetingPlatform: schedule.meetingPlatform || "", proposedMeetingLink: schedule.meetingLink || "",
          proposedAt: changedAt, proposedBy: actor.id, proposalNote: reason });
        if (schedule.availability) set.proposedAvailability = schedule.availability;
        else unset.proposedAvailability = 1;
        // Original schedule and reservation stay intact until acceptance/cancellation.
      }
      if (action.endsWith("_proposal")) {
        const next = scheduleSnapshot(appointment, true), previous = scheduleSnapshot(appointment);
        if (!next || !["Online", "Face-to-Face"].includes(next.mode)) fail("This reschedule proposal is incomplete.", 400);
        push.scheduleHistory = { previous: previous || undefined, previousScheduleUnavailable: !previous, next,
          reason: safeReason(appointment.proposalNote || "Faculty schedule proposal"),
          initiatedByRole: "Faculty", initiatedBy: appointment.proposedBy || appointment.faculty,
          createdAt: appointment.proposedAt, respondedAt: changedAt, respondedBy: actor.id,
          response: action === "accept_proposal" ? "Accepted" : "Rejected" };
        for (const field of proposalFields) unset[field] = 1;
        if (action === "accept_proposal") schedule = { startAt: appointment.proposedStartAt, endAt: appointment.proposedEndAt,
          mode: appointment.proposedConsultationMode, location: appointment.proposedLocation,
          meetingPlatform: appointment.proposedMeetingPlatform, meetingLink: appointment.proposedMeetingLink,
          availability: appointment.proposedAvailability };
      }
      if (action === "confirm" || action === "accept_proposal") {
        if (action === "accept_proposal" && schedule.availability) {
          const slot = await Availability.findOne({ _id: schedule.availability, faculty: appointment.faculty,
            isActive: true }).select("+meetingLink +reservationToken").session(session);
          if (!slot || date(slot.startAt) !== date(schedule.startAt) || date(slot.endAt) !== date(schedule.endAt) ||
            slot.mode !== schedule.mode || (slot.location || "") !== (schedule.location || "") ||
            (slot.meetingPlatform || "") !== (schedule.meetingPlatform || "") ||
            (slot.meetingLink || "") !== (schedule.meetingLink || "")) fail("The proposed slot changed. Request a new reschedule proposal.");
        }
        validSchedule(schedule, now);
        set.attendance = attendanceEnrollment(schedule.endAt);
        if (action === "accept_proposal") await conflicts(appointment, schedule, session);
        const sameSlot = schedule.availability && idOf(schedule.availability) === idOf(appointment.availability);
        if (!sameSlot) await release(appointment, session, false);
        const token = await reserve(appointment, schedule, session);
        Object.assign(set, { startAt: schedule.startAt, endAt: schedule.endAt, consultationMode: schedule.mode,
          currentScheduleSource: schedule.availability ? "published_slot" : "faculty_assigned",
          estimatedDurationMinutes: Math.round((date(schedule.endAt) - date(schedule.startAt)) / 60000),
          location: schedule.mode === "Face-to-Face" ? schedule.location : "",
          meetingPlatform: schedule.mode === "Online" ? schedule.meetingPlatform : "",
          meetingLink: schedule.mode === "Online" ? schedule.meetingLink || "" : "" });
        if (schedule.availability) { set.availability = schedule.availability; set.reservationToken = token; }
        else { unset.availability = 1; unset.reservationToken = 1; }
      }
      if (["cancel", "reject", "expire"].includes(action)) {
        await release(appointment, session);
        unset.reservationToken = 1;
        if (action === "cancel") {
          Object.assign(set, { cancellationReason: reason, cancelledBy: actor.id,
            cancelledByRole: actor.role[0].toUpperCase() + actor.role.slice(1), cancelledAt: changedAt });
          if (appointment.status === "Reschedule Proposed") {
            const previous = scheduleSnapshot(appointment), next = scheduleSnapshot(appointment, true);
            if (!next) fail("This proposal requires repair before cancellation.");
            push.scheduleHistory = { previous: previous || undefined, previousScheduleUnavailable: !previous, next,
              reason: safeReason(appointment.proposalNote || "Faculty schedule proposal"), initiatedByRole: "Faculty",
              initiatedBy: appointment.proposedBy || appointment.faculty, createdAt: appointment.proposedAt,
              response: "Cancelled", respondedAt: changedAt, respondedBy: actor.id };
            for (const field of proposalFields) unset[field] = 1;
          }
        }
        if (action === "expire") set.expirationReason = "faculty_response_deadline_passed";
      }
      push.statusHistory = statusHistoryEntry({ from: appointment.status, to, actor, action,
        reason: action === "expire" ? "faculty_response_deadline_passed" : reason, now: changedAt });
      result = await Appointment.findOneAndUpdate({ _id: appointment._id, status: appointment.status,
        __v: appointment.__v == null ? { $exists: false } : appointment.__v,
        updatedAt: appointment.updatedAt,
        ...(action.endsWith("_proposal") && { proposedAt: appointment.proposedAt }),
      }, { $set: set, ...(Object.keys(unset).length && { $unset: unset }), $push: push, $inc: { __v: 1 } },
      { new: true, runValidators: true, session });
      if (!result) fail("This appointment changed. Refresh and try again.", 409, "APPOINTMENT_CONCURRENT_CHANGE");
      await events({ appointment, from: appointment.status, to, actor, action,
        reason: action === "expire" ? "faculty_response_deadline_passed" : reason, now: changedAt, session, transitionVersion: result.__v });
    });
  } catch (error) {
    if (error.code === 11000) fail("The schedule conflicts with another active request.");
    throw error;
  } finally { await session.endSession(); }
  const event = appointmentEvent(action);
  if (event) await bestEffortStudentConsultationEmail({ student: result.student, appointmentId: result._id, event });
  return safeAppointment(result, actor.role);
}

export async function createAppointmentRequest({ data, actor, now = new Date() }) {
  if (actor.role !== "student" || idOf(data.student) !== idOf(actor.id)) fail("Only the owning Student can book.", 403);
  const session = await mongoose.startSession();
  const requestId = data._id || new mongoose.Types.ObjectId();
  let appointment;
  try {
    await session.withTransaction(async () => {
      await lockProviderSchedules([data.faculty], session);
      const record = { ...data, _id: requestId, status: "Pending", __v: 0 };
      delete record.reservationToken;
      if (record.bookingMethod !== "schedule_request") {
        const slot = await Availability.findOne({ _id: record.availability, faculty: record.faculty,
          isActive: true, reservationToken: { $exists: false } }).select("+meetingLink +reservationToken").session(session);
        if (!slot || !(date(slot.startAt) > date(now))) fail("This schedule is no longer available.");
        // Do not book an edited time after the Student selected the old schedule.
        if (date(slot.startAt) !== date(record.startAt) || date(slot.endAt) !== date(record.endAt))
          fail("This schedule changed. Refresh and choose a schedule again.");
        Object.assign(record, { startAt: slot.startAt, endAt: slot.endAt, consultationMode: slot.mode,
          location: slot.mode === "Face-to-Face" ? slot.location : "",
          meetingPlatform: slot.mode === "Online" ? slot.meetingPlatform : "",
          estimatedDurationMinutes: Math.round((date(slot.endAt) - date(slot.startAt)) / 60000) });
        record.currentScheduleSource = "published_slot";
        const schedule = { startAt: record.startAt, endAt: record.endAt, mode: record.consultationMode,
          location: record.location, meetingPlatform: record.meetingPlatform, meetingLink: slot.meetingLink, availability: record.availability };
        validSchedule(schedule, now);
        await conflicts(record, schedule, session);
        record.reservationToken = await reserve(record, schedule, session);
      }
      record.statusHistory = [statusHistoryEntry({ from: "Created", to: "Pending", actor, action: "request", now })];
      [appointment] = await Appointment.create([record], { session });
      await events({ appointment, from: "Created", to: "Pending", actor, action: "request", now, session, transitionVersion: 0 });
    });
  } catch (error) {
    if (error.code === 11000) fail("An active consultation request already exists.");
    throw error;
  } finally { await session.endSession(); }
  await bestEffortStudentConsultationEmail({ student: appointment.student, appointmentId: appointment._id, event: "request_submitted" });
  return safeAppointment(appointment, actor.role);
}
