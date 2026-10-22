import Appointment from "../models/Appointment.js";
import { createFacultyConsultationNotification, createStudentConsultationNotification,
  sendFacultyConsultationEmail, sendStudentConsultationEmail } from "./consultationNotificationService.js";

export const CONSULTATION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export async function processConsultationReminders({ now = new Date(), limit = 100 } = {}) {
  const rows = await Appointment.find({ status: "Confirmed", startAt: { $gt: now, $lte: new Date(+now + CONSULTATION_REMINDER_LEAD_MS) } })
    .select("student faculty startAt").sort({ startAt: 1, _id: 1 }).limit(limit).lean();
  const counts = { scanned: rows.length, created: 0, skipped: 0, errors: 0 };
  for (const row of rows) {
    try {
      let created = false, duplicate = false;
      for (const delivery of [
        { create: () => createStudentConsultationNotification({ student: row.student, appointmentId: row._id, event: "upcoming_reminder" }),
          email: () => sendStudentConsultationEmail({ student: row.student, appointmentId: row._id, event: "upcoming_reminder" }) },
        ...(row.faculty ? [{ create: () => createFacultyConsultationNotification({ faculty: row.faculty, appointmentId: row._id, event: "faculty_upcoming_reminder" }),
          email: () => sendFacultyConsultationEmail({ faculty: row.faculty, appointmentId: row._id, event: "faculty_upcoming_reminder" }) }] : []),
      ]) {
        try { await delivery.create(); created = true; await delivery.email(); }
        catch (error) { if (error?.code === 11000) duplicate = true; else throw error; }
      }
      if (created) counts.created++;
      else if (duplicate) counts.skipped++;
    } catch {
      counts.errors++;
    }
  }
  return counts;
}
