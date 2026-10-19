import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTransition, transitionAppointment } from "../src/services/appointmentTransitionService.js";
import { detailRecord, facultyConsultationDetails, sectionFor } from "../src/services/facultyConsultationService.js";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../src/config/appointmentStatus.js";
import { appointmentHarness, fixture, addSlot, newId, clone } from "./helpers/appointmentHarness.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { env } from "../src/config/env.js";
import { setEmailTransportFactoryForTests, resetEmailTransportFactoryForTests } from "../src/services/emailService.js";

const now = new Date("2026-10-19T04:00:00Z");
const actor = (row, role = "faculty") => ({ id: role === "student" ? row.student : row.faculty, role });
const command = (row, extra = {}) => ({ id: row._id, actor: actor(row), action: "cancel", reason: "Unavailable", expectedVersion: 0, now, ...extra });

test("cancellation matrix preserves pre-start and unscheduled exception for all participants", () => {
  for (const role of ["faculty", "dean", "student"]) {
    for (const status of [...APPOINTMENT_STATUSES, ...LEGACY_APPOINTMENT_STATUSES]) {
      for (const offset of [-1, 0, 1]) {
        const row = fixture({ status, startAt: new Date(+now + offset), endAt: new Date(+now + 60000) });
        const input = { appointment: row, actor: actor(row, role), action: "cancel", reason: "Reason", now };
        if (["Pending", "Confirmed", "Reschedule Proposed"].includes(status) && offset > 0) assert.equal(assertTransition(input), "Cancelled");
        else assert.throws(() => assertTransition(input), { statusCode: 409 });
      }
    }
    const row = fixture({ status: "Pending", bookingMethod: "schedule_request", startAt: undefined, endAt: undefined });
    assert.equal(assertTransition({ appointment: row, actor: actor(row, role), action: "cancel", reason: "Reason", now }), "Cancelled");
    for (const startAt of [null, new Date(NaN)]) assert.throws(() => assertTransition({ appointment: { ...row, bookingMethod: "published_slot", startAt }, actor: actor(row, role), action: "cancel", reason: "Reason", now }));
  }
});

test("actual attendance opening and either response flag block even stale statuses; future enrollment permits cancellation", async () => {
  for (const role of ["faculty", "dean", "student"]) for (const status of ["Pending", "Confirmed", "Reschedule Proposed"]) {
    const row = fixture({ status });
    for (const attendance of [{ attendanceOpensAt: new Date(+now - 1) }, { attendanceOpensAt: now }, { studentResponded: true }, { facultyResponded: true }]) {
      row.attendance = attendance;
      assert.throws(() => assertTransition({ appointment: row, actor: actor(row, role), action: "cancel", reason: "Reason", now }), /Attendance/);
      assert.equal(detailRecord(row, actor(row), now).actions.cancel, false);
    }
    row.attendance = { attendanceOpensAt: new Date(+now + 1), studentResponded: false, facultyResponded: false };
    assert.equal(assertTransition({ appointment: row, actor: actor(row, role), action: "cancel", reason: "Reason", now }), "Cancelled");
    assert.equal(detailRecord(row, actor(row), now, true).actions.cancel, false);
    const h = appointmentHarness();
    try {
      h.state.appointments.push(row); addSlot(h, row);
      h.state.responses.push({ _id: newId(), appointment: row._id, participant: newId() });
      const before = clone(h.state);
      await assert.rejects(transitionAppointment(command(row, { actor: actor(row, role) })), /Attendance/);
      assert.deepEqual(h.state, before);
    } finally { h.restore(); }
  }
});

test("HTTP Faculty/Dean identity cannot be replaced; reasons required while Student reasons remain optional", async () => {
  const h = await appointmentHttp();
  try {
    for (const role of ["faculty", "dean"]) {
      const row = fixture({ faculty: h.users[role].id, student: h.users.student.id }); h.state.appointments.push(row); addSlot(h, row);
      const path = `/appointments/${row._id}/status`;
      for (const other of ["student", "otherFaculty", role === "faculty" ? "dean" : "faculty"]) {
        assert.ok([403, 404].includes((await h.request(path, other, "PUT", { status: "Cancelled", faculty: row.faculty, actor: actor(row), reason: "Reason" })).status));
      }
      for (const reason of ["", "  ", "<b></b>", "x".repeat(501), {}, 7]) assert.equal((await h.request(path, role, "PUT", { status: "Cancelled", reason })).status, 400);
      const response = await h.request(path, role, "PUT", { status: "Cancelled", reason: "  <b>R</b>  ", expectedVersion: 0 });
      assert.equal(response.status, 200); assert.equal((await response.json()).appointment.cancellationReason, "R");
    }
    const row = fixture({ student: h.users.student.id, faculty: h.users.faculty.id }); h.state.appointments.push(row); addSlot(h, row);
    assert.equal((await h.request(`/appointments/${row._id}/cancel`, "student", "PUT", {})).status, 200);
  } finally { await h.close(); }
});

test("owned release, preserved history, retry/concurrent/stale deduplication and private audit", async () => {
  const h = appointmentHarness();
  try {
    const row = fixture({ status: "Confirmed" }); h.state.appointments.push(row); addSlot(h, row);
    h.state.slots[0].reservationToken = "another-appointment-token";
    const foreign = { appointment: newId(), minute: 1 };
    h.state.holds.push({ appointment: row._id, minute: 2 }, foreign);
    h.retry();
    const results = await Promise.allSettled([transitionAppointment(command(row)), transitionAppointment(command(row))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(h.state.slots[0].reservationToken, "another-appointment-token");
    assert.deepEqual(h.state.holds, [foreign]);
    const saved = h.state.appointments[0], event = saved.statusHistory[0];
    assert.equal(saved.statusHistory.length, 1); assert.equal(saved.status, "Cancelled");
    assert.equal(event.previousStatus, "Confirmed"); assert.equal(event.newStatus, "Cancelled");
    assert.equal(String(event.changedBy), String(row.faculty)); assert.equal(event.changedByRole, "Faculty");
    assert.equal(+event.changedAt, +now); assert.equal(event.reason, "Unavailable");
    assert.equal(sectionFor(saved, now), "Recently Finalized");
    assert.equal(detailRecord(saved, actor(row), now).statusHistory[0].reason, "Unavailable");
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 1);
    assert.doesNotMatch(JSON.stringify(h.state.audits), /Unavailable/);
    await assert.rejects(transitionAppointment(command(row)), { code: "APPOINTMENT_CONCURRENT_CHANGE" });
    assert.equal(h.state.notifications.length, 1);
    assert.throws(() => assertTransition({ appointment: { ...row, status: "Confirmed" }, actor: { ...actor(row, "dean"), management: true }, action: "cancel", reason: "Reason", now }), { statusCode: 403 });
  } finally { h.restore(); }
});

test("detail eligibility checks authoritative responses and ended Confirmed without GET writes", async () => {
  const h = appointmentHarness();
  try {
    const row = fixture({ status: "Confirmed", supportingDocuments: [] }); h.state.appointments.push(row);
    h.state.responses.push({ appointment: row._id, participant: row.student });
    const before = clone(h.state);
    const detail = await facultyConsultationDetails({ faculty: row.faculty, id: row._id, actor: actor(row), now });
    assert.equal(detail.appointment.actions.cancel, false); assert.deepEqual(h.state, before);
    const ended = { ...row, startAt: new Date(+now - 60000), endAt: now };
    assert.equal(sectionFor(ended, now), "Awaiting Attendance Update");
    assert.equal(detailRecord(ended, actor(row), now).actions.cancel, false);
    assert.equal(ended.status, "Confirmed");
  } finally { h.restore(); }
});

test("email failure occurs after committed cancellation and cannot duplicate effects", async () => {
  const h = appointmentHarness(), previous = { ...env };
  try {
    const row = fixture(); h.state.appointments.push(row); addSlot(h, row);
    h.state.users.push({ _id: row.student, email: "student@example.test" });
    Object.assign(env, { smtpHost: "mock", smtpUser: "mock", smtpPass: "mock", emailFrom: "mock@example.test" });
    let attempts = 0;
    setEmailTransportFactoryForTests(() => ({ sendMail: async () => {
      attempts++; assert.equal(h.state.appointments[0].status, "Cancelled"); assert.equal(h.state.notifications.length, 1);
      throw new Error("mock failure");
    } }));
    await transitionAppointment(command(row));
    assert.equal(attempts, 1); assert.equal(h.state.audits.length, 1);
    await assert.rejects(transitionAppointment(command(row))); assert.equal(attempts, 1);
  } finally { Object.assign(env, previous); resetEmailTransportFactoryForTests(); h.restore(); }
});
