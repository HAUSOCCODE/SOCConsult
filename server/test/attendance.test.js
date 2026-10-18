import assert from "node:assert/strict";
import { test } from "node:test";
import AttendanceResponse from "../src/models/AttendanceResponse.js";
import { attendanceEnrollment, ATTENDANCE_OUTCOMES } from "../src/config/attendance.js";
import { processAttendance, readAttendance, attendanceDecision } from "../src/services/attendanceService.js";
import { participation, monitoringAttendance } from "../src/services/attendancePrivacyService.js";
import { attendanceClassification } from "../src/services/attendanceReportingService.js";
import { runAppointmentAttendance } from "../src/services/attendanceProcessingService.js";
import { assertTransition, transitionAppointment } from "../src/services/appointmentTransitionService.js";
import { appointmentHarness, fixture, newId, addSlot } from "./helpers/appointmentHarness.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { runAttendanceCommand } from "../scripts/process-appointment-attendance.mjs";
import { processAttendanceBatch } from "../src/services/attendanceProcessingService.js";
import Appointment from "../src/models/Appointment.js";
import { attendanceCounts, verifiedCompletedFilter } from "../src/services/attendanceReportingService.js";

const setup = () => {
  const h = appointmentHarness(), row = fixture({ status: "Confirmed" });
  row.attendance = attendanceEnrollment(row.endAt); h.state.appointments.push(row);
  return { h, row, now: new Date(row.endAt), actor: role => ({ id: row[role], role }) };
};
for (const student of ATTENDANCE_OUTCOMES) for (const faculty of ATTENDANCE_OUTCOMES) {
  test(`two independent responses: ${student} / ${faculty}`, async () => {
    const { h, row, now, actor } = setup();
    try {
      await processAttendance({ id: row._id, actor: actor("student"), input: { outcome: student, reason: "my private reason" }, now });
      const hidden = await readAttendance({ id: row._id, actor: actor("faculty"), now });
      assert.equal(hidden.ownResponse, null); assert.equal(hidden.outcomes, undefined);
      assert.doesNotMatch(JSON.stringify(hidden), /my private reason|studentResponded/);
      const own = await readAttendance({ id: row._id, actor: actor("student"), now });
      assert.equal(own.ownResponse.reason, "my private reason"); assert.equal(own.waiting, true);
      await processAttendance({ id: row._id, actor: actor("faculty"), input: { outcome: faculty, reason: "faculty private reason" }, now });
      const stored = h.state.appointments[0];
      assert.equal(stored.status, student === faculty ? "Completed" : "Attendance Review");
      assert.equal(stored.attendance.finalOutcome, student === faculty ? student : null);
      assert.deepEqual(stored.statusHistory.map(e => e.newStatus), ["Awaiting Attendance Update", stored.status]);
      assert.equal(h.state.responses.length, 2);
      assert.equal(h.state.notifications.length, 5);
      assert.equal(h.state.notifications.filter(notification => notification.type === "attendance_response_received").length, 1);
      assert.doesNotMatch(JSON.stringify([h.state.audits, h.state.notifications, stored.statusHistory]), /private reason/);
      const view = await readAttendance({ id: row._id, actor: actor("student"), now });
      assert.deepEqual(view.outcomes, { student, faculty });
      assert.doesNotMatch(JSON.stringify(view), /faculty private reason/);
    } finally { h.restore(); }
  });
}
test("end and deadline boundaries, identity, duplicate response and read-only GET", async () => {
  const { h, row, now, actor } = setup();
  try {
    const before = JSON.stringify(h.state);
    await readAttendance({ id: row._id, actor: actor("student"), now });
    assert.equal(JSON.stringify(h.state), before);
    await assert.rejects(processAttendance({ id: row._id, actor: actor("student"), input: { outcome: "Completed" }, now: new Date(+now - 1) }), /not opened/);
    for (const user of [{ id: newId(), role: "student" }, { id: newId(), role: "faculty" }, { id: newId(), role: "dean" }, { ...actor("faculty"), role: "dean", management: true }])
      await assert.rejects(processAttendance({ id: row._id, actor: user, input: { outcome: "Completed" }, now }), /not found/);
    for (const input of [{ outcome: "Completed", participantRole: "faculty" }, { outcome: "Completed", participant: row.faculty }, { outcome: "Completed", reason: 4 }, { outcome: "Completed", reason: "x".repeat(501) }])
      await assert.rejects(processAttendance({ id: row._id, actor: actor("student"), input, now }));
    await processAttendance({ id: row._id, actor: actor("student"), input: { outcome: "Completed" }, now });
    await assert.rejects(processAttendance({ id: row._id, actor: actor("student"), input: { outcome: "Faculty No-show" }, now }), /already/);
    await assert.rejects(processAttendance({ id: row._id, actor: actor("faculty"), input: { outcome: "Completed" }, now: row.attendance.responseDeadlineAt }), /deadline/);
    await processAttendance({ id: row._id, actor: { ...actor("faculty"), role: "dean" }, input: { outcome: "Completed" }, now: new Date(+row.attendance.responseDeadlineAt - 1) });
    assert.equal(h.state.appointments[0].status, "Completed");
  } finally { h.restore(); }
});
for (const present of [[], ["student"], ["faculty"]]) test(`deadline missing responses: ${present}`, async () => {
  const { h, row, now, actor } = setup();
  try {
    for (const role of present) await processAttendance({ id: row._id, actor: actor(role), input: { outcome: "Completed" }, now });
    const deadline = row.attendance.responseDeadlineAt;
    const result = await Promise.all([processAttendance({ id: row._id, now: deadline }), processAttendance({ id: row._id, now: deadline })]);
    assert.equal(result.filter(Boolean).length, 1);
    const stored = h.state.appointments[0]; assert.equal(stored.status, "Attendance Review");
    assert.equal(stored.attendance.reviewReason, !present.length ? "both_responses_missing" : present[0] === "student" ? "faculty_response_missing" : "student_response_missing");
    assert.equal(h.state.responses.length, present.length);
    assert.equal(stored.statusHistory.filter(e => e.newStatus === "Attendance Review").length, 1);
  } finally { h.restore(); }
});
test("concurrent submissions, transaction retries and rollback", async () => {
  for (const failure of ["responses", "appointments", "audits", "notifications", null]) {
    const { h, row, now, actor } = setup();
    try {
      if (failure) {
        const before = JSON.stringify(h.state); h.fail(failure);
        await assert.rejects(processAttendance({ id: row._id, actor: actor("student"), input: { outcome: "Completed" }, now }));
        assert.equal(JSON.stringify(h.state), before);
      } else {
        h.retry();
        const results = await Promise.allSettled(["student", "student", "faculty"].map(role => processAttendance({ id: row._id, actor: actor(role), input: { outcome: "Completed" }, now })));
        assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
        assert.equal(h.state.responses.length, 2); assert.equal(h.state.appointments[0].status, "Completed");
        assert.equal(h.state.notifications.length, 5);
        assert.equal(h.state.notifications.filter(notification => notification.type === "attendance_response_received").length, 1);
      }
    } finally { h.restore(); }
  }
});
test("prospective enrollment and reschedule timing", async () => {
  const { h, row, actor } = setup();
  try {
    const before = new Date(+row.startAt - 86400000);
    addSlot(h, row);
    const schedule = { startAt: new Date(+row.startAt + 86400000), endAt: new Date(+row.endAt + 86400000), mode: "Online", meetingPlatform: "Teams" };
    await transitionAppointment({ id: row._id, actor: actor("faculty"), action: "propose", reason: "New schedule", schedule, now: before });
    const proposed = h.state.appointments[0];
    await transitionAppointment({ id: row._id, actor: actor("student"), action: "accept_proposal", expectedProposalAt: proposed.proposedAt, now: before });
    const stored = h.state.appointments[0];
    assert.equal(+stored.attendance.attendanceOpensAt, +schedule.endAt);
    assert.equal(+stored.attendance.responseDeadlineAt, +schedule.endAt + 48 * 3600000);
    assert.equal(stored.scheduleHistory.length, 1);
    for (const attendance of [{ ...stored.attendance, studentResponded: true }, { ...stored.attendance, attendanceOpensAt: before }])
      assert.throws(() => assertTransition({ appointment: { ...stored, attendance }, actor: actor("faculty"), action: "propose", now: before }), /Attendance/);
    assert.throws(() => assertTransition({ appointment: stored, actor: actor("faculty"), action: "Completed", now: before }));
    const legacy = fixture({ status: "Confirmed" }); h.state.appointments.push(legacy);
    const snapshot = JSON.stringify(legacy);
    assert.equal(await processAttendance({ id: legacy._id, now: legacy.endAt }), false);
    assert.equal(JSON.stringify(h.state.appointments[1]), snapshot);
  } finally { h.restore(); }
});
test("schema uniqueness, immutable operations, reporting and safe monitoring", async () => {
  const indexes = AttendanceResponse.schema.indexes();
  for (const field of ["participant", "participantRole"]) assert.ok(indexes.some(([keys, opts]) => keys.appointment === 1 && keys[field] === 1 && opts.unique));
  for (const operation of [() => AttendanceResponse.updateOne({}, { outcome: "Completed" }), () => AttendanceResponse.deleteMany({}), () => AttendanceResponse.replaceOne({}, {})]) await assert.rejects(operation(), /immutable/);
  await assert.rejects(AttendanceResponse.bulkWrite([{ deleteMany: { filter: {} } }]), /immutable/);
  await assert.rejects(AttendanceResponse.hydrate({ _id: newId() }).deleteOne(), /immutable/);
  const row = fixture({ status: "Completed", attendance: { ...attendanceEnrollment(new Date()), finalizationSource: "participant_agreement", finalOutcome: "Student No-show", reason: "PRIVATE" } });
  assert.equal(attendanceClassification(row), "studentNoShow");
  assert.equal(attendanceClassification({ status: "Completed" }), "historicalUnverifiedCompleted");
  assert.equal(attendanceClassification({ status: "Attendance Review" }), "attendanceReview");
  assert.doesNotMatch(JSON.stringify(monitoringAttendance(row)), /PRIVATE|Responded/);
  assert.equal(participation(row, { id: row.faculty, role: "dean" }), "faculty");
  assert.equal(attendanceDecision([], false), null);
});
test("bounded processor sweep cursor and incomplete result", async () => {
  const calls = [];
  const result = await runAppointmentAttendance({ batchSize: 1, maxBatches: 2, processBatch: async args => {
    calls.push(args); return { attempted: 1, changed: 1, skipped: 0, failed: 0, nextCursor: String(calls.length) };
  } });
  assert.equal(calls[1].afterId, "1"); assert.equal(result.incomplete, 1);
  assert.equal((await runAppointmentAttendance({ processBatch: async () => { throw new Error("private"); } })).errors, 1);
});
test("HTTP authentication, ownership, privacy, safe errors, and index deployment gate", async () => {
  const h = await appointmentHttp();
  const row = fixture({ status: "Confirmed", student: h.users.student.id, faculty: h.users.dean.id,
    startAt: new Date(Date.now() - 7200000), endAt: new Date(Date.now() - 3600000) });
  row.attendance = attendanceEnrollment(row.endAt); h.state.appointments.push(row);
  try {
    const unauthenticated = await h.request(`/appointments/${row._id}/attendance`, null);
    assert.equal(unauthenticated.status, 401); assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
    const response = await h.request(`/appointments/${row._id}/attendance`);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).attendance.eligible, true);
    assert.equal((await h.request(`/appointments/${row._id}/attendance`, "otherStudent")).status, 404);
    assert.equal((await h.request(`/appointments/${row._id}/attendance-responses`, "faculty", "POST", { outcome: "Completed" })).status, 404);
    assert.equal((await h.request(`/dean/appointments/${row._id}/attendance-responses`, "dean", "POST", { outcome: "Completed" })).status, 403);
    assert.equal((await h.request(`/appointments/${row._id}/attendance-responses`, "student", "POST", { outcome: "Completed", participantRole: "faculty" })).status, 400);
    const indexes = AttendanceResponse.collection.indexes;
    AttendanceResponse.collection.indexes = async () => [];
    try {
      const blocked = await h.request(`/appointments/${row._id}/attendance-responses`, "student", "POST", { outcome: "Completed" });
      assert.equal(blocked.status, 503); assert.equal(h.state.responses.length, 0);
    } finally { AttendanceResponse.collection.indexes = indexes; }
    assert.equal((await h.request(`/appointments/${row._id}/attendance-responses`, "student", "POST", { outcome: "Completed", reason: "student secret" })).status, 201);
    const mine = await (await h.request("/appointments/mine", "student")).json();
    assert.doesNotMatch(JSON.stringify(mine), /student secret|studentResponded|facultyResponded/);
    assert.equal(mine.appointments[0].attendance, undefined);
    const hidden = await (await h.request(`/appointments/${row._id}/attendance`, "dean")).json();
    assert.doesNotMatch(JSON.stringify(hidden), /student secret|Responded|participant/);
    assert.equal((await h.request(`/appointments/${row._id}/attendance-responses`, "dean", "POST", { outcome: "Completed" })).status, 201);
    assert.equal(h.state.responses[1].participantRole, "faculty");
    assert.ok(h.state.notifications.some(n => n.actionUrl === "/dean/faculty/consultations"));
    const before = JSON.stringify(h.state);
    assert.equal((await h.request(`/appointments/${row._id}/attendance-responses`, "student", "DELETE")).status, 404);
    assert.equal(JSON.stringify(h.state), before);
  } finally { await h.close(); }
});
test("processor excludes historical states, opens once, and handles deadlines in one sweep", async () => {
  const { h, row, now } = setup();
  try {
    const historical = ["Confirmed", "Completed", "Awaiting Attendance Update", "Attendance Review", "No Show"].map(status => fixture({ status }));
    h.state.appointments.push(...historical);
    const result = await processAttendanceBatch({ now, limit: 100 });
    assert.equal(result.changed, 1);
    assert.equal(await processAttendance({ id: row._id, now }), false);
    assert.deepEqual(h.state.appointments.slice(1), historical);
    await processAttendance({ id: row._id, now: row.attendance.responseDeadlineAt });
    assert.equal(h.state.appointments[0].status, "Attendance Review");
  } finally { h.restore(); }
});
test("one-shot command only emits numeric aggregates and reports failures", async () => {
  const lines = []; let disconnected = 0;
  const options = { mongoUri: "isolated-placeholder", connect: async () => {}, disconnect: async () => { disconnected++; }, write: line => lines.push(JSON.parse(line)) };
  assert.equal(await runAttendanceCommand({ ...options, processRun: async () => ({ attempted: 1, changed: 1, skipped: 0, failed: 0, errors: 0, incomplete: 0, participant: "SECRET" }) }), 0);
  assert.doesNotMatch(JSON.stringify(lines), /SECRET|participant/);
  assert.equal(await runAttendanceCommand({ ...options, processRun: async () => { throw new Error("SECRET URI"); } }), 1);
  assert.equal(disconnected, 2);
  assert.equal(await runAttendanceCommand({ ...options, processRun: async () => ({ attempted: -1 }) }), 1);
});
test("reporting separates all outcomes and casts ownership in aggregation", async () => {
  const previous = Appointment.aggregate, owner = newId();
  Appointment.aggregate = async pipeline => {
    assert.equal(pipeline[0].$match.student.toHexString(), owner);
    return [
      ...ATTENDANCE_OUTCOMES.map(outcome => ({ _id: { status: "Completed", outcome, source: "participant_agreement" }, count: 2 })),
      { _id: { status: "Completed" }, count: 5 }, { _id: { status: "Attendance Review" }, count: 3 },
      { _id: { status: "No Show" }, count: 10 },
    ];
  };
  try {
    assert.deepEqual(await attendanceCounts({ student: owner }), { verifiedCompleted: 2, studentNoShow: 2, facultyNoShow: 2, historicalUnverifiedCompleted: 5, attendanceReview: 3 });
    assert.equal(verifiedCompletedFilter["attendance.finalOutcome"], "Completed");
  } finally { Appointment.aggregate = previous; }
});
