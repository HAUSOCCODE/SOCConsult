import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { env } from "../src/config/env.js";
import { setEmailTransportFactoryForTests, resetEmailTransportFactoryForTests } from "../src/services/emailService.js";
import { processConsultationReminders } from "../src/services/consultationReminderService.js";
import { runReminderCommand } from "../scripts/process-consultation-reminders.mjs";

const now = new Date("2026-11-01T00:00:00Z");
const student = "507f1f77bcf86cd799439013", faculty = "507f1f77bcf86cd799439014";
function harness(t, size) {
  const rows = Array.from({ length: size }, (_, i) => ({ _id: (i + 1).toString(16).padStart(24, "0"),
    student, faculty, status: "Confirmed", startAt: new Date(+now + 3600000) }));
  const keys = new Set(), blocked = new Set(), email = [], queries = [], stored = [];
  const previous = { ...env };
  Object.assign(env, { smtpHost: "smtp.example.test", smtpUser: "mock", smtpPass: "mock", emailFrom: "sender@example.test", clientUrl: "https://socconsult.example.test" });
  t.after(() => { Object.assign(env, previous); resetEmailTransportFactoryForTests(); });
  t.mock.method(Appointment, "find", filter => {
    queries.push(filter);
    let limit;
    const q = { select(projection) { assert.equal(projection, "student faculty startAt"); return q; },
      sort(sort) { assert.deepEqual(sort, { _id: 1 }); return q; }, limit(n) { limit = n; return q; },
      async lean() { return rows.filter(row => row.status === filter.status && row.startAt > filter.startAt.$gt &&
        row.startAt <= filter.startAt.$lte && (!filter._id || row._id > filter._id.$gt)).slice(0, limit); } };
    return q;
  });
  t.mock.method(User, "findById", id => {
    const q = { select() { return q; }, session() { return q; }, async lean() { return { role: "faculty", email: `${id}@example.test` }; } };
    return q;
  });
  t.mock.method(Notification, "create", async ([row]) => {
    if (blocked.has(String(row.relatedEntityId))) throw Error("PRIVATE infrastructure error");
    const key = `${row.recipient}:${row.deduplicationKey}`;
    if (keys.has(key)) throw Object.assign(Error("duplicate"), { code: 11000 });
    keys.add(key); stored.push(row); return [row];
  });
  setEmailTransportFactoryForTests(() => ({ async sendMail(message) {
    const id = /appointment=([a-f\d]{24})/.exec(message.text)?.[1];
    assert.ok(stored.some(row => String(row.relatedEntityId) === id && `${row.recipient}@example.test` === message.to), "email must follow successful persistence");
    email.push(message);
  } }));
  return { rows, keys, blocked, email, queries, stored };
}

test("stable reminder traversal reaches beyond 100 duplicates and blocked records, continues recipients, and safely retries", async t => {
  const h = harness(t, 230);
  for (const row of h.rows.slice(0, 100)) {
    h.keys.add(`${student}:upcoming_reminder:${row._id}`);
    h.keys.add(`${faculty}:faculty_upcoming_reminder:${row._id}`);
  }
  h.blocked.add(h.rows[100]._id);
  const first = await processConsultationReminders({ now });
  assert.deepEqual(first, { scanned: 230, created: 129, skipped: 100, errors: 1, incomplete: 0 });
  assert.equal(h.stored.length, 258);
  assert.equal(h.email.length, 258);
  assert.ok(h.stored.some(row => String(row.relatedEntityId) === h.rows.at(-1)._id));
  assert.equal(h.queries.length, 3);
  assert.equal(h.queries[1]._id.$gt, h.rows[99]._id);
  assert.equal(h.queries[2]._id.$gt, h.rows[199]._id);
  assert.ok(h.queries.every(filter => filter.startAt.$gt === now));
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|recipient|appointment|example/);
  h.blocked.clear();
  const retry = await processConsultationReminders({ now });
  assert.deepEqual(retry, { scanned: 230, created: 1, skipped: 229, errors: 0, incomplete: 0 });
  assert.equal(h.email.length, 260); // persisted recipients never receive a second email
});

test("failed Student delivery does not block Faculty or later appointments", async t => {
  const h = harness(t, 2);
  const create = Notification.create;
  Notification.create = async rows => {
    if (rows[0].recipient === student && String(rows[0].relatedEntityId) === h.rows[0]._id) throw Error("blocked Student");
    return create(rows);
  };
  assert.deepEqual(await processConsultationReminders({ now, limit: 1 }),
    { scanned: 2, created: 2, skipped: 0, errors: 1, incomplete: 0 });
  assert.equal(h.stored.length, 3);
  assert.equal(h.email.length, 3);
});

test("bounded sweeps distinguish incomplete, exact completion, invalid bounds and read failure", async t => {
  const h = harness(t, 101);
  assert.deepEqual(await processConsultationReminders({ now, maxBatches: 1 }),
    { scanned: 100, created: 100, skipped: 0, errors: 0, incomplete: 1 });
  h.rows.pop();
  assert.deepEqual(await processConsultationReminders({ now, maxBatches: 1 }),
    { scanned: 100, created: 0, skipped: 100, errors: 0, incomplete: 0 });
  assert.deepEqual(await processConsultationReminders({ now, limit: 0 }),
    { scanned: 0, created: 0, skipped: 0, errors: 1, incomplete: 1 });
  const find = Appointment.find;
  let calls = 0;
  Appointment.find = filter => { if (++calls === 2) throw Error("PRIVATE query failure"); return find(filter); };
  assert.deepEqual(await processConsultationReminders({ now, limit: 50 }),
    { scanned: 50, created: 0, skipped: 50, errors: 1, incomplete: 1 });
});

test("reminder command reports aggregate-only failure/incomplete status with mocked connections", async () => {
  for (const [errors, incomplete, expected] of [[0, 0, 0], [1, 0, 1], [0, 1, 1]]) {
    const result = { scanned: 101, created: 100, skipped: 0, errors, incomplete }, output = [];
    let disconnected = false;
    assert.equal(await runReminderCommand({ mongoUri: "mock-only", connect: async () => {},
      disconnect: async () => { disconnected = true; }, processRun: async () => result, write: line => output.push(line) }), expected);
    assert.equal(disconnected, true);
    assert.deepEqual(output, [JSON.stringify(result)]);
  }
});
