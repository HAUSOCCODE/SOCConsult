import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Appointment from "../src/models/Appointment.js";
import Availability from "../src/models/Availability.js";
import OneTimeScheduleHold from "../src/models/OneTimeScheduleHold.js";
import { processExpiredAvailability, runAppointmentExpiration, emptyExpirationCounts } from "../src/services/availabilityExpirationService.js";
import { runExpirationCommand } from "../scripts/process-appointment-expiration.mjs";
import { appointmentHarness, fixture, addSlot, clone, newId } from "./helpers/appointmentHarness.js";

const deadline = new Date("2026-10-16T08:00:00+08:00");
const due = (overrides = {}) => fixture({ startAt: deadline, endAt: new Date(deadline.getTime() + 1800000), ...overrides });
function seed(h, record) {
  h.state.appointments.push(record); addSlot(h, record);
  h.state.holds.push({ appointment: record._id, faculty: record.faculty, student: record.student,
    minute: Math.floor(deadline.getTime() / 60000), expiresAt: record.endAt });
}
const run = (options = {}) => runAppointmentExpiration({ now: deadline, ...options });

test("two expiration workers have one committed transition, history, audit, Student notification and owned release", async () => {
  const h = appointmentHarness();
  const originalFind = Appointment.find;
  const releaseToken = Availability.updateOne, releaseHolds = OneTimeScheduleHold.deleteMany;
  let tokenChanges = 0, holdRemovals = 0;
  try {
    const record = due(); seed(h, record);
    const unrelated = due(); seed(h, unrelated);
    Availability.updateOne = async (...args) => {
      const result = await releaseToken(...args); tokenChanges += result.modifiedCount; return result;
    };
    OneTimeScheduleHold.deleteMany = async (...args) => {
      const before = h.state.holds.length;
      await releaseHolds(...args); holdRemovals += before - h.state.holds.length;
    };
    // Both workers select the same snapshot before either transaction starts.
    // The harness serializes transactions; actual MongoDB races require staging.
    let readers = 0, releaseReaders;
    const ready = new Promise((resolve) => { releaseReaders = resolve; });
    Appointment.find = () => {
      const query = { select: () => query, sort: () => query, limit: () => query,
        lean: async () => { if (++readers === 2) releaseReaders(); await ready; return [clone(record)]; } };
      return query;
    };
    const results = await Promise.all([processExpiredAvailability({ now: deadline }), processExpiredAvailability({ now: deadline })]);
    assert.equal(results.reduce((sum, batch) => sum + batch.changed, 0), 1);
    assert.equal(results.reduce((sum, batch) => sum + batch.skipped, 0), 1);
    assert.equal(results.reduce((sum, batch) => sum + batch.failed, 0), 0);
    const stored = h.state.appointments.find((item) => item._id === record._id);
    assert.equal(stored.status, "Expired"); assert.equal(stored.statusHistory.length, 1);
    assert.equal(stored.statusHistory[0].previousStatus, "Pending"); assert.equal(stored.statusHistory[0].newStatus, "Expired");
    assert.equal(stored.statusHistory[0].actorType, "system"); assert.equal(stored.statusHistory[0].source, "expire");
    assert.equal(stored.expirationReason, "faculty_response_deadline_passed");
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 1);
    assert.equal(h.state.notifications[0].recipient, record.student);
    assert.equal(h.state.notifications[0].title, "Consultation Expired");
    assert.equal(h.state.notifications[0].type, "expired");
    assert.equal(h.state.slots[0].reservationToken, undefined);
    assert.equal(h.state.slots[1].reservationToken, unrelated.reservationToken);
    assert.deepEqual(h.state.holds.map((hold) => hold.appointment), [unrelated._id]);
    assert.equal(tokenChanges, 1); assert.equal(holdRemovals, 1);
    Appointment.find = originalFind;
    // Restrict this follow-up to the already expired record's Faculty owner.
    assert.deepEqual(await run({ facultyId: record.faculty }), emptyExpirationCounts());
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 1);
  } finally { Appointment.find = originalFind; Availability.updateOne = releaseToken; OneTimeScheduleHold.deleteMany = releaseHolds; h.restore(); }
});

test("expiration preserves another reservation token and other appointments' minute holds", async () => {
  const h = appointmentHarness();
  try {
    const record = due(); seed(h, record);
    h.state.slots[0].reservationToken = "owned-by-another-appointment";
    const otherId = newId();
    h.state.holds.push({ appointment: otherId, faculty: newId(), student: newId(), minute: 123 });
    const result = await run(); assert.equal(result.changed, 1);
    assert.equal(h.state.slots[0].reservationToken, "owned-by-another-appointment");
    assert.deepEqual(h.state.holds.map((hold) => hold.appointment), [otherId]);
    assert.equal((await run()).attempted, 0);
  } finally { h.restore(); }
});

test("each expiration transaction failure rolls back all effects, is reported failed and remains retryable", async () => {
  for (const stage of ["slots", "holds", "appointments", "audits", "notifications"]) {
    const h = appointmentHarness();
    try {
      const record = due(); seed(h, record); const before = clone(h.state);
      h.fail(stage);
      assert.deepEqual(await run(), { ...emptyExpirationCounts(), attempted: 1, failed: 1 });
      assert.deepEqual(h.state, before, stage);
      h.fail(undefined); h.retry();
      assert.deepEqual(await run(), { ...emptyExpirationCounts(), attempted: 1, changed: 1 });
      assert.equal(h.state.appointments[0].statusHistory.length, 1);
      assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 1);
      assert.equal(h.state.slots[0].reservationToken, undefined); assert.equal(h.state.holds.length, 0);
    } finally { h.restore(); }
  }
});

test("a full blocked batch cannot loop forever and later eligible records are still processed", async () => {
  const h = appointmentHarness();
  try {
    const blocked = [due(), due()];
    for (const record of blocked) { record.statusHistory = [{ changedAt: "invalid" }]; seed(h, record); }
    const later = due(); seed(h, later);
    // Deliberately scramble storage order; cursor traversal must follow ID sort.
    h.state.appointments.reverse();
    const attempted = [];
    const processBatch = async (options) => {
      const batch = await processExpiredAvailability(options); attempted.push(batch.nextCursor); return batch;
    };
    const counts = await run({ batchSize: 2, processBatch });
    assert.deepEqual(counts, { ...emptyExpirationCounts(), attempted: 3, changed: 1, failed: 2 });
    assert.equal(attempted.length, 2); assert.ok(String(attempted[1]) > String(attempted[0]));
    assert.equal(h.state.appointments.find((item) => item._id === later._id).status, "Expired");
    const repeat = await run({ batchSize: 2 });
    assert.deepEqual(repeat, { ...emptyExpirationCounts(), attempted: 2, failed: 2 });
  } finally { h.restore(); }
});

test("deadline is the scheduled start instant; unscheduled Pending, proposals and Confirmed stay excluded", async () => {
  const h = appointmentHarness();
  try {
    const record = due(); seed(h, record);
    h.state.appointments.push(
      due({ bookingMethod: "schedule_request", startAt: undefined, endAt: undefined, availability: undefined }),
      due({ status: "Reschedule Proposed" }), due({ status: "Confirmed" }),
    );
    assert.deepEqual(await run({ now: new Date(deadline.getTime() - 1) }), emptyExpirationCounts());
    assert.deepEqual(await run(), { ...emptyExpirationCounts(), attempted: 1, changed: 1 });
    assert.deepEqual(h.state.appointments.slice(1).map((item) => item.status), ["Pending", "Reschedule Proposed", "Confirmed"]);
    assert.equal(h.state.appointments[0].endAt > deadline, true);
  } finally { h.restore(); }
});

test("a genuine compare-and-set conflict is skipped without releasing reservations or producing events", async () => {
  const h = appointmentHarness(); const originalFind = Appointment.find;
  try {
    const record = due(); seed(h, record);
    Appointment.find = () => {
      const query = { select: () => query, sort: () => query, limit: () => query,
        lean: async () => [{ _id: record._id, updatedAt: new Date(0) }] };
      return query;
    };
    const result = await processExpiredAvailability({ now: deadline });
    assert.equal(result.skipped, 1); assert.equal(result.changed, 0); assert.equal(result.failed, 0);
    assert.equal(h.state.appointments[0].status, "Pending"); assert.equal(h.state.audits.length, 0);
    assert.equal(h.state.notifications.length, 0); assert.equal(h.state.holds.length, 1);
    assert.equal(h.state.slots[0].reservationToken, record.reservationToken);
  } finally { Appointment.find = originalFind; h.restore(); }
});

test("bounded sweeps and cursor validation terminate safely; query failures signal incomplete work", async () => {
  let calls = 0;
  const batch = { attempted: 1, changed: 0, skipped: 0, failed: 1, nextCursor: "000000000000000000000001" };
  const stopped = await run({ batchSize: 1, maxBatches: 5, processBatch: async () => { calls++; return batch; } });
  assert.equal(calls, 2); assert.equal(stopped.errors, 1); assert.equal(stopped.incomplete, 1);
  let cursor = 0;
  const bounded = await run({ batchSize: 1, maxBatches: 2, processBatch: async () => ({ ...batch, nextCursor: String(++cursor) }) });
  assert.equal(bounded.attempted, 2); assert.equal(bounded.incomplete, 1);
  const failed = await run({ processBatch: async () => { throw new Error("private-record-content"); } });
  assert.equal(failed.errors, 1); assert.equal(failed.incomplete, 1);
});

test("command emits only aggregate numbers and returns nonzero for blocked, incomplete or operational failures", async () => {
  for (const [counts, expected] of [
    [emptyExpirationCounts(), 0], [{ ...emptyExpirationCounts(), attempted: 1, changed: 1 }, 0],
    [{ ...emptyExpirationCounts(), attempted: 1, skipped: 1 }, 0],
    [{ ...emptyExpirationCounts(), attempted: 1, failed: 1 }, 1],
    [{ ...emptyExpirationCounts(), incomplete: 1 }, 1],
  ]) {
    const lines = []; let closed = 0;
    const code = await runExpirationCommand({ mongoUri: "test-only", connect: async () => {},
      disconnect: async () => { closed++; }, processRun: async () => counts, write: (line) => lines.push(line) });
    assert.equal(code, expected); assert.equal(closed, 1); assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), counts); assert.ok(Object.values(JSON.parse(lines[0])).every(Number.isInteger));
  }
  const lines = [];
  assert.equal(await runExpirationCommand({ mongoUri: "test-only", connect: async () => { throw new Error("sensitive-uri-and-email"); },
    disconnect: async () => {}, write: (line) => lines.push(line) }), 1);
  assert.equal(JSON.parse(lines[0]).errors, 1); assert.doesNotMatch(lines[0], /sensitive|email|uri/);
  const restricted = [];
  await runExpirationCommand({ mongoUri: "test-only", connect: async () => {}, disconnect: async () => {},
    processRun: async () => ({ ...emptyExpirationCounts(), nextCursor: "private-record-id", concern: "private-content" }),
    write: (line) => restricted.push(line) });
  assert.deepEqual(JSON.parse(restricted[0]), emptyExpirationCounts());
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/process-appointment-expiration.mjs", import.meta.url))],
    { encoding: "utf8", env: { ...process.env, MONGODB_URI: "" } });
  assert.equal(result.status, 1); assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { ...emptyExpirationCounts(), errors: 1 });
});

test("isolated test imports skip dotenv; normal development and production still invoke it", async () => {
  const original = dotenv.config, previousMode = process.env.NODE_ENV; let calls = 0;
  // Spy only: no real .env file is opened in any of these imports.
  dotenv.config = () => { calls++; return { parsed: {} }; };
  try {
    process.env.NODE_ENV = "test";
    await import("../src/config/env.js?expiration-test-mode"); assert.equal(calls, 0);
    process.env.NODE_ENV = "development";
    await import("../src/config/env.js?expiration-development-mode"); assert.equal(calls, 1);
    process.env.NODE_ENV = "production";
    await import("../src/config/env.js?expiration-production-mode"); assert.equal(calls, 2);
  } finally { dotenv.config = original; if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode; }
});
