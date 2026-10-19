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

export function appointmentEvent(action) {
  return ({ request: "request_submitted", confirm: "confirmed", reject: "rejected", propose: "reschedule_proposed",
    accept_proposal: "reschedule_response_recorded", reject_proposal: "reschedule_response_recorded",
    cancel: "cancelled", expire: "expired" })[action];
}
