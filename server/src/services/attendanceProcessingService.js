import Appointment from "../models/Appointment.js";
import { ATTENDANCE_POLICY } from "../config/attendance.js";
import { processAttendance } from "./attendanceService.js";
export const emptyAttendanceCounts = () => ({ attempted: 0, changed: 0, skipped: 0, failed: 0, errors: 0, incomplete: 0 });
export async function processAttendanceBatch({ now, limit = 100, afterId } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid batch size.");
  const rows = await Appointment.find({ "attendance.policyVersion": ATTENDANCE_POLICY,
    $or: [{ status: "Confirmed", endAt: { $lte: now } },
      { status: "Awaiting Attendance Update", "attendance.responseDeadlineAt": { $lte: now } }],
    ...(afterId && { _id: { $gt: afterId } }) }).select("_id").sort({ _id: 1 }).limit(limit).lean();
  const counts = { attempted: rows.length, changed: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    try { counts[await processAttendance({ id: row._id, now }) ? "changed" : "skipped"]++; }
    catch (error) { counts[error.code === "APPOINTMENT_CONCURRENT_CHANGE" ? "skipped" : "failed"]++; }
  }
  return { ...counts, nextCursor: rows.at(-1)?._id || null };
}
export async function runAppointmentAttendance({ now = new Date(), batchSize = 100, maxBatches = 1000, processBatch = processAttendanceBatch } = {}) {
  const total = emptyAttendanceCounts();
  if (!Number.isInteger(maxBatches) || maxBatches < 1) return { ...total, errors: 1, incomplete: 1 };
  let cursor;
  for (let pass = 0; pass < maxBatches; pass++) {
    let batch;
    try { batch = await processBatch({ now, limit: batchSize, afterId: cursor }); }
    catch { return { ...total, errors: total.errors + 1, incomplete: 1 }; }
    for (const key of ["attempted", "changed", "skipped", "failed"]) total[key] += batch[key];
    if (!batch.attempted) return total;
    if (!batch.nextCursor || cursor && String(batch.nextCursor) <= String(cursor)) return { ...total, errors: 1, incomplete: 1 };
    cursor = batch.nextCursor;
    if (batch.attempted < batchSize) return total;
  }
  return { ...total, incomplete: 1 };
}
