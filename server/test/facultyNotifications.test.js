import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { FACULTY_CONSULTATION_EVENTS, createFacultyConsultationNotification,
  facultyAppointmentEvent, facultyConsultationPath } from "../src/services/consultationNotificationService.js";
import { processConsultationReminders } from "../src/services/consultationReminderService.js";
import { newId } from "./helpers/appointmentHarness.js";

test("Faculty notification catalog contains exactly the approved privacy-safe events", () => {
  assert.deepEqual(Object.keys(FACULTY_CONSULTATION_EVENTS), [
    "faculty_request_submitted", "faculty_proposal_accepted", "faculty_proposal_declined", "faculty_cancelled",
    "faculty_upcoming_reminder", "faculty_attendance_update_required", "faculty_student_attendance_submitted",
    "faculty_finalized", "faculty_attendance_review", "faculty_expired",
  ]);
  const neutral = FACULTY_CONSULTATION_EVENTS.faculty_student_attendance_submitted.join(" ");
  assert.match(neutral, /student has submitted an attendance response/i);
  assert.doesNotMatch(neutral, /Student No-show|Faculty No-show|reason/i);
  assert.equal(facultyAppointmentEvent("request", "student"), "faculty_request_submitted");
  assert.equal(facultyAppointmentEvent("accept_proposal", "student"), "faculty_proposal_accepted");
  assert.equal(facultyAppointmentEvent("reject_proposal", "student"), "faculty_proposal_declined");
  assert.equal(facultyAppointmentEvent("cancel", "faculty"), undefined);
  assert.equal(facultyAppointmentEvent("cancel", "student"), "faculty_cancelled");
  assert.equal(facultyAppointmentEvent("expire", "system"), "faculty_expired");
});

test("Faculty notifications use the trusted recipient, stable types, safe base routes, and occurrence keys", async () => {
  const faculty = newId(), appointmentId = newId(), records = [];
  const originalCreate = Notification.create, originalFindById = User.findById;
  User.findById = id => {
    assert.equal(String(id), faculty);
    const query = { select() { return query; }, session() { return query; }, async lean() { return { role: "faculty" }; } };
    return query;
  };
  Notification.create = async rows => { records.push(...rows); return rows; };
  try {
    for (const event of Object.keys(FACULTY_CONSULTATION_EVENTS))
      await createFacultyConsultationNotification({ faculty, appointmentId, event, transitionVersion: 7 });
    assert.equal(records.length, 10);
    assert.ok(records.every(row => String(row.recipient) === faculty && String(row.relatedEntityId) === appointmentId));
    assert.ok(records.every(row => row.actionUrl === "/faculty/appointments" && row.deduplicationKey.endsWith(":v7")));
    assert.equal(new Set(records.map(row => row.type)).size, 10);
    assert.doesNotMatch(JSON.stringify(records), /studentResponse|facultyResponse|attendance.*reason|password|smtp/i);
    assert.equal(facultyConsultationPath(appointmentId, "history", true), `/dean/faculty/history?appointment=${appointmentId}`);
    assert.throws(() => facultyConsultationPath("https://evil.test", "history"));
  } finally { Notification.create = originalCreate; User.findById = originalFindById; }
});

test("shared reminder processor creates one Student and one Faculty notice and deduplicates reruns", async () => {
  const appointmentId = newId(), student = newId(), faculty = newId(), keys = new Set(), records = [];
  const originalFind = Appointment.find, originalCreate = Notification.create, originalFindById = User.findById;
  Appointment.find = () => { const query = { select() { return query; }, sort() { return query; }, limit() { return query; },
    async lean() { return [{ _id: appointmentId, student, faculty, startAt: new Date("2026-11-01T01:00:00Z") }]; } }; return query; };
  User.findById = () => { const query = { select() { return query; }, session() { return query; }, async lean() { return { role: "faculty" }; } }; return query; };
  Notification.create = async rows => { const key = rows[0].deduplicationKey; if (keys.has(key)) throw Object.assign(new Error("duplicate"), { code: 11000 }); keys.add(key); records.push(...rows); return rows; };
  try {
    assert.deepEqual(await processConsultationReminders({ now: new Date("2026-11-01T00:00:00Z") }), { scanned: 1, created: 1, skipped: 0, errors: 0 });
    assert.deepEqual(await processConsultationReminders({ now: new Date("2026-11-01T00:00:00Z") }), { scanned: 1, created: 0, skipped: 1, errors: 0 });
    assert.deepEqual(records.map(row => row.type).sort(), ["faculty_upcoming_reminder", "upcoming_reminder"]);
  } finally { Appointment.find = originalFind; Notification.create = originalCreate; User.findById = originalFindById; }
});

test("Faculty notification UI preserves shared read controls and validates deep links", async () => {
  const view = await readFile(new URL("../../client/src/components/notifications/NotificationsView.jsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../../client/src/pages/Faculty/FacultyNotifications.jsx", import.meta.url), "utf8");
  const consultations = await readFile(new URL("../../client/src/components/appointments/FacultyConsultationsView.jsx", import.meta.url), "utf8");
  const requests = await readFile(new URL("../../client/src/pages/Faculty/AppointmentRequests.jsx", import.meta.url), "utf8");
  const history = await readFile(new URL("../../client/src/pages/Faculty/FacultyConsultationHistory.jsx", import.meta.url), "utf8");
  assert.match(page, /NotificationsView compact faculty/);
  assert.match(view, /facultyNotificationDestination/);
  assert.match(view, /Mark as Read|Mark Read/);
  assert.match(view, /\/notifications\/read-all/);
  assert.match(view, /Loading notifications/);
  assert.match(view, /No notifications yet/);
  assert.match(view, /Unable to load notifications/);
  assert.doesNotMatch(view, /Approve consultation|Reject consultation/);
  for (const source of [consultations, requests, history]) assert.match(source, /getAll\("appointment"\)\.length === 1/);
});
