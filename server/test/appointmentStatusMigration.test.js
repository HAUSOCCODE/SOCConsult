import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLegacyAppointment, planAppointmentMigration, migrationUpdate, applyAppointmentMigration, MIGRATION_VERSION } from "../src/services/appointmentStatusMigrationService.js";
import { fixture, clone } from "./helpers/appointmentHarness.js";

test("migration classifies every old status conservatively and emits aggregate safe counts", () => {
  for (const status of ["Pending", "Rejected", "Cancelled", "Completed"])
    assert.deepEqual(classifyLegacyAppointment(fixture({ status })), { kind: "safe", to: status });
  for (const status of ["Approved", "Rescheduled"])
    assert.deepEqual(classifyLegacyAppointment(fixture({ status })), { kind: "safe", to: "Confirmed" });
  assert.deepEqual(classifyLegacyAppointment(fixture({ status: "Awaiting Faculty Schedule", bookingMethod: "schedule_request", startAt: undefined, endAt: undefined, availability: undefined })), { kind: "safe", to: "Pending" });
  for (const status of ["No Show", "Needs Reschedule", "Awaiting Faculty Schedule", "Unexpected"])
    assert.equal(classifyLegacyAppointment(fixture({ status })).kind, "manual_review");
  assert.equal(classifyLegacyAppointment(fixture({ status: "Approved", endAt: undefined })).kind, "manual_review");
  assert.equal(classifyLegacyAppointment(fixture({ status: "Rescheduled", rescheduleRequestStatus: "Pending" })).kind, "manual_review");
  const plan = planAppointmentMigration([fixture({ status: "No Show" }), fixture({ status: "Completed" })]);
  assert.equal(plan.blocked, true); assert.equal(plan.counts.manual_review, 1); assert.equal(plan.counts.safe, 1);
  assert.ok(Object.values(plan.counts).every((value) => typeof value === "number"));
});

test("dry-run does not write; ambiguity and duplicate Pending mappings stop before the first write", async () => {
  let writes = 0;
  const collection = { updateOne: async () => { writes++; return { matchedCount: 1 }; } };
  const record = fixture({ status: "Awaiting Faculty Schedule", bookingMethod: "schedule_request", startAt: undefined, endAt: undefined, availability: undefined });
  const original = clone(record);
  assert.equal(planAppointmentMigration([record]).blocked, false); assert.deepEqual(record, original); assert.equal(writes, 0);
  await assert.rejects(applyAppointmentMigration({ session: { inTransaction: () => true }, records: [record, fixture({ status: "No Show" })], collection }));
  await assert.rejects(applyAppointmentMigration({ session: { inTransaction: () => true }, records: [record, { ...record, _id: "another" }], collection }));
  assert.equal(writes, 0);
});

test("migration preserves unrelated fields and timestamps, records provenance, and reruns safely", async () => {
  const record = fixture({ status: "Approved", createdAt: new Date("2020-01-01"), supportingDocuments: [{ name: "private-document" }] });
  const before = clone(record); let writes = 0;
  const collection = { updateOne: async (filter, update) => {
    writes++; assert.equal(filter.status, "Approved"); assert.deepEqual(filter.updatedAt, before.updatedAt);
    Object.assign(record, update.$set); record.statusHistory.push(update.$push.statusHistory); return { matchedCount: 1 };
  } };
  await applyAppointmentMigration({ session: { inTransaction: () => true }, records: [record], collection });
  assert.equal(record.status, "Confirmed"); assert.equal(record.statusMigration.originalStatus, "Approved");
  assert.equal(record.statusMigration.version, MIGRATION_VERSION);
  assert.equal(record.statusHistory[0].source, "legacy_migration");
  for (const key of Object.keys(before).filter((key) => !["status", "statusHistory"].includes(key))) assert.deepEqual(record[key], before[key], key);
  await applyAppointmentMigration({ session: { inTransaction: () => true }, records: [record], collection }); assert.equal(writes, 1);
  const update = migrationUpdate(before, "Confirmed");
  assert.deepEqual(Object.keys(update.$set).sort(), ["status", "statusMigration"]);
  await assert.rejects(applyAppointmentMigration({ session: { inTransaction: () => true }, records: [before], collection: { updateOne: async () => ({ matchedCount: 0 }) } }));
});

test("overlapping mapped commitments block migration without guessing attendance", () => {
  const record = fixture({ status: "Approved", startAt: new Date("2020-01-01"), endAt: new Date("2020-01-01T00:30:00Z") });
  assert.equal(classifyLegacyAppointment(record).to, "Confirmed");
  const overlap = fixture({ status: "Rescheduled", faculty: record.faculty, startAt: record.startAt, endAt: record.endAt });
  assert.equal(planAppointmentMigration([record, overlap]).blocked, true);
});
