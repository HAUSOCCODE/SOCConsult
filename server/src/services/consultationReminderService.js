import Appointment from "../models/Appointment.js";
import { createFacultyConsultationNotification, createStudentConsultationNotification,
  sendFacultyConsultationEmail, sendStudentConsultationEmail } from "./consultationNotificationService.js";

export const CONSULTATION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export async function processConsultationReminders({ now = new Date(), limit = 100, maxBatches = 1000 } = {}) {
  const counts = { scanned: 0, created: 0, skipped: 0, errors: 0, incomplete: 0 };
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 ||
    !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10000 || !Number.isFinite(+now))
    return { ...counts, errors: 1, incomplete: 1 };
  let cursor;
  const read = size => Appointment.find({ status: "Confirmed",
    startAt: { $gt: now, $lte: new Date(+now + CONSULTATION_REMINDER_LEAD_MS) },
    ...(cursor && { _id: { $gt: cursor } }) })
    .select("student faculty startAt").sort({ _id: 1 }).limit(size).lean();
  for (let batch = 0; batch < maxBatches; batch++) {
    let rows;
    try { rows = await read(limit); }
    catch { return { ...counts, errors: counts.errors + 1, incomplete: 1 }; }
    if (!rows.length) return counts;
    counts.scanned += rows.length;
    for (const row of rows) {
      let created = false, duplicate = false, failed = false;
      for (const delivery of [
        { create: () => createStudentConsultationNotification({ student: row.student, appointmentId: row._id, event: "upcoming_reminder" }),
          email: () => sendStudentConsultationEmail({ student: row.student, appointmentId: row._id, event: "upcoming_reminder" }) },
        ...(row.faculty ? [{ create: () => createFacultyConsultationNotification({ faculty: row.faculty, appointmentId: row._id, event: "faculty_upcoming_reminder" }),
          email: () => sendFacultyConsultationEmail({ faculty: row.faculty, appointmentId: row._id, event: "faculty_upcoming_reminder" }) }] : []),
      ]) {
        try { await delivery.create(); }
        catch (error) {
          if (error?.code === 11000) duplicate = true;
          else failed = true;
          continue;
        }
        created = true;
        // External delivery follows persistence, never a duplicate or failed write.
        try { await delivery.email(); }
        catch { failed = true; }
      }
      if (created) counts.created++;
      if (failed) counts.errors++;
      else if (!created && duplicate) counts.skipped++;
    }
    const next = rows.at(-1)._id;
    if (!next || cursor && String(next) <= String(cursor)) return { ...counts, errors: counts.errors + 1, incomplete: 1 };
    cursor = next;
    if (rows.length < limit) return counts;
  }
  // Probe without delivering to distinguish an exact final batch from a capped sweep.
  try { counts.incomplete = (await read(1)).length ? 1 : 0; }
  catch { counts.errors++; counts.incomplete = 1; }
  return counts;
}
