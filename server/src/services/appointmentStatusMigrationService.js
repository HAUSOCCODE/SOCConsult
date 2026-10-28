import { APPOINTMENT_STATUSES } from "../config/appointmentStatus.js";

export const MIGRATION_VERSION = "CORE-02-v1";
const identity = new Set(["Pending", "Rejected", "Cancelled", "Completed"]);
const validDate = (value) => value != null && Number.isFinite(new Date(value).getTime());
const scheduled = (record) => validDate(record.startAt) && validDate(record.endAt) &&
  new Date(record.endAt) > new Date(record.startAt) && ["Online", "Face-to-Face"].includes(record.consultationMode);
const participant = (value) => /^[a-f\d]{24}$/i.test(String(value || ""));

export function classifyLegacyAppointment(record) {
  if (record.statusMigration?.version === MIGRATION_VERSION) return { kind: "already_migrated" };
  if (record.statusMigration) return { kind: "manual_review" };
  if (!participant(record.student) || !participant(record.faculty)) return { kind: "manual_review" };
  if (record.statusHistory?.some((entry) => !validDate(entry.changedAt))) return { kind: "manual_review" };
  if (record.decisionLock || record.rescheduleRequested || record.rescheduleRequestStatus === "Pending" || record.proposedAt)
    return { kind: APPOINTMENT_STATUSES.includes(record.status) ? "preserve_current" : "manual_review" };
  if (["No Show", "Needs Reschedule"].includes(record.status)) return { kind: "manual_review" };
  if (record.status === "Awaiting Faculty Schedule") {
    if (record.bookingMethod !== "schedule_request" || record.startAt != null || record.endAt != null || record.availability)
      return { kind: "manual_review" };
    return { kind: "safe", to: "Pending" };
  }
  if (["Approved", "Rescheduled"].includes(record.status)) {
    if (!scheduled(record) || !["published_slot", "schedule_request", undefined].includes(record.bookingMethod)) return { kind: "manual_review" };
    // A slotless reschedule must have the historical custom-schedule evidence.
    if (!record.availability && record.bookingMethod !== "schedule_request" &&
      !(record.status === "Rescheduled" && record.scheduleHistory?.some((entry) =>
        validDate(entry.next?.startAt) && new Date(entry.next.startAt).getTime() === new Date(record.startAt).getTime())))
      return { kind: "manual_review" };
    return { kind: "safe", to: "Confirmed" };
  }
  if (identity.has(record.status)) {
    if (record.status === "Pending" && !(record.bookingMethod === "schedule_request" && record.startAt == null && record.endAt == null) && !scheduled(record))
      return { kind: "manual_review" };
    return { kind: "safe", to: record.status };
  }
  return { kind: APPOINTMENT_STATUSES.includes(record.status) ? "preserve_current" : "manual_review" };
}

export function planAppointmentMigration(records, { knownParticipantIds } = {}) {
  const counts = { safe: 0, already_migrated: 0, preserve_current: 0, manual_review: 0, conflicts: 0 };
  const plans = records.map((record) => ({ record, ...(knownParticipantIds &&
    (!knownParticipantIds.has(String(record.student)) || !knownParticipantIds.has(String(record.faculty)))
    ? { kind: "manual_review" } : classifyLegacyAppointment(record)) }));
  const pending = new Map();
  for (const plan of plans) {
    counts[plan.kind]++;
    if (plan.record.bookingMethod === "schedule_request" && (plan.to || plan.record.status) === "Pending") {
      const key = `${plan.record.student}:${plan.record.faculty}`;
      pending.set(key, (pending.get(key) || 0) + 1);
    }
  }
  counts.conflicts = [...pending.values()].filter((count) => count > 1).length;
  // Report overlapping confirmed commitments without exposing participant identifiers.
  const confirmed = plans.filter((plan) => (plan.to || plan.record.status) === "Confirmed" && scheduled(plan.record));
  for (let i = 0; i < confirmed.length; i++) for (let j = i + 1; j < confirmed.length; j++) {
    const a = confirmed[i].record, b = confirmed[j].record;
    if ((String(a.faculty) === String(b.faculty) || String(a.student) === String(b.student)) &&
      new Date(a.startAt) < new Date(b.endAt) && new Date(a.endAt) > new Date(b.startAt)) counts.conflicts++;
  }
  return { counts, blocked: counts.manual_review > 0 || counts.conflicts > 0, plans };
}

export function migrationUpdate(record, to, now = new Date()) {
  return {
    $set: { status: to, statusMigration: { version: MIGRATION_VERSION, originalStatus: record.status, migratedAt: now } },
    $push: { statusHistory: { previousStatus: record.status, newStatus: to, actorType: "system",
      changedByRole: "System", changedAt: new Date(Math.max(now.getTime(),
        new Date(record.statusHistory?.at(-1)?.changedAt || 0).getTime() + 1)),
      source: "legacy_migration", reason: "Legacy status provenance preserved", migrationVersion: MIGRATION_VERSION } },
  };
}

export async function applyAppointmentMigration({ records, collection, session, now = new Date(), knownParticipantIds }) {
  if (!session?.inTransaction?.()) throw new Error("Migration apply requires an active transaction.");
  const plan = planAppointmentMigration(records, { knownParticipantIds });
  if (plan.blocked) throw new Error("Migration blocked by ambiguous or conflicting records.");
  for (const item of plan.plans.filter((entry) => entry.kind === "safe")) {
    const result = await collection.updateOne({ _id: item.record._id, status: item.record.status,
      updatedAt: item.record.updatedAt, statusMigration: { $exists: false } },
    migrationUpdate(item.record, item.to, now), { session });
    if (result.matchedCount !== 1) throw new Error("Migration stopped because a record changed. Transaction aborted.");
  }
  return plan.counts;
}
