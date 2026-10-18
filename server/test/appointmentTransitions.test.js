import assert from "node:assert/strict";
import { test } from "node:test";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../src/config/appointmentStatus.js";
import { assertTransition, transitionAppointment, createAppointmentRequest } from "../src/services/appointmentTransitionService.js";
import { safeReason } from "../src/services/appointmentHistoryService.js";
import { processExpiredAvailability } from "../src/services/availabilityExpirationService.js";
import { appointmentHarness, fixture, addSlot, clone, newId } from "./helpers/appointmentHarness.js";

const now = new Date("2026-10-16T00:00:00Z");
const actor = (record, role = "faculty") => ({ id: role === "student" ? record.student : record.faculty, role });
const proposal = (record) => Object.assign(record, {
  proposedStartAt: new Date("2099-01-02T06:00:00Z"), proposedEndAt: new Date("2099-01-02T06:30:00Z"),
  proposedConsultationMode: "Face-to-Face", proposedLocation: "Room 201", proposedAt: new Date("2026-10-15"),
  proposedBy: record.faculty, proposalNote: "Schedule adjustment",
});

test("every canonical source/destination and actor is bounded by the approved action matrix", () => {
  const cases = [
    ["confirm", "faculty", "Confirmed", ["Pending"]],
    ["reject", "faculty", "Rejected", ["Pending"]],
    ["propose", "faculty", "Reschedule Proposed", ["Pending", "Confirmed"]],
    ["accept_proposal", "student", "Confirmed", ["Reschedule Proposed"]],
    ["reject_proposal", "student", "Pending", ["Reschedule Proposed"]],
    ["cancel", "student", "Cancelled", ["Pending", "Confirmed", "Reschedule Proposed"]],
    ["cancel", "faculty", "Cancelled", ["Pending", "Confirmed", "Reschedule Proposed"]],
    ["expire", "system", "Expired", ["Pending"]],
  ];
  for (const from of APPOINTMENT_STATUSES) for (const [action, role, to, allowed] of cases) {
    const record = proposal(fixture({ status: from }));
    if (action === "expire") record.startAt = now;
    const input = { appointment: record, action, actor: role === "system" ? { role } : actor(record, role),
      reason: "Reason", expectedProposalAt: record.proposedAt, now };
    if (allowed.includes(from)) assert.equal(assertTransition(input), to, `${from}: ${action}`);
    else assert.throws(() => assertTransition(input), `${from}: ${action}`);
    for (const other of ["student", "faculty", "dean"]) {
      assert.throws(() => assertTransition({ ...input, actor: { id: newId(), role: other } }));
    }
  }
  for (const from of [...APPOINTMENT_STATUSES, ...LEGACY_APPOINTMENT_STATUSES]) for (const to of APPOINTMENT_STATUSES) {
    if (to === "Completed" || to === "Attendance Review" || to === "Awaiting Attendance Update")
      assert.throws(() => assertTransition({ appointment: fixture({ status: from }), action: to, actor: { role: "faculty" }, now }));
  }
  for (const role of ["faculty", "dean"]) {
    const record = fixture();
    assert.equal(assertTransition({ appointment: record, action: "confirm", actor: actor(record, role), now }), "Confirmed");
    assert.throws(() => assertTransition({ appointment: record, action: "confirm", actor: { ...actor(record, role), management: true }, now }));
  }
  for (const status of LEGACY_APPOINTMENT_STATUSES) for (const [action] of cases)
    assert.throws(() => assertTransition({ appointment: fixture({ status }), action, actor: { role: "system" }, now }));
});

test("confirmation is atomic, chronological, private and repeated/stale commands are rejected", async () => {
  const h = appointmentHarness();
  try {
    const record = fixture(); h.state.appointments.push(record); addSlot(h, record);
    const result = await transitionAppointment({ id: record._id, actor: actor(record, "dean"), action: "confirm", expectedVersion: 0, now });
    assert.equal(result.status, "Confirmed"); assert.equal(result.reservationToken, undefined);
    assert.equal(h.state.appointments[0].statusHistory.length, 1);
    assert.equal(h.state.appointments[0].statusHistory[0].changedByRole, "Dean");
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 1);
    await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record), action: "confirm", now }));
    await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record), action: "cancel", reason: "Reason", expectedVersion: 0, now }));
    assert.equal(h.state.audits.length, 1);
    await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record), action: "Completed", now }));
  } finally { h.restore(); }
});

test("proposal rejection preserves even an elapsed current schedule and reservation, archives proposal, and notifies Faculty", async () => {
  const h = appointmentHarness();
  try {
    const record = proposal(fixture({ status: "Reschedule Proposed", startAt: new Date("2020-01-01"), endAt: new Date("2020-01-01T00:30:00Z") }));
    h.state.appointments.push(record); addSlot(h, record);
    await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record, "student"), action: "reject_proposal", expectedProposalAt: new Date(0), now }));
    const result = await transitionAppointment({ id: record._id, actor: actor(record, "student"), action: "reject_proposal", expectedProposalAt: record.proposedAt, now });
    assert.equal(result.status, "Pending"); assert.equal(result.startAt.getTime(), record.startAt.getTime());
    assert.equal(result.proposedStartAt, undefined); assert.equal(result.scheduleHistory[0].response, "Rejected");
    assert.equal(result.statusHistory.length, 1); assert.equal(h.state.notifications[0].recipient, record.faculty);
    assert.equal(h.state.slots[0].reservationToken, "owned-reservation");
  } finally { h.restore(); }
});

test("acceptance exchanges reservations or creates custom holds and rejects duplicate responses", async () => {
  for (const published of [true, false]) {
    const h = appointmentHarness();
    try {
      const record = proposal(fixture({ status: "Reschedule Proposed" })); h.state.appointments.push(record); addSlot(h, record);
      if (published) {
        record.proposedAvailability = newId();
        h.state.slots.push({ _id: record.proposedAvailability, faculty: record.faculty, isActive: true,
          startAt: record.proposedStartAt, endAt: record.proposedEndAt, mode: record.proposedConsultationMode });
      }
      const command = { id: record._id, actor: actor(record, "student"), action: "accept_proposal", expectedProposalAt: record.proposedAt, now };
      const results = await Promise.allSettled([transitionAppointment(command), transitionAppointment(command)]);
      assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
      assert.equal(h.state.appointments[0].status, "Confirmed");
      assert.equal(h.state.appointments[0].scheduleHistory[0].response, "Accepted");
      assert.equal(h.state.slots[0].reservationToken, undefined);
      assert.equal(h.state.holds.length, 30);
      assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 2);
      assert.ok(h.state.notifications.some(notification => notification.recipient === record.student && notification.type === "reschedule_response_recorded"));
    } finally { h.restore(); }
  }
});

test("each required write failure rolls back appointment, reservation, history, audit and notification", async () => {
  for (const stage of ["slots", "appointments", "audits", "notifications", "holds"]) {
    const h = appointmentHarness();
    try {
      const record = fixture({ status: "Confirmed" }); h.state.appointments.push(record); addSlot(h, record);
      const before = clone(h.state); h.fail(stage);
      await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record), action: "cancel", reason: "Faculty unavailable", now }));
      assert.deepEqual(h.state, before, stage);
    } finally { h.restore(); }
  }
});

test("Faculty/Student cancellation and rejection release reservations; future proposal does not change pre-start rule", async () => {
  for (const role of ["student", "faculty", "dean"]) for (const status of ["Pending", "Confirmed", "Reschedule Proposed"]) {
    const h = appointmentHarness();
    try {
      const record = proposal(fixture({ status })); h.state.appointments.push(record); addSlot(h, record);
      if (status === "Reschedule Proposed") {
        record.proposedStartAt = new Date("2020-01-01"); record.proposedEndAt = new Date("2020-01-01T00:30:00Z");
      }
      if (role !== "student") await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record, role), action: "cancel", now }));
      const result = await transitionAppointment({ id: record._id, actor: actor(record, role), action: "cancel", reason: "Unavailable", now });
      assert.equal(result.status, "Cancelled"); assert.equal(h.state.slots[0].reservationToken, undefined);
      assert.equal(result.statusHistory.length, 1);
      assert.equal(h.state.notifications[0].recipient, role === "student" ? record.faculty : record.student);
    } finally { h.restore(); }
  }
  const h = appointmentHarness();
  try {
    const record = fixture(); h.state.appointments.push(record); addSlot(h, record);
    await transitionAppointment({ id: record._id, actor: actor(record), action: "reject", reason: "Unavailable", now });
    assert.equal(h.state.slots[0].reservationToken, undefined);
    const started = fixture({ startAt: now });
    assert.throws(() => assertTransition({ appointment: started, actor: actor(started), action: "cancel", reason: "Unavailable", now }), /already started/);
  } finally { h.restore(); }
});

test("scheduled Pending expiration uses start instant, excludes unscheduled/proposed/confirmed, and is rerun safe", async () => {
  const h = appointmentHarness();
  try {
    const due = fixture({ startAt: now, endAt: new Date(now.getTime() + 1800000) });
    const unscheduled = fixture({ bookingMethod: "schedule_request", startAt: undefined, endAt: undefined, availability: undefined });
    const proposed = proposal(fixture({ status: "Reschedule Proposed", startAt: now }));
    const confirmed = fixture({ status: "Confirmed", startAt: now });
    h.state.appointments.push(due, unscheduled, proposed, confirmed); addSlot(h, due);
    assert.deepEqual(await processExpiredAvailability({ now: new Date(now.getTime() - 1) }), { attempted: 0, changed: 0, skipped: 0, failed: 0, nextCursor: null });
    assert.deepEqual(await processExpiredAvailability({ now }), { attempted: 1, changed: 1, skipped: 0, failed: 0, nextCursor: due._id });
    assert.equal(h.state.appointments[0].expirationReason, "faculty_response_deadline_passed");
    assert.equal(h.state.appointments[0].statusHistory[0].actorType, "system");
    assert.equal(h.state.appointments[1].status, "Pending"); assert.equal(h.state.appointments[2].status, "Reschedule Proposed");
    assert.equal(h.state.appointments[3].status, "Confirmed"); assert.equal(h.state.slots[0].reservationToken, undefined);
    assert.deepEqual(await processExpiredAvailability({ now }), { attempted: 0, changed: 0, skipped: 0, failed: 0, nextCursor: null });
    assert.equal(h.state.audits.length, 1);
  } finally { h.restore(); }
});

test("Pending proposal preserves original schedule; request creation reserves and records one event atomically", async () => {
  const h = appointmentHarness();
  try {
    const record = fixture(); h.state.appointments.push(record); addSlot(h, record);
    const result = await transitionAppointment({ id: record._id, actor: actor(record), action: "propose", reason: "Adjustment",
      schedule: { startAt: new Date("2099-02-01"), endAt: new Date("2099-02-01T00:30:00Z"), mode: "Face-to-Face", location: "Room 1" }, now });
    assert.equal(result.status, "Reschedule Proposed"); assert.equal(result.startAt.getTime(), record.startAt.getTime());
    assert.equal(h.state.slots[0].reservationToken, "owned-reservation");
    const request = fixture({ _id: newId(), student: newId(), faculty: newId(), availability: newId() });
    addSlot(h, { ...request, reservationToken: undefined });
    const created = await createAppointmentRequest({ actor: actor(request, "student"), data: request, now });
    assert.equal(created.statusHistory.length, 1); assert.equal(created.statusHistory[0].previousStatus, "Created");
    assert.ok(h.state.slots[1].reservationToken);
    assert.equal(safeReason("<b>Reason</b> https://example.invalid/private token=secret\n"), "Reason [link removed] [redacted]");
  } finally { h.restore(); }
});

test("transaction callback retries reuse owned minute locks without duplicate events or mutated commands", async () => {
  const h = appointmentHarness();
  try {
    const request = fixture(); addSlot(h, { ...request, reservationToken: undefined });
    h.retry();
    const created = await createAppointmentRequest({ data: request, actor: actor(request, "student"), now });
    assert.equal(h.state.appointments.length, 1); assert.equal(h.state.holds.length, 30);
    h.retry();
    await transitionAppointment({ id: created._id, actor: actor(request), action: "confirm", now });
    assert.equal(h.state.holds.length, 30);
    assert.equal(h.state.audits.length, 2); assert.equal(h.state.notifications.length, 3);
    assert.ok(h.state.notifications.some(notification => notification.recipient === request.student && notification.type === "request_submitted"));
    assert.equal(h.state.appointments[0].statusHistory.length, 2);
    assert.ok(h.state.appointments[0].statusHistory[1].changedAt > h.state.appointments[0].statusHistory[0].changedAt);
  } finally { h.restore(); }
});

test("schedule conflicts and a replacement-slot confirmation cannot change an existing booking", async () => {
  const h = appointmentHarness();
  try {
    const record = fixture(); h.state.appointments.push(record); addSlot(h, record);
    await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record), action: "confirm", availabilityId: newId(), now }), /changed schedule/);
    const proposed = { startAt: new Date("2099-02-01"), endAt: new Date("2099-02-01T00:30:00Z"), mode: "Face-to-Face", location: "Office" };
    h.state.appointments.push(fixture({ faculty: record.faculty, startAt: proposed.startAt, endAt: proposed.endAt }));
    await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record), action: "propose", reason: "Adjustment", schedule: proposed, now }), /conflicts/);
    assert.equal(h.state.appointments[0].status, "Pending"); assert.equal(h.state.audits.length, 0);
    assert.equal(h.state.slots[0].reservationToken, record.reservationToken);
  } finally { h.restore(); }
});
