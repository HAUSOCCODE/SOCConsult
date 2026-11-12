import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "../src/config/env.js";
import { resetEmailTransportFactoryForTests, sendEmail, setEmailTransportFactoryForTests } from "../src/services/emailService.js";
import { createAppointmentRequest, transitionAppointment } from "../src/services/appointmentTransitionService.js";
import { addSlot, appointmentHarness, fixture } from "./helpers/appointmentHarness.js";

const configureMail = (messages, failure) => {
  Object.assign(env, { smtpHost: "smtp.example.test", smtpPort: 587, smtpSecure: false,
    smtpUser: "test-user", smtpPass: "test-secret", emailFrom: "SOCConsult <no-reply@example.test>",
    clientUrl: "https://socconsult.example.test" });
  setEmailTransportFactoryForTests(() => ({ sendMail: async message => {
    messages.push(message);
    if (failure) throw Object.assign(new Error("provider detail must stay private"), failure);
    return { accepted: [message.to], messageId: "mock-id" };
  } }));
};

test("Gmail SMTP uses port 465, secure TLS, configured sender, and a grouped App Password without exposing it", async () => {
  const previous = { smtpHost: env.smtpHost, smtpPort: env.smtpPort, smtpSecure: env.smtpSecure,
    smtpUser: env.smtpUser, smtpPass: env.smtpPass, emailFrom: env.emailFrom };
  let sent;
  Object.assign(env, { smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true,
    smtpUser: "socconsult.notifications@gmail.com", smtpPass: "abcd efgh ijkl mnop",
    emailFrom: "SOCConsult Notifications <socconsult.notifications@gmail.com>" });
  setEmailTransportFactoryForTests(options => ({ sendMail: async message => { sent = { options, message }; } }));
  try {
    assert.deepEqual(await sendEmail({ to: "recipient@example.test", subject: "Safe", text: "Safe" }), { delivered: true });
    assert.equal(sent.options.host, "smtp.gmail.com"); assert.equal(sent.options.port, 465);
    assert.equal(sent.options.secure, true); assert.equal(sent.options.auth.pass, "abcdefghijklmnop");
    assert.equal(sent.message.from, "SOCConsult Notifications <socconsult.notifications@gmail.com>");
  } finally { Object.assign(env, previous); resetEmailTransportFactoryForTests(); }
});

test("Student request emails only the assigned Faculty from the persisted participant record", async () => {
  const h = appointmentHarness(), row = fixture({ reservationToken: undefined }), messages = [];
  const previous = { smtpHost: env.smtpHost, smtpPort: env.smtpPort, smtpSecure: env.smtpSecure,
    smtpUser: env.smtpUser, smtpPass: env.smtpPass, emailFrom: env.emailFrom, clientUrl: env.clientUrl };
  h.state.users.push({ _id: row.student, role: "student", email: "student@example.test", name: "Student User" },
    { _id: row.faculty, role: "faculty", email: "assigned-faculty@hau.edu.ph", name: "Faculty User" });
  addSlot(h, row); configureMail(messages);
  try {
    const created = await createAppointmentRequest({ data: row, actor: { id: row.student, role: "student" },
      now: new Date("2098-12-01T00:00:00Z") });
    assert.equal(created.status, "Pending"); assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "assigned-faculty@hau.edu.ph");
    assert.equal(messages[0].subject, "[SOCConsult] New Consultation Request");
    assert.match(messages[0].html, /View Consultation Request/);
    assert.match(messages[0].html, new RegExp(`/faculty/consultations\\?appointment=${created._id}`));
  } finally { h.restore(); Object.assign(env, previous); resetEmailTransportFactoryForTests(); }
});

test("Faculty request emails only the selected Student from the persisted participant record", async () => {
  const h = appointmentHarness(), row = fixture({ bookingMethod: "schedule_request", currentScheduleSource: "faculty_assigned",
    availability: undefined, reservationToken: undefined }), messages = [];
  const previous = { smtpHost: env.smtpHost, smtpPort: env.smtpPort, smtpSecure: env.smtpSecure,
    smtpUser: env.smtpUser, smtpPass: env.smtpPass, emailFrom: env.emailFrom, clientUrl: env.clientUrl };
  h.state.users.push({ _id: row.student, role: "student", email: "selected-student@student.hau.edu.ph", name: "Student User" },
    { _id: row.faculty, role: "faculty", email: "faculty@example.test", name: "Faculty User" });
  configureMail(messages);
  try {
    const created = await createAppointmentRequest({ data: row, actor: { id: row.faculty, role: "faculty" },
      now: new Date("2098-12-01T00:00:00Z") });
    assert.equal(created.status, "Pending"); assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "selected-student@student.hau.edu.ph");
    assert.equal(messages[0].subject, "[SOCConsult] New Consultation Request from Faculty");
    assert.match(messages[0].html, /View Consultation Request/);
    assert.match(messages[0].html, new RegExp(`/student/consultations\\?appointment=${created._id}`));
  } finally { h.restore(); Object.assign(env, previous); resetEmailTransportFactoryForTests(); }
});

test("Faculty confirmation emails the registered Student once with Manila details and a participant deep link", async () => {
  const h = appointmentHarness(), row = fixture({ consultationMode: "Face-to-Face", location: "SJH - 401",
    subject: "Capstone Review", reason: "Review project progress" }), messages = [];
  const previous = { smtpHost: env.smtpHost, smtpPort: env.smtpPort, smtpSecure: env.smtpSecure,
    smtpUser: env.smtpUser, smtpPass: env.smtpPass, emailFrom: env.emailFrom, clientUrl: env.clientUrl };
  h.state.appointments.push(row); addSlot(h, row);
  h.state.users.push({ _id: row.student, role: "student", email: "registered@student.hau.edu.ph", name: "Student User" },
    { _id: row.faculty, role: "faculty", email: "faculty@hau.edu.ph", name: "Faculty User" });
  configureMail(messages);
  try {
    const confirmed = await transitionAppointment({ id: row._id, actor: { id: row.faculty, role: "faculty" },
      action: "confirm", expectedVersion: 0, now: new Date("2098-12-01T00:00:00Z") });
    assert.equal(confirmed.status, "Confirmed");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "registered@student.hau.edu.ph");
    assert.equal(messages[0].subject, "[SOCConsult] Your Consultation Has Been Confirmed");
    assert.match(messages[0].html, /Capstone Review/); assert.match(messages[0].html, /SJH - 401/);
    assert.match(messages[0].html, /January 1, 2099/); assert.match(messages[0].html, /10:00 AM/);
    assert.match(messages[0].html, new RegExp(`/student/consultations\\?appointment=${row._id}`));
    assert.ok(messages[0].html.indexOf("Consultation Details") < messages[0].html.indexOf("View Consultation"));
    await assert.rejects(transitionAppointment({ id: row._id, actor: { id: row.faculty, role: "faculty" },
      action: "confirm", now: new Date("2098-12-01T00:00:00Z") }));
    assert.equal(messages.length, 1, "a repeated command must not send another confirmation email");
  } finally { h.restore(); Object.assign(env, previous); resetEmailTransportFactoryForTests(); }
});

test("Student acceptance of a Faculty request emails the registered Faculty counterpart", async () => {
  const h = appointmentHarness(), row = fixture({ initiatedByRole: "faculty", bookingMethod: "schedule_request",
    currentScheduleSource: "faculty_assigned", availability: undefined, reservationToken: undefined }), messages = [];
  const previous = { smtpHost: env.smtpHost, smtpPort: env.smtpPort, smtpSecure: env.smtpSecure,
    smtpUser: env.smtpUser, smtpPass: env.smtpPass, emailFrom: env.emailFrom, clientUrl: env.clientUrl };
  h.state.appointments.push(row);
  h.state.users.push({ _id: row.student, role: "student", email: "student@example.test" },
    { _id: row.faculty, role: "faculty", email: "registered-faculty@hau.edu.ph" });
  configureMail(messages);
  try {
    const confirmed = await transitionAppointment({ id: row._id, actor: { id: row.student, role: "student" },
      action: "confirm", expectedVersion: 0, now: new Date("2098-12-01T00:00:00Z") });
    assert.equal(confirmed.status, "Confirmed"); assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "registered-faculty@hau.edu.ph");
    assert.equal(messages[0].subject, "[SOCConsult] Student Accepted Your Consultation Request");
    assert.match(messages[0].html, new RegExp(`/faculty/consultations\\?appointment=${row._id}`));
  } finally { h.restore(); Object.assign(env, previous); resetEmailTransportFactoryForTests(); }
});

test("Faculty acceptance of a Student proposal sends confirmation and SMTP failure cannot roll back it", async () => {
  const h = appointmentHarness(), row = fixture({ status: "Reschedule Proposed", initiatedByRole: "student",
    proposedStartAt: new Date("2099-01-02T02:00:00Z"), proposedEndAt: new Date("2099-01-02T02:30:00Z"),
    proposedConsultationMode: "Online", proposedMeetingPlatform: "Microsoft Teams", proposedBy: undefined,
    proposedAt: new Date("2098-12-02T00:00:00Z") }), messages = [];
  row.proposedBy = row.student;
  const previous = { smtpHost: env.smtpHost, smtpPort: env.smtpPort, smtpSecure: env.smtpSecure,
    smtpUser: env.smtpUser, smtpPass: env.smtpPass, emailFrom: env.emailFrom, clientUrl: env.clientUrl };
  h.state.appointments.push(row);
  h.state.users.push({ _id: row.student, role: "student", email: "student@example.test" },
    { _id: row.faculty, role: "faculty", email: "faculty@example.test" });
  configureMail(messages, { code: "ETIMEDOUT" });
  const warning = console.warn, warnings = []; console.warn = value => warnings.push(value);
  try {
    const confirmed = await transitionAppointment({ id: row._id, actor: { id: row.faculty, role: "faculty" },
      action: "accept_proposal", expectedProposalAt: row.proposedAt, expectedVersion: 0,
      now: new Date("2098-12-03T00:00:00Z") });
    assert.equal(confirmed.status, "Confirmed"); assert.equal(h.state.appointments[0].status, "Confirmed");
    assert.equal(messages.length, 1); assert.equal(messages[0].to, "student@example.test");
    assert.equal(messages[0].subject, "[SOCConsult] Your Consultation Has Been Confirmed");
    assert.ok(warnings.some(value => value === "[Email] Delivery failed reason=connection_failed."));
    assert.doesNotMatch(warnings.join(" "), /provider detail|test-secret/);
  } finally { console.warn = warning; h.restore(); Object.assign(env, previous); resetEmailTransportFactoryForTests(); }
});
