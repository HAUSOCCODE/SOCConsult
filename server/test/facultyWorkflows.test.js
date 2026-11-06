import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceEnrollment } from "../src/config/attendance.js";
import { processAttendance } from "../src/services/attendanceService.js";
import { transitionAppointment } from "../src/services/appointmentTransitionService.js";
import { attendanceClassification } from "../src/services/attendanceReportingService.js";
import { buildFacultyReport } from "../src/services/facultyReportService.js";
import { canExportCalendar, generateConsultationIcs } from "../src/services/icsService.js";
import { addSlot, appointmentHarness, fixture } from "./helpers/appointmentHarness.js";
import cloudinary from "../src/config/cloudinary.js";

test("Faculty lifecycle integrates confirmation, calendar export, attendance, and report summaries", async () => {
  const harness = appointmentHarness();
  const appointment = fixture({ status: "Pending", initiatedByRole: "student" });
  const oldUpload = cloudinary.uploader.upload_stream;
  cloudinary.uploader.upload_stream = (_options, callback) => ({ end: () => callback(null, {
    secure_url: "https://provider.invalid/private", public_id: "consultio/outcome-proofs/workflow", resource_type: "image",
  }) });
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
    assert.deepEqual(harness.state.appointments[0].attendance, attendanceEnrollment(appointment.endAt, { initiatedByRole: "student" }));
    assert.equal(canExportCalendar(confirmed, beforeStart), true);
    const calendar = generateConsultationIcs(confirmed).replace(/\r\n /g, "");
    for (const field of ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:", "DTSTAMP:", "DTSTART:", "DTEND:", "SUMMARY:", "END:VEVENT", "END:VCALENDAR"])
      assert.ok(calendar.includes(field), field);

    await processAttendance({ id: appointment._id, actor: { id: appointment.student, role: "student" }, input: {
      outcome: "Completed", reason: "Student response", proofFile: { originalname: "proof.jpg", mimetype: "image/jpeg",
        size: 4, buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    }, now: appointment.endAt });
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
    cloudinary.uploader.upload_stream = oldUpload;
    harness.restore();
  }
});
