import mongoose from "mongoose";
import User from "../models/User.js";
import StudentAvailability from "../models/StudentAvailability.js";
import { createAppointmentRequest } from "./appointmentTransitionService.js";

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max + 1) : "";
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function searchEligibleStudents({ faculty, input = {} }) {
  if (!faculty || Object.keys(input).some(key => key !== "q")) fail("Invalid Student search.");
  const q = clean(input.q, 80);
  if (q.length < 2) return { students: [] };
  const pattern = new RegExp(escapeRegex(q), "i");
  const rows = await User.find({ role: "student", accountStatus: "Active", registrationStatus: "Approved",
    $or: [{ name: pattern }, { firstName: pattern }, { middleName: pattern }, { lastName: pattern }, { studentId: pattern }, { institutionalId: pattern }],
  }).select("name studentId institutionalId").sort({ name: 1, _id: 1 }).limit(10).lean();
  return { students: rows.map(row => ({ id: String(row._id), name: row.name,
    institutionalId: row.studentId || row.institutionalId || "Not available" })) };
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
  const activeAvailability = await StudentAvailability.find({ student: student._id, isActive: true, endAt: { $gt: now } })
    .select("startAt endAt").lean();
  if (activeAvailability.length && !activeAvailability.some(period => period.startAt <= startAt && period.endAt >= endAt))
    fail("The proposed schedule is outside the Student's published availability.", 409);
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
