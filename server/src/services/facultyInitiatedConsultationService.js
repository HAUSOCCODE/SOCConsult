import mongoose from "mongoose";
import User from "../models/User.js";
import { createAppointmentRequest } from "./appointmentTransitionService.js";

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max + 1) : "";
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function searchEligibleStudents({ faculty, input = {} }) {
  if (!faculty || Object.keys(input).some(key => !["q", "page"].includes(key))) fail("Invalid Student search.");
  const q = clean(input.q, 80);
  if (q && q.length < 2) fail("Enter at least two search characters.");
  const pageValue = input.page ?? "1";
  if (typeof pageValue !== "string" || !/^[1-9]\d*$/.test(pageValue) || +pageValue > 10000) fail("Invalid Student search.");
  const page = +pageValue, limit = 12;
  const filter = { role: "student", accountStatus: "Active", registrationStatus: "Approved" };
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ name: pattern }, { firstName: pattern }, { middleName: pattern }, { lastName: pattern },
      { program: pattern }, { yearLevel: pattern }, { studentId: pattern }, { institutionalId: pattern }];
  }
  const [rows, total] = await Promise.all([
    User.find(filter).select("name program yearLevel studentId institutionalId").sort({ name: 1, _id: 1 })
      .skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter).maxTimeMS(10000),
  ]);
  return { students: rows.map(row => ({ id: String(row._id), name: row.name,
    program: row.program || undefined, yearLevel: row.yearLevel || undefined,
    institutionalId: row.studentId || row.institutionalId || "Not available" })),
  pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function createFacultyInitiatedConsultation({ actor, input, now = new Date() }) {
  if (!["faculty", "dean"].includes(actor.role) || !actor.id || actor.management) fail("Unauthorized.", 403);
  const allowed = ["studentId", "subject", "reason", "startAt", "endAt", "mode", "location", "meetingPlatform", "meetingLink"];
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail("Invalid consultation request.");
  if (!mongoose.isValidObjectId(input.studentId)) fail("Select an eligible Student.");
  const student = await User.findOne({ _id: input.studentId, role: "student", accountStatus: "Active", registrationStatus: "Approved" })
    .select("_id yearLevel").lean();
  if (!student) fail("Selected Student is unavailable.", 404);
  const subject = clean(input.subject, 150), reason = clean(input.reason, 1000);
  if (!subject || subject.length > 150) fail("Enter a valid consultation subject.");
  if (!reason || reason.length > 1000) fail("Enter a valid consultation reason.");
  const startAt = new Date(input.startAt), endAt = new Date(input.endAt);
  if (!Number.isFinite(+startAt) || !Number.isFinite(+endAt)) fail("Choose a valid consultation schedule.");
  const mode = input.mode;
  const location = clean(input.location, 150), meetingPlatform = clean(input.meetingPlatform, 100);
  const meetingLink = clean(input.meetingLink, 500);
  return createAppointmentRequest({ actor, now, data: {
    student: student._id, faculty: actor.id, bookingMethod: "schedule_request", startAt, endAt,
    subject, reason, yearLevel: student.yearLevel, consultationMode: mode,
    location: mode === "Face-to-Face" ? location : "",
    meetingPlatform: mode === "Online" ? meetingPlatform : "",
    meetingLink: mode === "Online" ? meetingLink : "",
  } });
}
