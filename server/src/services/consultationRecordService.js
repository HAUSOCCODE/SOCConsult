import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import AuditLog from "../models/AuditLog.js";
import ConsultationRecord, { CONSULTATION_NOTES_LIMIT, CONSULTATION_RECOMMENDATIONS_LIMIT } from "../models/ConsultationRecord.js";

const ELIGIBLE_STATUSES = Object.freeze(["Confirmed", "Awaiting Attendance Update", "Attendance Review", "Completed", "Expired"]);
const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };
const id = value => String(value?._id || value || "");

const publicRecord = record => record ? {
  appointmentId: id(record.appointment),
  notes: record.notes || "",
  recommendations: record.recommendations || "",
  author: record.facultyAuthor ? { name: record.facultyAuthor.name || "Assigned consultant" } : { name: "Assigned consultant" },
  dateRecorded: record.createdAt,
  updatedAt: record.updatedAt,
  version: record.__v,
} : null;

const access = (appointment, actor) => {
  const student = actor.role === "student" && id(appointment.student) === id(actor.id);
  const consultant = ["faculty", "dean"].includes(actor.role) && !actor.management && id(appointment.faculty) === id(actor.id);
  return { student, consultant };
};

const eligible = (appointment, now) => ELIGIBLE_STATUSES.includes(appointment.status) &&
  Number.isFinite(+new Date(appointment.endAt)) && +now >= +new Date(appointment.endAt);

const validateInput = input => {
  if (!input || Array.isArray(input) || typeof input !== "object" ||
    Object.keys(input).some(key => !["notes", "recommendations", "expectedVersion"].includes(key))) fail("Invalid consultation record.", 400);
  for (const [field, limit] of [["notes", CONSULTATION_NOTES_LIMIT], ["recommendations", CONSULTATION_RECOMMENDATIONS_LIMIT]])
    if (input[field] !== undefined && (typeof input[field] !== "string" || input[field].length > limit)) fail(`Invalid ${field}.`, 400);
  if (input.expectedVersion !== undefined && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)) fail("Invalid record version.", 400);
  const notes = (input.notes || "").trim(), recommendations = (input.recommendations || "").trim();
  if (!notes && !recommendations) fail("Add consultation notes or recommendations.", 400);
  return { notes, recommendations, expectedVersion: input.expectedVersion };
};

export async function readConsultationRecord({ appointmentId, actor, now = new Date() }) {
  if (!mongoose.isValidObjectId(appointmentId)) fail("Consultation not found.", 404);
  const appointment = await Appointment.findById(appointmentId).select("student faculty status endAt").lean();
  if (!appointment) fail("Consultation not found.", 404);
  const allowed = access(appointment, actor);
  if (!allowed.student && !allowed.consultant) fail("Consultation not found.", 404);
  const record = await ConsultationRecord.findOne({ appointment: appointmentId }).populate("facultyAuthor", "name").lean();
  return { record: publicRecord(record), canEdit: allowed.consultant && eligible(appointment, now),
    availableAfter: appointment.endAt, consultationEnded: Number.isFinite(+new Date(appointment.endAt)) && +now >= +new Date(appointment.endAt) };
}

export async function saveConsultationRecord({ appointmentId, actor, input, now = new Date() }) {
  if (!mongoose.isValidObjectId(appointmentId)) fail("Consultation not found.", 404);
  const value = validateInput(input);
  const session = await mongoose.startSession();
  let saved;
  try {
    await session.withTransaction(async () => {
      const appointment = await Appointment.findById(appointmentId).select("student faculty status endAt").session(session).lean();
      if (!appointment || !access(appointment, actor).consultant) fail("Consultation not found.", 404);
      if (!eligible(appointment, now)) fail(+now < +new Date(appointment.endAt) ? "Consultation notes are available after the scheduled consultation." : "Consultation record is unavailable.", 409);
      const existing = await ConsultationRecord.findOne({ appointment: appointmentId }).session(session).lean();
      const action = existing ? "consultation_record_updated" : "consultation_record_created";
      if (existing) {
        if (value.expectedVersion !== existing.__v) fail("The consultation record changed. Reload it before saving.", 409);
        saved = await ConsultationRecord.findOneAndUpdate({ _id: existing._id, __v: existing.__v },
          { $set: { notes: value.notes, recommendations: value.recommendations, updatedAt: now }, $inc: { __v: 1 } },
          { new: true, runValidators: true, session }).populate("facultyAuthor", "name").lean();
        if (!saved) fail("The consultation record changed. Reload it before saving.", 409);
      } else {
        if (value.expectedVersion !== undefined) fail("The consultation record changed. Reload it before saving.", 409);
        [saved] = await ConsultationRecord.create([{ appointment: appointment._id, facultyAuthor: actor.id,
          notes: value.notes, recommendations: value.recommendations, createdAt: now, updatedAt: now }], { session });
        saved = await ConsultationRecord.findById(saved._id).populate("facultyAuthor", "name").session(session).lean();
      }
      await AuditLog.create([{ subjectUser: appointment.student, subjectRole: "student", subjectUsers: [appointment.student, appointment.faculty],
        actorUser: actor.id, actorRole: actor.role, action, category: "Consultation",
        relatedEntityType: "Appointment", relatedEntityId: appointment._id }], { session });
    });
  } catch (error) {
    if (error?.code === 11000) fail("The consultation record changed. Reload it before saving.", 409);
    throw error;
  } finally { await session.endSession(); }
  return { record: publicRecord(saved), canEdit: true, consultationEnded: true };
}

export { ELIGIBLE_STATUSES };
