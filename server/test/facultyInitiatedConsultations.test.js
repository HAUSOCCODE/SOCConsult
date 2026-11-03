import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import { createAppointmentRequest, transitionAppointment } from "../src/services/appointmentTransitionService.js";
import { buildConsultationEmail, facultyAppointmentEvent } from "../src/services/consultationNotificationService.js";
import { appointmentHarness, fixture, newId } from "./helpers/appointmentHarness.js";

const schedule = { startAt: new Date("2099-05-10T02:00:00Z"), endAt: new Date("2099-05-10T02:30:00Z"),
  consultationMode: "Face-to-Face", location: "Room <101>", subject: "Capstone <Review>", reason: "Discuss & verify requirements" };

test("Faculty creates one Pending participant-owned request and only the Student can decide it", async () => {
  const h = appointmentHarness(), faculty = newId(), student = newId();
  h.state.users.push({ _id: faculty, role: "faculty", accountStatus: "Active", email: "faculty@example.test" },
    { _id: student, role: "student", accountStatus: "Active", registrationStatus: "Approved", email: "student@example.test" });
  try {
    const created = await createAppointmentRequest({ actor: { id: faculty, role: "faculty" }, data: {
      student, faculty, bookingMethod: "schedule_request", ...schedule,
    }, now: new Date("2099-05-01T00:00:00Z") });
    assert.equal(created.status, "Pending");
    assert.equal(created.initiatedByRole, "faculty");
    assert.equal(String(created.faculty), faculty); assert.equal(String(created.student), student);
    assert.equal(h.state.notifications.filter(item => String(item.recipient) === student)[0].type, "faculty_request_received");
    assert.equal(h.state.holds.length, 30);
    await assert.rejects(transitionAppointment({ id: created._id, actor: { id: faculty, role: "faculty" }, action: "confirm", expectedVersion: 0,
      now: new Date("2099-05-01T00:00:00Z") }), error => error.statusCode === 403);
    const accepted = await transitionAppointment({ id: created._id, actor: { id: student, role: "student" }, action: "confirm", expectedVersion: 0,
      now: new Date("2099-05-01T00:00:00Z") });
    assert.equal(accepted.status, "Confirmed");
    assert.equal(h.state.notifications.some(item => item.type === "faculty_request_accepted" && String(item.recipient) === faculty), true);
  } finally { h.restore(); }
});

test("Student can decline or propose a schedule and the assigned Faculty alone responds", async () => {
  const h = appointmentHarness(), row = fixture({ initiatedByRole: "faculty", bookingMethod: "schedule_request",
    currentScheduleSource: "faculty_assigned", availability: undefined, reservationToken: undefined });
  h.state.appointments.push(row);
  try {
    await assert.rejects(transitionAppointment({ id: row._id, actor: { id: row.faculty, role: "faculty" }, action: "reject", reason: "No", expectedVersion: 0 }), error => error.statusCode === 403);
    const proposed = await transitionAppointment({ id: row._id, actor: { id: row.student, role: "student" }, action: "propose", reason: "Class conflict",
      schedule: { startAt: new Date("2099-01-01T03:00:00Z"), endAt: new Date("2099-01-01T03:30:00Z"), mode: "Online", meetingPlatform: "Teams" }, expectedVersion: 0 });
    assert.equal(proposed.status, "Reschedule Proposed");
    assert.equal(h.state.notifications.some(item => item.type === "faculty_student_reschedule_proposed"), true);
    await assert.rejects(transitionAppointment({ id: row._id, actor: { id: row.student, role: "student" }, action: "accept_proposal",
      expectedProposalAt: proposed.proposedAt, expectedVersion: 1 }), error => error.statusCode === 403);
    const accepted = await transitionAppointment({ id: row._id, actor: { id: row.faculty, role: "faculty" }, action: "accept_proposal",
      expectedProposalAt: proposed.proposedAt, expectedVersion: 1 });
    assert.equal(accepted.status, "Confirmed");
    assert.equal(accepted.startAt.getTime(), new Date("2099-01-01T03:00:00Z").getTime());
  } finally { h.restore(); }
});

test("legacy requests remain Student-initiated and notification direction stays compatible", () => {
  const legacy = new Appointment({ student: newId(), faculty: newId(), ...schedule, bookingMethod: "schedule_request" });
  assert.equal(legacy.initiatedByRole, "student");
  assert.equal(facultyAppointmentEvent("request", "student", legacy), "faculty_request_submitted");
});

test("branded consultation email escapes saved details and keeps the action button after them", () => {
  const email = buildConsultationEmail({ appointment: { ...schedule, initiatedByRole: "faculty", status: "Pending",
    faculty: { name: "Prof. Maria <Santos>" }, student: { name: "Juan & Cruz" } }, recipientRole: "student",
    subject: "New Consultation Request", message: "Please review this request.",
    url: "https://socconsult.example/student/consultations?appointment=0123456789abcdef01234567", request: true });
  assert.match(email.html, /SOCConsult.*School of Computing.*Holy Angel University/s);
  assert.match(email.html, /Capstone &lt;Review&gt;/); assert.doesNotMatch(email.html, /Capstone <Review>/);
  assert.ok(email.html.indexOf("Consultation Details") < email.html.indexOf("View Consultation Request"));
  assert.match(email.text, /Consultation Details[\s\S]*View Consultation Request:/);
  assert.match(email.text, /May 10, 2099/); assert.match(email.text, /10:00 AM/);
});

test("Faculty and Student interfaces expose directional request controls and authenticated deep-link recovery", async () => {
  const files = await Promise.all([
    readFile(new URL("../../client/src/components/appointments/FacultyConsultationsView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/appointments/StudentConsultationsView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/ProtectedRoute.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/auth/AuthPageContent.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(files[0], /Request Consultation/); assert.match(files[0], /Accept Student Proposal/);
  assert.match(files[1], /Requested by Faculty/); assert.match(files[1], /Respond to Faculty Request/);
  assert.match(files[2], /state=\{\{ from:/); assert.match(files[3], /allowedDestination \? from/);
});
