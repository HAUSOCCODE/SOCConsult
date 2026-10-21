import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { attendanceEnrollment, ATTENDANCE_OUTCOMES } from "../src/config/attendance.js";
import { processAttendance, readAttendance } from "../src/services/attendanceService.js";
import { appointmentHarness, fixture, newId } from "./helpers/appointmentHarness.js";

const setup = (status = "Confirmed") => {
  const harness = appointmentHarness();
  const appointment = fixture({ status });
  appointment.attendance = attendanceEnrollment(appointment.endAt);
  harness.state.appointments.push(appointment);
  const actor = role => ({ id: appointment[role], role });
  return { harness, appointment, actor, now: new Date(appointment.endAt) };
};

test("assigned Faculty submits each canonical outcome without changing Student response", async () => {
  for (const outcome of ATTENDANCE_OUTCOMES) {
    const { harness, appointment, actor, now } = setup();
    try {
      await processAttendance({ id: appointment._id, actor: actor("student"), input: { outcome, reason: "student private" }, now });
      await processAttendance({ id: appointment._id, actor: actor("faculty"), input: { outcome, reason: "  faculty context  " }, now });
      assert.deepEqual(harness.state.responses.map(response => response.participantRole), ["student", "faculty"]);
      assert.equal(harness.state.responses[0].reason, "student private");
      assert.equal(harness.state.responses[1].reason, "faculty context");
      assert.equal(harness.state.appointments[0].status, "Completed");
      assert.equal(harness.state.appointments[0].attendance.finalOutcome, outcome);
      assert.deepEqual(harness.state.appointments[0].statusHistory.map(event => event.newStatus), ["Awaiting Attendance Update", "Completed"]);
    } finally { harness.restore(); }
  }
});

test("Faculty privacy, ownership, timing, payload and duplicate protections fail closed", async () => {
  const { harness, appointment, actor, now } = setup();
  try {
    await processAttendance({ id: appointment._id, actor: actor("student"), input: { outcome: "Completed", reason: "student private" }, now });
    const facultyView = await readAttendance({ id: appointment._id, actor: actor("faculty"), now });
    assert.equal(facultyView.ownResponse, null);
    assert.equal(facultyView.outcomes, undefined);
    assert.doesNotMatch(JSON.stringify(facultyView), /student private|studentResponded|participant/);
    await assert.rejects(processAttendance({ id: appointment._id, actor: actor("faculty"), input: { outcome: "Completed" }, now: new Date(+now - 1) }), /not opened/);
    await assert.rejects(processAttendance({ id: appointment._id, actor: { id: newId(), role: "faculty" }, input: { outcome: "Completed" }, now }), /not found/);
    await assert.rejects(processAttendance({ id: appointment._id, actor: actor("student"), input: { outcome: "Completed", status: "Completed" }, now }), /Invalid/);
    await assert.rejects(processAttendance({ id: appointment._id, actor: actor("faculty"), input: { outcome: "Present" }, now }), /Invalid/);
    await processAttendance({ id: appointment._id, actor: actor("faculty"), input: { outcome: "Completed" }, now });
    await assert.rejects(processAttendance({ id: appointment._id, actor: actor("faculty"), input: { outcome: "Faculty No-show" }, now }), /unavailable|already/);
    assert.equal(harness.state.responses.find(response => response.participantRole === "faculty").outcome, "Completed");
  } finally { harness.restore(); }
});

test("conflicts review automatically and ineligible terminal records reject Faculty submission", async () => {
  const { harness, appointment, actor, now } = setup();
  try {
    await processAttendance({ id: appointment._id, actor: actor("student"), input: { outcome: "Completed" }, now });
    await processAttendance({ id: appointment._id, actor: actor("faculty"), input: { outcome: "Student No-show" }, now });
    assert.equal(harness.state.appointments[0].status, "Attendance Review");
    assert.equal(harness.state.appointments[0].attendance.finalOutcome, null);
    assert.equal(harness.state.appointments[0].attendance.reviewReason, "responses_conflict");
  } finally { harness.restore(); }
  for (const status of ["Pending", "Reschedule Proposed", "Rejected", "Cancelled", "Expired", "Completed", "Attendance Review"]) {
    const current = setup(status);
    try {
      await assert.rejects(processAttendance({ id: current.appointment._id, actor: current.actor("faculty"), input: { outcome: "Completed" }, now: current.now }), /unavailable/);
    } finally { current.harness.restore(); }
  }
});

test("assigned Dean consultant retains Faculty participation without management privilege", async () => {
  const { harness, appointment, now } = setup();
  try {
    await processAttendance({ id: appointment._id, actor: { id: appointment.faculty, role: "dean" }, input: { outcome: "Faculty No-show" }, now });
    assert.equal(harness.state.responses[0].participantRole, "faculty");
    await assert.rejects(processAttendance({ id: appointment._id, actor: { id: appointment.faculty, role: "dean", management: true }, input: { outcome: "Completed" }, now }), /not found/);
  } finally { harness.restore(); }
});

test("Faculty UI exposes only attendance outcomes and relies on shared attendance endpoint", async () => {
  const [form, details, view, privacy, service] = await Promise.all([
    readFile(new URL("../../client/src/components/attendance/FacultyAttendanceForm.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/appointments/PersonalConsultationDetails.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/appointments/FacultyConsultationsView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/attendancePrivacyService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/attendanceService.js", import.meta.url), "utf8"),
  ]);
  assert.equal((form.match(/value: "(?:Completed|Student No-show|Faculty No-show)"/g) || []).length, 3);
  assert.match(form, /attendance-responses/);
  assert.match(form, /pending\.current/);
  assert.match(form, /\{ outcome, \.\.\.\(reason\.trim\(\)/);
  assert.doesNotMatch(form, /status:\s*"(?:Completed|Attendance Review|Expired)"|facultyId|studentResponse/);
  assert.match(details, /attendance\?\.eligible && <FacultyAttendanceForm/);
  assert.match(details, /This attendance record requires review/);
  assert.match(details, /attendance\.ownResponse\.submittedAt/);
  assert.match(view, /onAttendanceSubmitted/);
  assert.match(privacy, /own && responses\.length === 2/);
  assert.match(service, /bestEffortStudentConsultationEmail/);
});
