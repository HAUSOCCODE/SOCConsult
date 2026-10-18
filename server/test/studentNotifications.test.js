import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { resetEmailTransportFactoryForTests, sendEmail, setEmailTransportFactoryForTests } from "../src/services/emailService.js";
import { consultationEmailUrl, createStudentConsultationNotification, STUDENT_CONSULTATION_EVENTS,
  studentConsultationPath } from "../src/services/consultationNotificationService.js";
import { CONSULTATION_REMINDER_LEAD_MS, processConsultationReminders } from "../src/services/consultationReminderService.js";
import { newId } from "./helpers/appointmentHarness.js";

test("Student lifecycle catalog is complete, privacy-safe, and uses bounded internal deep links", async () => {
  assert.deepEqual(Object.keys(STUDENT_CONSULTATION_EVENTS), ["request_submitted", "confirmed", "rejected",
    "reschedule_proposed", "reschedule_response_recorded", "cancelled", "upcoming_reminder", "expired",
    "attendance_update_required", "attendance_response_received", "attendance_review", "finalized"]);
  const appointmentId = newId(), student = newId(), records = [], original = Notification.create;
  Notification.create = async rows => { records.push(...rows); return rows; };
  try {
    for (const event of Object.keys(STUDENT_CONSULTATION_EVENTS))
      await createStudentConsultationNotification({ student, appointmentId, event });
    assert.equal(records.length, 12);
    assert.ok(records.every(row => row.recipient === student && String(row.relatedEntityId) === appointmentId));
    assert.ok(records.every(row => /^\/student\/(consultations|history)\?appointment=[a-f\d]{24}$/i.test(row.actionUrl)));
    assert.doesNotMatch(JSON.stringify(records), /reservationToken|meetingLink|proposedMeetingLink|faculty.*reason|reviewNotes|password/i);
    assert.equal(studentConsultationPath(appointmentId, true), `/student/history?appointment=${appointmentId}`);
    assert.throws(() => studentConsultationPath("https://evil.test"));
  } finally { Notification.create = original; }
});

test("SMTP adapter is optional, supports mocked delivery, and hides provider failures", async () => {
  const previous = { smtpHost: env.smtpHost, smtpUser: env.smtpUser, smtpPass: env.smtpPass, emailFrom: env.emailFrom,
    smtpPort: env.smtpPort, smtpSecure: env.smtpSecure, clientUrl: env.clientUrl };
  const warning = console.warn;
  try {
    Object.assign(env, { smtpHost: undefined, smtpUser: undefined, smtpPass: undefined, emailFrom: undefined });
    assert.deepEqual(await sendEmail({ to: "student@example.test", subject: "Update", text: "Safe" }), { delivered: false, reason: "unavailable" });
    Object.assign(env, { smtpHost: "smtp.example.test", smtpUser: "user", smtpPass: "SECRET", emailFrom: "SOCConsult <no-reply@example.test>", clientUrl: "https://socconsult.example.test" });
    let sent;
    setEmailTransportFactoryForTests(options => ({ sendMail: async message => { sent = { options, message }; } }));
    assert.deepEqual(await sendEmail({ to: "student@example.test", subject: "Update", text: "Safe", html: "<p>Safe</p>" }), { delivered: true });
    assert.equal(sent.message.to, "student@example.test");
    assert.equal(consultationEmailUrl(`/student/consultations?appointment=${newId()}`).startsWith("https://socconsult.example.test/student/"), true);
    assert.equal(consultationEmailUrl("https://evil.test"), undefined);
    const warnings = []; console.warn = value => warnings.push(value);
    setEmailTransportFactoryForTests(() => ({ sendMail: async () => { throw new Error("EAUTH SECRET"); } }));
    assert.deepEqual(await sendEmail({ to: "student@example.test", subject: "Update", text: "Safe" }), { delivered: false, reason: "delivery_failed" });
    assert.deepEqual(warnings, ["[Email] Delivery failed."]);
    assert.doesNotMatch(JSON.stringify(warnings), /EAUTH|SECRET/);
  } finally { Object.assign(env, previous); console.warn = warning; resetEmailTransportFactoryForTests(); }
});

test("24-hour reminder processor is bounded, Confirmed-only, idempotent, and keeps in-app delivery when email is unavailable", async () => {
  const now = new Date("2026-12-15T00:00:00Z"), student = newId(), appointmentId = newId();
  const originalFind = Appointment.find, originalCreate = Notification.create, originalUser = User.findById;
  const records = [], keys = new Set();
  Appointment.find = filter => {
    assert.deepEqual(filter.status, "Confirmed");
    assert.equal(+filter.startAt.$gt, +now);
    assert.equal(+filter.startAt.$lte, +now + CONSULTATION_REMINDER_LEAD_MS);
    const chain = { select() { return chain; }, sort() { return chain; }, limit() { return chain; },
      async lean() { return [{ _id: appointmentId, student, startAt: new Date(+now + 3600000) }]; } };
    return chain;
  };
  Notification.create = async rows => {
    const key = rows[0].deduplicationKey;
    if (keys.has(key)) throw Object.assign(new Error("duplicate"), { code: 11000 });
    keys.add(key); records.push(...rows); return rows;
  };
  User.findById = () => { const chain = { select() { return chain; }, async lean() { return { email: "student@example.test" }; } }; return chain; };
  try {
    const first = await processConsultationReminders({ now });
    const second = await processConsultationReminders({ now });
    assert.deepEqual(first, { scanned: 1, created: 1, skipped: 0, errors: 0 });
    assert.deepEqual(second, { scanned: 1, created: 0, skipped: 1, errors: 0 });
    assert.equal(records.length, 1); assert.equal(records[0].type, "upcoming_reminder");
  } finally { Appointment.find = originalFind; Notification.create = originalCreate; User.findById = originalUser; }
});

test("Student UI excludes obsolete action items and performs only validated SOCConsult navigation", async () => {
  const view = await readFile(new URL("../../client/src/components/notifications/NotificationsView.jsx", import.meta.url), "utf8");
  const active = await readFile(new URL("../../client/src/components/appointments/StudentConsultationsView.jsx", import.meta.url), "utf8");
  const history = await readFile(new URL("../../client/src/pages/Student/StudentConsultationHistory.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(view, /Action Item|action_item|notification\.type === "task"/);
  assert.match(view, /\^\\\/student\\\/(?:\(\?:consultations\|history\)|\(consultations\|history\))/);
  assert.match(view, /navigate\(notification\.actionUrl\)/);
  assert.match(active, /searchParams\.get\("appointment"\)/);
  assert.match(history, /query\.set\("appointment", linkedAppointment\)/);
});
