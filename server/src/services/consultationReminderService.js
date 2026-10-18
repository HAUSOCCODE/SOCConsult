import Appointment from "../models/Appointment.js";
import { createStudentConsultationNotification, sendStudentConsultationEmail } from "./consultationNotificationService.js";

export const CONSULTATION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export async function processConsultationReminders({ now = new Date(), limit = 100 } = {}) {
  const rows = await Appointment.find({ status: "Confirmed", startAt: { $gt: now, $lte: new Date(+now + CONSULTATION_REMINDER_LEAD_MS) } })
    .select("student startAt").sort({ startAt: 1, _id: 1 }).limit(limit).lean();
  const counts = { scanned: rows.length, created: 0, skipped: 0, errors: 0 };
  for (const row of rows) {
    try {
      await createStudentConsultationNotification({ student: row.student, appointmentId: row._id, event: "upcoming_reminder" });
      counts.created++;
      await sendStudentConsultationEmail({ student: row.student, appointmentId: row._id, event: "upcoming_reminder" });
    } catch (error) {
      if (error?.code === 11000) counts.skipped++;
      else counts.errors++;
    }
  }
  return counts;
}
