import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceEnrollment } from "../src/config/attendance.js";
import Appointment from "../src/models/Appointment.js";
import AttendanceReview from "../src/models/AttendanceReview.js";
import { loadReportData } from "../src/services/deanReportDataService.js";
import { fixture } from "./helpers/appointmentHarness.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";

for (const initiator of ["student", "faculty"]) {
  test(`${initiator} initiator report and counterpart dispute resolve once with distinct notices and updated analytics`, async () => {
    const h = await appointmentHttp();
    const aggregate = Appointment.aggregate;
    const createReview = AttendanceReview.create;
    try {
      const counterpart = initiator === "student" ? "faculty" : "student";
      const endAt = new Date(Date.now() - 60_000);
      const row = fixture({
        student: h.users.student.id, faculty: h.users.faculty.id, status: "Confirmed",
        initiatedByRole: initiator, createdAt: new Date(+endAt - 86_400_000),
        startAt: new Date(+endAt - 1_800_000), endAt,
        attendance: attendanceEnrollment(endAt, { initiatedByRole: initiator }),
      });
      h.state.appointments.push(row);
      const path = `/appointments/${row._id}`;
      const reviewPath = `/dean/attendance-review/${row._id}/actions`;
      const post = (path, role, body) => h.request(path, role, "POST", body);
      const initial = { outcome: "Completed" };
      assert.equal((await post(path + "/attendance-responses", counterpart, initial)).status, 403);
      assert.equal((await post(path + "/attendance-responses", initiator, initial)).status, 201);
      assert.equal((await post(path + "/attendance-responses", initiator, initial)).status, 409);
      assert.equal(h.state.responses.length, 1);
      assert.equal(h.state.responses[0].participantRole, initiator);
      assert.equal(h.state.appointments[0].attendance.finalizationSource, "initiator_report");
      const notices = () => h.state.notifications.filter(n => ["finalized", "faculty_finalized"].includes(n.type));
      const initialNotices = notices().map(n => [n.recipient, n.deduplicationKey]);
      assert.deepEqual(initialNotices, [
        [row.student, `finalized:${row._id}`],
        [row.faculty, `faculty_finalized:${row._id}`],
      ]);

      const dispute = { reason: "The reported outcome differs from my record." };
      assert.equal((await post(path + "/attendance-dispute", initiator, dispute)).status, 403);
      assert.equal((await post(path + "/attendance-dispute", counterpart, dispute)).status, 200);
      assert.equal(h.state.appointments[0].status, "Attendance Review");
      assert.equal(h.state.appointments[0].attendance.finalOutcome, null);
      const action = initiator === "student" ? "confirm_faculty_no_show" : "confirm_student_no_show";
      const finalOutcome = initiator === "student" ? "Faculty No-show" : "Student No-show";
      const decision = { action, reason: "Reviewed the attendance evidence", expectedVersion: h.state.appointments[0].__v };
      assert.equal((await post(reviewPath, "student", decision)).status, 403);
      assert.equal((await post(reviewPath, "faculty", decision)).status, 403);

      if (initiator === "student") {
        h.fail("audits");
        const beforeAuditFailure = structuredClone(h.state);
        assert.equal((await post(reviewPath, "dean", decision)).status, 503);
        assert.deepEqual(h.state, beforeAuditFailure);
        h.fail(undefined);

        AttendanceReview.create = async () => { throw Object.assign(new Error("Duplicate final review"), {
          code: 11000, keyPattern: { appointment: 1 },
        }); };
        const conflict = await post(reviewPath, "dean", decision);
        assert.equal(conflict.status, 409);
        assert.match((await conflict.json()).message, /already resolved/i);
        assert.deepEqual(h.state, beforeAuditFailure);
        AttendanceReview.create = createReview;

        // Fail on the second notification after the review, audit and first notice have been written.
        h.state.notifications.push({
          recipient: row.faculty,
          deduplicationKey: `faculty_finalized:${row._id}:v${decision.expectedVersion + 1}`,
        });
        const beforeNotificationFailure = structuredClone(h.state);
        const unavailable = await post(reviewPath, "dean", decision);
        assert.equal(unavailable.status, 503);
        assert.match((await unavailable.json()).message, /temporarily unavailable/i);
        assert.deepEqual(h.state, beforeNotificationFailure);
        h.state.notifications.pop();
      }

      const responses = await Promise.all([post(reviewPath, "dean", decision), post(reviewPath, "dean", decision)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      const resolved = await responses.find(response => response.status === 201).json();
      assert.equal(resolved.state, "Resolved");
      assert.equal(resolved.finalOutcome, finalOutcome);
      const stored = h.state.appointments[0];
      assert.equal(stored.status, "Completed");
      assert.equal(stored.__v, decision.expectedVersion + 1);
      assert.equal(stored.attendance.finalOutcome, finalOutcome);
      assert.equal(stored.attendance.finalizationSource, "dean_review");
      assert.equal(h.state.reviews.length, 1);
      assert.equal(h.state.reviews[0].isFinal, true);
      assert.equal(h.state.reviews[0].finalOutcome, finalOutcome);
      assert.equal(h.state.audits.filter(a => a.action === "attendance_review_resolved").length, 1);
      assert.deepEqual(notices().map(n => [n.recipient, n.deduplicationKey]), [
        ...initialNotices,
        [row.student, `finalized:${row._id}:v${stored.__v}`],
        [row.faculty, `faculty_finalized:${row._id}:v${stored.__v}`],
      ]);
      const afterResolution = structuredClone(h.state);
      const repeat = await post(reviewPath, "dean", { ...decision, expectedVersion: stored.__v });
      assert.equal(repeat.status, 409);
      assert.match((await repeat.json()).message, /resolved/i);
      assert.deepEqual(h.state, afterResolution);

      // Feed the report service from the records actually written by the handlers.
      Appointment.aggregate = ([{ $match: match }]) => ({
        option: async () => h.state.appointments.filter(record => {
          const [outcome] = match.$and;
          return record.createdAt >= match.createdAt.$gte && record.createdAt < match.createdAt.$lt &&
            record.status === outcome.status && record.attendance.finalOutcome === outcome["attendance.finalOutcome"] &&
            outcome["attendance.finalizationSource"].$in.includes(record.attendance.finalizationSource);
        }),
      });
      const start = new Date(+row.createdAt - 86_400_000).toISOString().slice(0, 10);
      const end = new Date(+row.createdAt + 86_400_000).toISOString().slice(0, 10);
      const report = await loadReportData({ start, end, attendanceOutcome: finalOutcome }, h.users.dean);
      assert.equal(report.summary.total, 1);
      assert.equal(report.summary.attendance[finalOutcome], 1);
      const previous = await loadReportData({ start, end, attendanceOutcome: initial.outcome }, h.users.dean);
      assert.equal(previous.summary.total, 0);
    } finally {
      Appointment.aggregate = aggregate;
      AttendanceReview.create = createReview;
      await h.close();
    }
  });
}
