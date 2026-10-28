import Appointment from "../models/Appointment.js";
import { transitionAppointment } from "./appointmentTransitionService.js";

export const availabilityStatus = (availability, now = new Date()) => {
  if (new Date(availability.endAt) <= now) return "expired";
  return availability.isActive ? "active" : "inactive";
};

// Explicit processor entry point. Never called from reads or application startup.
// UTC instants correspond to Asia/Manila schedules; no invented duration deadline.
export async function processExpiredAvailability({ facultyId, now = new Date(), limit = 100, afterId } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid expiration batch limit.");
  const candidates = await Appointment.find({ status: "Pending", startAt: { $type: "date", $lte: now },
    ...(facultyId && { faculty: facultyId }), ...(afterId && { _id: { $gt: afterId } }),
  }).select("_id updatedAt __v").sort({ _id: 1 }).limit(limit).lean();
  const counts = { attempted: candidates.length, changed: 0, skipped: 0, failed: 0 };
  for (const candidate of candidates) {
    try {
      await transitionAppointment({ id: candidate._id, action: "expire", actor: { role: "system" },
        expectedUpdatedAt: candidate.updatedAt, expectedVersion: candidate.__v, now });
      counts.changed++;
    } catch (error) {
      if (["APPOINTMENT_CONCURRENT_CHANGE", "APPOINTMENT_NOT_FOUND"].includes(error.code)) counts.skipped++;
      else counts.failed++;
    }
  }
  // Internal cursor must never be included in command output.
  return { ...counts, nextCursor: candidates.at(-1)?._id || null };
}

export const emptyExpirationCounts = () => ({ attempted: 0, changed: 0, skipped: 0, failed: 0, errors: 0, incomplete: 0 });

// One sweep has a fixed deadline snapshot and a strictly increasing ID cursor.
// Blocked records are visited once per sweep and remain eligible on the next run.
export async function runAppointmentExpiration({ facultyId, now = new Date(), batchSize = 100, maxBatches = 1000,
  processBatch = processExpiredAvailability } = {}) {
  const total = emptyExpirationCounts();
  if (!Number.isInteger(maxBatches) || maxBatches < 1) return { ...total, errors: 1, incomplete: 1 };
  let cursor;
  for (let pass = 0; pass < maxBatches; pass++) {
    let batch;
    try { batch = await processBatch({ facultyId, now, limit: batchSize, afterId: cursor }); }
    catch { return { ...total, errors: total.errors + 1, incomplete: 1 }; }
    for (const key of ["attempted", "changed", "skipped", "failed"]) total[key] += batch[key];
    if (batch.attempted === 0) return total;
    if (!batch.nextCursor || (cursor && String(batch.nextCursor) <= String(cursor)))
      return { ...total, errors: total.errors + 1, incomplete: 1 };
    cursor = batch.nextCursor;
    if (batch.attempted < batchSize) return total;
  }
  return { ...total, incomplete: 1 };
}
