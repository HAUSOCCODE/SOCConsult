import Notification from "../models/Notification.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import { env } from "../config/env.js";
import { sendEmail } from "./emailService.js";

export const STUDENT_CONSULTATION_EVENTS = Object.freeze({
  faculty_request_received: ["New Consultation Request from Your Faculty Member", "Your Faculty member requested a consultation. Please review the proposed schedule.", false],
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
  faculty_request_accepted: ["Consultation request accepted", "The student accepted your consultation request.", "consultations"],
  faculty_request_declined: ["Consultation request declined", "The student declined your consultation request.", "history"],
  faculty_student_reschedule_proposed: ["Student proposed another schedule", "The student proposed another consultation schedule for your review.", "consultations"],
});

const id = value => String(value?._id || value?.id || value || "");
export function studentConsultationPath(appointmentId, historical = false) {
  const value = id(appointmentId);
  if (!/^[a-f\d]{24}$/i.test(value)) throw new Error("Invalid appointment reference.");
  return `/student/${historical ? "history" : "consultations"}?appointment=${value}`;
}
export function consultationEmailUrl(path) {
  if (!env.clientUrl || !/^\/(?:student\/(?:consultations|history)|faculty\/(?:requests|consultations|history)|dean\/faculty\/(?:requests|consultations|history))\?appointment=[a-f\d]{24}$/i.test(path)) return undefined;
  return new URL(path, `${env.clientUrl.replace(/\/$/, "")}/`).toString();
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const personName = value => String(value?.name || "Unavailable").trim() || "Unavailable";
const manila = (value, options) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...options }).format(new Date(value));

export function buildConsultationEmail({ appointment, recipientRole, subject, message, url, request = false }) {
  const faculty = personName(appointment.faculty), student = personName(appointment.student);
  const requestedBy = appointment.initiatedByRole === "faculty" ? faculty : student;
  const date = manila(appointment.startAt, { month: "long", day: "numeric", year: "numeric" });
  const start = manila(appointment.startAt, { hour: "numeric", minute: "2-digit" });
  const end = manila(appointment.endAt, { hour: "numeric", minute: "2-digit" });
  const details = [
    ["Requested by", requestedBy], ["Faculty member", faculty], ["Student", student],
    ["Consultation subject", appointment.subject], ["Reason for consultation", appointment.reason],
    ["Date", date], ["Start time", start], ["End time", end],
    ["Consultation mode", appointment.consultationMode],
    [appointment.consultationMode === "Online" ? "Meeting information" : "Location",
      appointment.consultationMode === "Online" ? appointment.meetingPlatform : appointment.location],
    ["Status", appointment.status],
  ].filter(([, value]) => value != null && String(value).trim());
  const button = request ? "View Consultation Request" : "View Consultation";
  const greeting = recipientRole === "student" ? "Hello, Student!" : "Hello, Professor!";
  const textDetails = details.map(([label, value]) => `${label}: ${value}`).join("\n");
  const text = `SOCConsult\nSchool of Computing — Holy Angel University\n\n${subject}\n\n${greeting}\n\n${message}\n\nConsultation Details\n${textDetails}\n\nPlease review this consultation in SOCConsult.\n\n${button}: ${url}\n\nThis is an automated SOCConsult notification.`;
  const rows = details.map(([label, value]) => `<tr><th style="padding:8px;text-align:left;vertical-align:top;color:#6e1423">${escapeHtml(label)}</th><td style="padding:8px;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<div style="margin:0 auto;max-width:640px;font-family:Arial,sans-serif;color:#1f2937"><div style="background:#6e1423;padding:22px;color:#fff"><strong style="font-size:22px">SOCConsult</strong><div>School of Computing</div><div>Holy Angel University</div></div><div style="padding:24px;border:1px solid #e5e7eb"><h1 style="color:#6e1423;font-size:24px">${escapeHtml(subject)}</h1><p>${escapeHtml(greeting)}</p><p>${escapeHtml(message)}</p><h2 style="font-size:18px">Consultation Details</h2><table role="presentation" style="width:100%;border-collapse:collapse;background:#f8fafc">${rows}</table><p style="margin-top:22px">Please review this consultation in SOCConsult.</p><p style="margin:28px 0 8px;text-align:center"><a href="${escapeHtml(url)}" style="display:inline-block;border-radius:6px;background:#6e1423;color:#fff;padding:13px 22px;text-decoration:none;font-weight:bold">${button}</a></p></div><div style="padding:16px;text-align:center;color:#64748b;font-size:12px">Automated notification from SOCConsult — School of Computing, Holy Angel University.</div></div>`;
  return { subject, text, html };
}

async function appointmentEmail(appointmentId, appointment) {
  if (appointment) return appointment;
  return Appointment.findById(appointmentId).select("student faculty initiatedByRole subject reason startAt endAt consultationMode location meetingPlatform status")
    .populate("student", "name").populate("faculty", "name").lean();
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
export async function sendStudentConsultationEmail({ student, appointmentId, event, appointment: loadedAppointment }) {
  const definition = STUDENT_CONSULTATION_EVENTS[event];
  if (!definition) return false;
  const user = await User.findById(student).select("email").lean();
  const path = studentConsultationPath(appointmentId, definition[2]);
  const url = consultationEmailUrl(path);
  if (!user?.email || !url) return false;
  let appointment;
  try { appointment = await appointmentEmail(appointmentId, loadedAppointment); } catch { return false; }
  if (!appointment) return false;
  const [subject, message] = definition;
  const content = buildConsultationEmail({ appointment, recipientRole: "student", subject, message, url,
    request: event === "faculty_request_received" });
  const result = await sendEmail({ to: user.email, ...content });
  return result.delivered;
}
export async function bestEffortStudentConsultationEmail(input) {
  try { return await sendStudentConsultationEmail(input); }
  catch { console.warn("[Email] Consultation delivery failed."); return false; }
}

export async function sendFacultyConsultationEmail({ faculty, appointmentId, event, appointment: loadedAppointment }) {
  const definition = FACULTY_CONSULTATION_EVENTS[event];
  if (!definition) return false;
  const user = await User.findById(faculty).select("email role").lean();
  if (!user?.email || !["faculty", "dean"].includes(user.role)) return false;
  const [subject, message, destination] = definition;
  const path = facultyConsultationPath(appointmentId, destination, user.role === "dean");
  const url = consultationEmailUrl(path);
  let appointment;
  try { appointment = await appointmentEmail(appointmentId, loadedAppointment); } catch { return false; }
  if (!url || !appointment) return false;
  const content = buildConsultationEmail({ appointment, recipientRole: "faculty", subject, message, url,
    request: event === "faculty_request_submitted" });
  const result = await sendEmail({ to: user.email, ...content });
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

export function appointmentEvent(action, appointment, actorRole) {
  if (action === "request") return appointment?.initiatedByRole === "faculty" ? "faculty_request_received" : "request_submitted";
  if (appointment?.initiatedByRole === "faculty" && actorRole === "student") return undefined;
  return ({ confirm: "confirmed", reject: "rejected", propose: "reschedule_proposed",
    accept_proposal: "reschedule_response_recorded", reject_proposal: "reschedule_response_recorded",
    cancel: "cancelled", expire: "expired" })[action];
}

export function facultyAppointmentEvent(action, actorRole, appointment) {
  if (action === "request") return appointment?.initiatedByRole === "faculty" ? undefined : "faculty_request_submitted";
  if (appointment?.initiatedByRole === "faculty" && actorRole === "student")
    return ({ confirm: "faculty_request_accepted", reject: "faculty_request_declined", propose: "faculty_student_reschedule_proposed", cancel: "faculty_cancelled" })[action];
  if (action === "accept_proposal") return "faculty_proposal_accepted";
  if (action === "reject_proposal") return "faculty_proposal_declined";
  if (action === "cancel" && actorRole === "student") return "faculty_cancelled";
  if (action === "expire") return "faculty_expired";
  return undefined;
}
