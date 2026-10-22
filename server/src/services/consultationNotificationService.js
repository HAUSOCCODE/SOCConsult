import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { env } from "../config/env.js";
import { sendEmail } from "./emailService.js";

export const STUDENT_CONSULTATION_EVENTS = Object.freeze({
  request_submitted: ["Consultation Request Submitted", "We received your consultation request.", false],
  confirmed: ["Consultation Confirmed", "Your consultation has been confirmed.", false],
  rejected: ["Consultation Rejected", "Your consultation request was rejected.", true],
  reschedule_proposed: ["Reschedule Proposed", "A new consultation schedule has been proposed. Review it in SOCConsult.", false],
  reschedule_response_recorded: ["Reschedule Response Recorded", "Your reschedule response has been recorded.", false],
  cancelled: ["Consultation Cancelled", "Your consultation was cancelled.", true],
  upcoming_reminder: ["Upcoming Consultation Reminder", "You have an upcoming confirmed consultation.", false],
  expired: ["Consultation Expired", "Your consultation request has expired.", true],
  attendance_update_required: ["Attendance Update Required", "Please submit your attendance response in SOCConsult.", false],
  attendance_response_received: ["Attendance Response Received", "Your attendance response has been recorded. The system will determine the final outcome.", false],
  attendance_review: ["Attendance Review", "Your consultation attendance record requires review.", true],
  finalized: ["Consultation Finalized", "Your consultation record has been finalized.", true],
});

export const FACULTY_CONSULTATION_EVENTS = Object.freeze({
  faculty_request_submitted: ["New consultation request", "A student submitted a new consultation request.", "requests"],
  faculty_proposal_accepted: ["Proposed schedule accepted", "The student accepted your proposed consultation schedule.", "consultations"],
  faculty_proposal_declined: ["Proposed schedule declined", "The student declined your proposed consultation schedule.", "requests"],
  faculty_cancelled: ["Consultation cancelled", "The student cancelled this consultation.", "history"],
  faculty_upcoming_reminder: ["Upcoming consultation reminder", "You have an upcoming confirmed consultation.", "consultations"],
  faculty_attendance_update_required: ["Attendance update required", "Attendance reporting is now available for this consultation.", "consultations"],
  faculty_student_attendance_submitted: ["Student attendance response submitted", "The student has submitted an attendance response.", "consultations"],
  faculty_finalized: ["Appointment finalized", "The attendance record was reviewed and finalized.", "history"],
  faculty_attendance_review: ["Attendance review required", "This attendance record requires review.", "history"],
  faculty_expired: ["Consultation expired", "The consultation request or attendance reporting period has expired.", "history"],
});

const id = value => String(value?._id || value?.id || value || "");
export function studentConsultationPath(appointmentId, historical = false) {
  const value = id(appointmentId);
  if (!/^[a-f\d]{24}$/i.test(value)) throw new Error("Invalid appointment reference.");
  return `/student/${historical ? "history" : "consultations"}?appointment=${value}`;
}
export function consultationEmailUrl(path) {
  if (!env.clientUrl || !/^\/student\/(?:consultations|history)\?appointment=[a-f\d]{24}$/i.test(path)) return undefined;
  return new URL(path, `${env.clientUrl.replace(/\/$/, "")}/`).toString();
}

export function facultyConsultationPath(appointmentId, destination = "consultations", dean = false) {
  const value = id(appointmentId);
  if (!/^[a-f\d]{24}$/i.test(value) || !["requests", "consultations", "history"].includes(destination))
    throw new Error("Invalid Faculty consultation destination.");
  return `${dean ? "/dean/faculty" : "/faculty"}/${destination}?appointment=${value}`;
}

export async function createFacultyConsultationNotification({ faculty, appointmentId, event, session, transitionVersion }) {
  const definition = FACULTY_CONSULTATION_EVENTS[event];
  if (!definition) throw new Error("Unsupported Faculty consultation notification event.");
  const relatedEntityId = appointmentId?._id || appointmentId;
  const user = await User.findById(faculty).select("role").session(session || null).lean();
  const recipientRole = user?.role === "dean" ? "dean" : "faculty";
  const [title, message] = definition;
  // Keep the canonical base destination stable for older notices. The authenticated UI
  // combines this trusted route, type, and related appointment into a deep link.
  const actionUrl = recipientRole === "dean" ? "/dean/faculty/consultations" : "/faculty/appointments";
  const data = { recipient: faculty, type: event,
    category: event.includes("attendance") || event === "faculty_finalized" ? "Attendance" : "Consultation",
    title, message, relatedEntityId, actionUrl,
    deduplicationKey: `${event}:${id(relatedEntityId)}${transitionVersion == null ? "" : `:v${transitionVersion}`}` };
  return Notification.create([data], { session });
}
export async function createStudentConsultationNotification({ student, appointmentId, event, session, transitionVersion }) {
  const definition = STUDENT_CONSULTATION_EVENTS[event];
  if (!definition) throw new Error("Unsupported consultation notification event.");
  const [title, message, historical] = definition;
  const relatedEntityId = appointmentId?._id || appointmentId;
  const actionUrl = studentConsultationPath(relatedEntityId, historical);
  const data = { recipient: student, type: event, category: event.startsWith("attendance_") || event === "finalized" ? "Attendance" : "Consultation",
    title, message, relatedEntityId, actionUrl, deduplicationKey: `${event}:${id(relatedEntityId)}${transitionVersion == null ? "" : `:v${transitionVersion}`}` };
  return Notification.create([data], { session });
}
export async function sendStudentConsultationEmail({ student, appointmentId, event }) {
  const definition = STUDENT_CONSULTATION_EVENTS[event];
  if (!definition) return false;
  const user = await User.findById(student).select("email").lean();
  const path = studentConsultationPath(appointmentId, definition[2]);
  const url = consultationEmailUrl(path);
  if (!user?.email || !url) return false;
  const [subject, message] = definition;
  const result = await sendEmail({ to: user.email, subject, text: `${message}\n\nView Consultation: ${url}`,
    html: `<p>${message}</p><p><a href="${url}">View Consultation</a></p>` });
  return result.delivered;
}
export async function bestEffortStudentConsultationEmail(input) {
  try { return await sendStudentConsultationEmail(input); }
  catch { console.warn("[Email] Consultation delivery failed."); return false; }
}

export async function sendFacultyConsultationEmail({ faculty, appointmentId, event }) {
  const definition = FACULTY_CONSULTATION_EVENTS[event];
  if (!definition) return false;
  const user = await User.findById(faculty).select("email role").lean();
  if (!user?.email || !["faculty", "dean"].includes(user.role)) return false;
  const [subject, message, destination] = definition;
  const path = facultyConsultationPath(appointmentId, destination, user.role === "dean");
  if (!env.clientUrl) return false;
  const url = new URL(path, `${env.clientUrl.replace(/\/$/, "")}/`).toString();
  const result = await sendEmail({ to: user.email, subject, text: `${message}\n\nView in SOCConsult: ${url}`,
    html: `<p>${message}</p><p><a href="${url}">View in SOCConsult</a></p>` });
  return result.delivered;
}

export async function bestEffortFacultyConsultationEmail(input) {
  try {
    const delivered = await sendFacultyConsultationEmail(input);
    if (!delivered) console.warn(`[Email] Faculty consultation delivery unavailable event=${input.event} recipient=${id(input.faculty)} appointment=${id(input.appointmentId)}`);
    return delivered;
  } catch {
    console.warn(`[Email] Faculty consultation delivery failed event=${input.event} recipient=${id(input.faculty)} appointment=${id(input.appointmentId)}`);
    return false;
  }
}

export function appointmentEvent(action) {
  return ({ request: "request_submitted", confirm: "confirmed", reject: "rejected", propose: "reschedule_proposed",
    accept_proposal: "reschedule_response_recorded", reject_proposal: "reschedule_response_recorded",
    cancel: "cancelled", expire: "expired" })[action];
}

export function facultyAppointmentEvent(action, actorRole) {
  if (action === "request") return "faculty_request_submitted";
  if (action === "accept_proposal") return "faculty_proposal_accepted";
  if (action === "reject_proposal") return "faculty_proposal_declined";
  if (action === "cancel" && actorRole === "student") return "faculty_cancelled";
  if (action === "expire") return "faculty_expired";
  return undefined;
}
