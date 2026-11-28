import assert from "node:assert/strict";
import { test } from "node:test";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../src/config/appointmentStatus.js";
import { assertTransition, transitionAppointment, createAppointmentRequest } from "../src/services/appointmentTransitionService.js";
import { safeReason } from "../src/services/appointmentHistoryService.js";
import { processExpiredAvailability } from "../src/services/availabilityExpirationService.js";
import { appointmentHarness, fixture, addSlot, clone, newId, deferred } from "./helpers/appointmentHarness.js";
import OneTimeScheduleHold from "../src/models/OneTimeScheduleHold.js";

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
          startAt: record.proposedStartAt, endAt: record.proposedEndAt, mode: record.proposedConsultationMode, location: record.proposedLocation,
          meetingPlatform: record.proposedMeetingPlatform, meetingLink: record.proposedMeetingLink });
      }
      const command = { id: record._id, actor: actor(record, "student"), action: "accept_proposal", expectedProposalAt: record.proposedAt, now };
      const results = await Promise.allSettled([transitionAppointment(command), transitionAppointment(command)]);
      assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
      assert.equal(h.state.appointments[0].status, "Confirmed");
      assert.equal(h.state.appointments[0].scheduleHistory[0].response, "Accepted");
      assert.equal(h.state.slots[0].reservationToken, undefined);
      assert.equal(h.state.holds.length, 30);
      assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 1);
      assert.ok(h.state.notifications.some(notification => notification.recipient === record.faculty && notification.type === "faculty_proposal_accepted"));
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

test("overlapping published bookings serialize for one Faculty or one Student across Faculty, with adjacent bookings allowed", async () => {
  for (const shared of ["faculty", "student"]) {
    const h = appointmentHarness();
    try {
      const first = fixture({ reservationToken: undefined });
      const second = fixture({ [shared]: first[shared], reservationToken: undefined });
      addSlot(h, first); addSlot(h, second);
      const book = data => createAppointmentRequest({ data, actor: actor(data, "student"), now });
      const raced = await Promise.allSettled([book(first), book(second)]);
      assert.equal(raced[0].status, "fulfilled");
      assert.equal(raced[1].reason?.statusCode, 409);
      assert.deepEqual(h.lockCalls.slice(0, 2), [first.student, first.faculty].sort());
      assert.deepEqual(h.lockCalls.slice(2, 4), [second.student, second.faculty].sort());
      assert.equal(h.state.holds.length, 30);
      assert.equal(h.state.audits.length, 1);
      assert.equal(h.state.slots[1].reservationToken, undefined);

      const next = fixture({ [shared]: first[shared], startAt: first.endAt,
        endAt: new Date(+first.endAt + 30 * 60000), reservationToken: undefined });
      addSlot(h, next);
      assert.equal((await book(next)).status, "Pending");
      assert.equal(h.state.holds.length, 60);
    } finally { h.restore(); }
  }
});

test("a request cannot reserve a schedule after its provider has been deactivated", async () => {
  const h = appointmentHarness();
  try {
    const booked = fixture({ reservationToken: undefined });
    addSlot(h, booked);
    h.state.users.push({ _id: booked.faculty, role: "faculty", accountStatus: "Inactive" });
    const before = clone(h.state);
    await assert.rejects(createAppointmentRequest({ data: booked, actor: actor(booked, "student"), now }), /not currently available/);
    assert.deepEqual(h.state, before);
  } finally { h.restore(); }
});

test("published bookings conflict with custom confirmation and timed alternatives without partial writes", async () => {
  const h = appointmentHarness();
  try {
    const booked = fixture({ reservationToken: undefined });
    addSlot(h, booked);
    const alternative = fixture({ student: booked.student, availability: undefined, bookingMethod: "schedule_request",
      reservationToken: undefined, currentScheduleSource: "participant_proposed" });
    const unscheduled = fixture({ student: booked.student, availability: undefined, bookingMethod: "schedule_request",
      startAt: undefined, endAt: undefined, reservationToken: undefined });
    h.state.users.push({ _id: alternative.faculty, role: "faculty", accountStatus: "Active" });
    h.state.appointments.push(unscheduled);
    const pending = await createAppointmentRequest({ data: booked, actor: actor(booked, "student"), now });
    const schedule = { startAt: booked.startAt, endAt: booked.endAt, mode: "Online", meetingPlatform: "Teams" };
    const before = clone(h.state);
    await assert.rejects(createAppointmentRequest({ data: alternative, actor: actor(alternative, "student"), now }),
      error => error.statusCode === 409 && error.code === "SCHEDULE_CONFLICT");
    await assert.rejects(transitionAppointment({ id: unscheduled._id, actor: actor(unscheduled), action: "confirm", schedule, now }),
      error => error.statusCode === 409);
    assert.deepEqual(h.state, before);

    await transitionAppointment({ id: pending._id, actor: actor(booked, "student"), action: "cancel", now });
    await transitionAppointment({ id: unscheduled._id, actor: actor(unscheduled), action: "confirm", schedule, now });
    await assert.rejects(createAppointmentRequest({ data: { ...booked, _id: newId() }, actor: actor(booked, "student"), now }),
      error => error.statusCode === 409);
    assert.equal(h.state.slots[0].reservationToken, undefined);
    assert.ok(h.state.holds.every(hold => hold.appointment === unscheduled._id));
  } finally { h.restore(); }
});

test("cancellation and rebooking transfer the slot without deleting the new owner's holds", async () => {
  const h = appointmentHarness();
  const remove = OneTimeScheduleHold.deleteMany;
  const entered = deferred(), resume = deferred();
  try {
    const first = fixture({ reservationToken: undefined });
    const next = { ...first, _id: newId(), student: newId() };
    h.state.users.push({ _id: next.student });
    addSlot(h, first);
    const book = data => createAppointmentRequest({ data, actor: actor(data, "student"), now });
    await book(first);
    const originalToken = h.state.slots[0].reservationToken;
    OneTimeScheduleHold.deleteMany = async (...args) => {
      if (args[0].appointment === first._id) {
        entered.resolve();
        await resume.promise;
      }
      return remove(...args);
    };
    const cancelling = transitionAppointment({ id: first._id, actor: actor(first, "student"), action: "cancel", now });
    await entered.promise;
    const rebooking = book(next);
    resume.resolve();
    await cancelling; await rebooking;
    assert.deepEqual(h.state.appointments.map(row => row.status), ["Cancelled", "Pending"]);
    assert.notEqual(h.state.slots[0].reservationToken, originalToken);
    assert.equal(h.state.slots[0].reservationToken, h.state.appointments[1].reservationToken);
    assert.equal(h.state.holds.length, 30);
    assert.ok(h.state.holds.every(row => row.appointment === next._id));
  } finally { resume.resolve(); OneTimeScheduleHold.deleteMany = remove; h.restore(); }
});

test("duplicate-key and audit failures do not leave a booked slot, holds, or events", async () => {
  const h = appointmentHarness();
  const bulkWrite = OneTimeScheduleHold.bulkWrite;
  try {
    const record = fixture({ reservationToken: undefined });
    addSlot(h, record);
    const before = clone(h.state);
    const book = () => createAppointmentRequest({ data: record, actor: actor(record, "student"), now });
    OneTimeScheduleHold.bulkWrite = async (...args) => {
      await bulkWrite(...args);
      throw Object.assign(new Error("private duplicate key"), { code: 11000 });
    };
    await assert.rejects(book(), error => error.statusCode === 409 && !error.message.includes("private"));
    assert.deepEqual(h.state, before);
    OneTimeScheduleHold.bulkWrite = bulkWrite;
    h.fail("audits");
    await assert.rejects(book(), /Injected audits failure/);
    assert.deepEqual(h.state, before);
  } finally { OneTimeScheduleHold.bulkWrite = bulkWrite; h.restore(); }
});

test("accepting a same-slot expansion keeps the original token and reuses owned minutes", async () => {
  const h = appointmentHarness();
  try {
    const window = fixture({ reservationToken: undefined });
    addSlot(h, window);
    const booking = { ...window, endAt: new Date(+window.startAt + 15 * 60000) };
    await createAppointmentRequest({ data: booking, actor: actor(booking, "student"), now });
    const originalToken = h.state.slots[0].reservationToken;
    const proposed = await transitionAppointment({ id: booking._id, actor: actor(booking), action: "propose",
      reason: "Longer consultation requested", availabilityId: window.availability, now });
    assert.equal(+h.state.appointments[0].endAt, +booking.endAt);
    assert.equal(h.state.holds.length, 15);
    const accepted = await transitionAppointment({ id: booking._id, actor: actor(booking, "student"),
      action: "accept_proposal", expectedVersion: proposed.__v, expectedProposalAt: proposed.proposedAt, now });
    assert.equal(+accepted.endAt, +window.endAt);
    assert.equal(+accepted.scheduleHistory[0].previous.endAt, +booking.endAt);
    assert.equal(+accepted.scheduleHistory[0].next.endAt, +window.endAt);
    assert.equal(h.state.slots[0].reservationToken, originalToken);
    assert.equal(h.state.holds.length, 30);
    assert.equal(new Set(h.state.holds.map(row => row.minute)).size, 30);
  } finally { h.restore(); }
});

test("acceptance rechecks availability, start boundaries and attendance while preserving the old reservation", async () => {
  for (const changed of ["competing booking", "past proposal", "started original", "attendance response"]) {
    const h = appointmentHarness();
    try {
      const record = proposal(fixture({ status: "Reschedule Proposed", statusHistory: [{ newStatus: "Confirmed", changedAt: now }] }));
      h.state.appointments.push(record); addSlot(h, record);
      const blocker = fixture({ faculty: record.faculty, status: "Confirmed", startAt: record.proposedStartAt, endAt: record.proposedEndAt });
      if (changed === "competing booking") h.state.appointments.push(blocker);
      if (changed === "past proposal") { record.startAt = new Date("2099-02-01"); record.endAt = new Date("2099-02-02"); }
      if (changed === "attendance response") h.state.responses.push({ appointment: record._id });
      const responseAt = changed === "past proposal" ? record.proposedStartAt : changed === "started original" ? record.startAt : now;
      const before = clone(h.state);
      await assert.rejects(transitionAppointment({ id: record._id, actor: actor(record, "student"), action: "accept_proposal",
        expectedProposalAt: record.proposedAt, expectedVersion: 0, now: responseAt }),
      { message: { "competing booking": /conflicts/, "past proposal": /proposed time/, "started original": /already|started/, "attendance response": /Attendance/ }[changed] });
      assert.deepEqual(h.state, before);
    } finally { h.restore(); }
  }
});

test("Faculty receives one response event for a later proposal on a Faculty-initiated consultation", async () => {
  for (const action of ["accept_proposal", "reject_proposal"]) {
    const h = appointmentHarness();
    try {
      const record = fixture({ status: "Confirmed", initiatedByRole: "faculty", bookingMethod: "schedule_request",
        availability: undefined, reservationToken: undefined, currentScheduleSource: "faculty_assigned" });
      h.state.appointments.push(record);
      const target = proposal({});
      const proposed = await transitionAppointment({ id: record._id, actor: actor(record), action: "propose", now,
        reason: "Change requested by Faculty", schedule: { startAt: target.proposedStartAt, endAt: target.proposedEndAt,
          mode: target.proposedConsultationMode, location: target.proposedLocation } });
      const command = { id: record._id, actor: actor(record, "student"), action, now,
        expectedVersion: proposed.__v, expectedProposalAt: proposed.proposedAt };
      await transitionAppointment(command);
      await assert.rejects(transitionAppointment(command), error => error.statusCode === 409);
      const notice = action === "accept_proposal" ? "faculty_proposal_accepted" : "faculty_proposal_declined";
      assert.deepEqual(h.state.notifications.filter(row => row.recipient === record.faculty).map(row => row.type), [notice]);
      assert.equal(h.state.audits.length, 2);
    } finally { h.restore(); }
  }
});

test("a rejected Student proposal tells the Student that Faculty declined their schedule", async () => {
  const h = appointmentHarness();
  try {
    const record = proposal(fixture({ initiatedByRole: "faculty", status: "Reschedule Proposed" }));
    record.proposedBy = record.student;
    h.state.appointments.push(record);
    const command = { id: record._id, actor: actor(record), action: "reject_proposal", now,
      expectedVersion: record.__v, expectedProposalAt: record.proposedAt };
    await transitionAppointment(command);
    await assert.rejects(transitionAppointment(command), error => error.statusCode === 409);
    const [notice] = h.state.notifications;
    assert.equal(h.state.notifications.length, 1);
    assert.equal(notice.recipient, record.student);
    assert.match(notice.title, /declined/i);
    assert.match(notice.message, /Faculty member declined your proposed consultation schedule/);
    assert.equal(notice.actionUrl, `/student/consultations?appointment=${record._id}`);
  } finally { h.restore(); }
});
