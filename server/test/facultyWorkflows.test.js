import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceEnrollment } from "../src/config/attendance.js";
import { processAttendance } from "../src/services/attendanceService.js";
import { transitionAppointment } from "../src/services/appointmentTransitionService.js";
import { attendanceClassification } from "../src/services/attendanceReportingService.js";
import { buildFacultyReport } from "../src/services/facultyReportService.js";
import { canExportCalendar, generateConsultationIcs } from "../src/services/icsService.js";
import { addSlot, appointmentHarness, fixture } from "./helpers/appointmentHarness.js";

test("Faculty lifecycle integrates confirmation, calendar export, attendance, and report summaries", async () => {
  const harness = appointmentHarness();
  const appointment = fixture({ status: "Pending" });
  harness.state.appointments.push(appointment);
  addSlot(harness, appointment);
  const beforeStart = new Date(appointment.startAt.getTime() - 60_000);
  try {
    const confirmed = await transitionAppointment({
      id: appointment._id,
      actor: { id: appointment.faculty, role: "faculty" },
      action: "confirm",
      expectedVersion: 0,
      now: beforeStart,
    });
    assert.equal(confirmed.status, "Confirmed");
    assert.deepEqual(harness.state.appointments[0].attendance, attendanceEnrollment(appointment.endAt));
    assert.equal(canExportCalendar(confirmed, beforeStart), true);
    const calendar = generateConsultationIcs(confirmed).replace(/\r\n /g, "");
    for (const field of ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:", "DTSTAMP:", "DTSTART:", "DTEND:", "SUMMARY:", "END:VEVENT", "END:VCALENDAR"])
      assert.ok(calendar.includes(field), field);

    await processAttendance({ id: appointment._id, actor: { id: appointment.student, role: "student" }, input: { outcome: "Completed", reason: "Student response" }, now: appointment.endAt });
    await processAttendance({ id: appointment._id, actor: { id: appointment.faculty, role: "faculty" }, input: { outcome: "Completed", reason: "Faculty response" }, now: appointment.endAt });
    const finalized = harness.state.appointments[0];
    assert.equal(finalized.status, "Completed");
    assert.equal(finalized.attendance.finalOutcome, "Completed");
    assert.equal(attendanceClassification(finalized), "verifiedCompleted");

    const report = buildFacultyReport([finalized], { name: "Assigned Faculty" }, {
      startDate: "2099-01-01", endDate: "2099-01-01", status: "", attendanceOutcome: "", mode: "",
    }, new Date("2099-01-02T00:00:00Z"));
    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.status.Completed, 1);
    assert.equal(report.summary.attendance.Completed, 1);
    assert.equal(report.records[0].status, "Completed");
    assert.equal(report.records[0].attendanceOutcome, "Completed");
    assert.doesNotMatch(JSON.stringify(report), /narrative|recommendation|Groq|AI-generated/i);
  } finally {
    harness.restore();
  }
});
