import assert from "node:assert/strict";
import { test } from "node:test";
import Availability from "../src/models/Availability.js";
import User from "../src/models/User.js";
import StudentAvailability from "../src/models/StudentAvailability.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, addSlot, newId } from "./helpers/appointmentHarness.js";
import { mutateAvailability, validateAvailability } from "../src/services/availabilityManagementService.js";
import { createAppointmentRequest, transitionAppointment } from "../src/services/appointmentTransitionService.js";
import { lockProviderSchedules } from "../src/services/providerSchedulingLock.js";

const input = (extra = {}) => ({ startAt: "2099-01-01T10:00:00+08:00", endAt: "2099-01-01T10:30:00+08:00",
  mode: "Online", meetingPlatform: "Teams", ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

for (const role of ["faculty", "dean"]) test(`${role} availability CRUD derives ownership, protects versions, and retains history`, async () => {
  const h = await appointmentHttp();
  try {
    const actor = h.users[role];
    let response = await h.request("/availability", role, "POST", input({ faculty: h.users.otherFaculty.id, owner: h.users.otherFaculty.id }));
    assert.equal(response.status, 201);
    const slot = (await response.json()).availability;
    assert.equal(slot.faculty, actor.id); assert.equal(slot.meetingLink, "");
    assert.equal(slot.startAt, "2099-01-01T02:00:00.000Z");
    assert.equal((await h.request(`/availability/${slot._id}`, "otherFaculty", "PUT", { isActive: false })).status, 404);
    assert.equal((await h.request(`/availability/${slot._id}`, "otherFaculty", "DELETE", {})).status, 404);
    assert.equal((await h.request(`/availability/${slot._id}`, role, "PUT", { isActive: false, expectedVersion: 0 })).status, 200);
    assert.equal((await h.request(`/availability/${slot._id}`, role, "PUT", { isActive: true, expectedVersion: 0 })).status, 409);
    assert.equal((await h.request(`/availability/${slot._id}`, role, "PUT", { isActive: true, expectedVersion: 1 })).status, 200);
    h.state.appointments.push(fixture({ faculty: actor.id, availability: slot._id, status: "Cancelled" }));
    response = await h.request(`/availability/${slot._id}`, role, "DELETE", { expectedVersion: 2 });
    assert.equal(response.status, 409); assert.match((await response.json()).message, /history/);
    assert.equal((await h.request(`/availability/${slot._id}`, role, "PUT", { isActive: false, expectedVersion: 2 })).status, 200);
    const unused = await mutateAvailability({ actor, action: "create", input: input({ isActive: false }) });
    await mutateAvailability({ actor, id: unused._id, action: "delete", input: { expectedVersion: 0 } });
    assert.equal(h.state.slots.length, 1); assert.equal(h.state.appointments.length, 1);
    assert.ok(h.lockCalls.length >= 8);
    assert.ok(h.state.users.find(user => user.id === actor.id).schedulingRevision > 0);
  } finally { await h.close(); }
});

test("validation accepts optional links, canonical modes and explicit UTC/Manila instants; rejects unsafe input", () => {
  const now = new Date("2099-01-01T01:59:59Z");
  assert.equal(validateAvailability(input(), now).meetingLink, "");
  assert.equal(validateAvailability(input({ meetingLink: "  " }), now).meetingLink, "");
  assert.equal(validateAvailability(input({ mode: "Face-to-Face", location: " Office " }), now).location, "Office");
  assert.equal(+validateAvailability(input(), now).startAt, +new Date("2099-01-01T02:00:00Z"));
  for (const extra of [{ startAt: "2099-01-01T01:59:59Z" }, { endAt: input().startAt },
    { endAt: "2099-01-01T01:59:00Z" }, { startAt: "2099-02-31T10:00:00+08:00" },
    { startAt: "2099-01-01T10:00" }, { mode: "online" }, { mode: "Face-to-Face", location: " " },
    { meetingPlatform: " " }, { meetingPlatform: 7 }, { meetingLink: {} }, { meetingLink: "javascript:alert(1)" },
    { meetingLink: "bad" }, { meetingLink: "https://" }, { meetingLink: "https://example.test/" + "x".repeat(500) },
    { isActive: "false" }]) assert.throws(() => validateAvailability(input(extra), now), error => error.statusCode === 400);
});

test("active overlaps reject, adjacency works, overlapping inactive drafts remain editable and activation rechecks appointments", async () => {
  const h = await appointmentHttp(), actor = h.users.faculty;
  const create = extra => mutateAvailability({ actor, action: "create", input: input(extra) });
  try {
    await create();
    await assert.rejects(create({ startAt: "2099-01-01T02:10:00Z" }), /overlaps/);
    await create({ startAt: "2099-01-01T02:30:00Z", endAt: "2099-01-01T03:00:00Z" });
    const draft = await create({ isActive: false });
    await mutateAvailability({ actor, id: draft._id, action: "update", input: { meetingPlatform: "Zoom", expectedVersion: 0 } });
    await assert.rejects(mutateAvailability({ actor, id: draft._id, action: "update", input: { isActive: true } }), /overlaps/);
    for (const status of ["Pending", "Confirmed", "Reschedule Proposed"]) {
      h.state.appointments = [fixture({ faculty: actor.id, availability: undefined, status,
        startAt: new Date("2099-02-01T02:00:00Z"), endAt: new Date("2099-02-01T02:30:00Z") })];
      const times = { startAt: "2099-02-01T02:00:00Z", endAt: "2099-02-01T02:30:00Z" };
      await assert.rejects(create(times), /active consultation/);
      const inactive = await create({ ...times, isActive: false });
      await assert.rejects(mutateAvailability({ actor, id: inactive._id, action: "update", input: { isActive: true } }), /active consultation/);
    }
    const started = await create({ startAt: "2099-03-01T02:00:00Z", endAt: "2099-03-01T02:30:00Z" });
    for (const action of ["update", "delete"]) await assert.rejects(mutateAvailability({ actor, id: started._id, action,
      input: { isActive: false }, now: new Date("2099-03-01T02:00:00Z") }), /future/);
  } finally { await h.close(); }
});

test("tokens and linked blocking appointments independently protect every mutation and stay out of owner responses", async () => {
  const h = await appointmentHttp(), actor = h.users.dean;
  try {
    const slot = await mutateAvailability({ actor, action: "create", input: input() });
    for (const protection of ["token", "Pending", "Reschedule Proposed", "Confirmed"]) {
      h.state.slots[0].reservationToken = protection === "token" ? "private-token" : undefined;
      h.state.appointments = protection === "token" ? [] : [fixture({ faculty: actor.id, availability: slot._id, status: protection })];
      for (const changes of [{ isActive: false }, { meetingPlatform: "Zoom" }, { meetingLink: "https://example.test" },
        { mode: "Face-to-Face", location: "Office" }, { startAt: "2099-01-01T02:05:00Z" }]) {
        await assert.rejects(mutateAvailability({ actor, id: slot._id, action: "update", input: changes }), /reschedule or cancellation/);
      }
      await assert.rejects(mutateAvailability({ actor, id: slot._id, action: "delete" }), /reschedule or cancellation/);
      const response = await h.request("/availability/mine", "dean");
      const body = await response.json(); assert.equal(response.status, 200);
      assert.equal(body.availability[0].protected, true); assert.doesNotMatch(JSON.stringify(body), /private-token|reservationToken|schedulingRevision/);
    }
    assert.equal(h.state.appointments.length, 1);
  } finally { await h.close(); }
});

test("two Students cannot share a slot, even when a legacy linked reservation lacks a token", async () => {
  const h = await appointmentHttp();
  try {
    const record = fixture({ faculty: h.users.faculty.id, student: h.users.student.id, reservationToken: undefined }); addSlot(h, record);
    const requests = [record, { ...record, _id: newId(), student: h.users.otherStudent.id }];
    const result = await Promise.allSettled(requests.map(data => createAppointmentRequest({ data, actor: { id: data.student, role: "student" } })));
    assert.equal(result.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(h.state.appointments.length, 1); assert.equal(h.state.holds.length, 30);
    delete h.state.slots[0].reservationToken;
    h.state.appointments[0].startAt = new Date("2099-02-01T02:00:00Z");
    h.state.appointments[0].endAt = new Date("2099-02-01T02:30:00Z"); h.state.holds = [];
    await assert.rejects(createAppointmentRequest({ data: { ...record, _id: newId(), student: h.users.otherStudent.id }, actor: h.users.otherStudent }), /slot already/);
  } finally { await h.close(); }
});

test("forced booking-first interleaving blocks edit, deactivation and deletion; edit-first booking rereads slot data", async () => {
  for (const action of ["edit", "deactivate", "delete"]) {
    const h = await appointmentHttp(), actor = h.users.faculty;
    const original = User.updateOne, entered = deferred(), release = deferred();
    try {
      const record = fixture({ faculty: actor.id, student: h.users.student.id, reservationToken: undefined }); addSlot(h, record);
      let first = true;
      User.updateOne = async (...args) => {
        if (first) { first = false; entered.resolve(); await release.promise; }
        return original(...args);
      };
      const booking = createAppointmentRequest({ data: record, actor: h.users.student });
      await entered.promise;
      const edit = mutateAvailability({ actor, id: record.availability, action: action === "delete" ? "delete" : "update",
        input: action === "edit" ? { meetingPlatform: "Zoom" } : { isActive: false } });
      release.resolve(); await booking; await assert.rejects(edit, /reserved consultation/);
      assert.equal(h.state.appointments.length, 1); assert.equal(h.lockCalls.length, 2);
    } finally { release.resolve(); User.updateOne = original; await h.close(); }
  }
  const h = await appointmentHttp(), actor = h.users.faculty;
  try {
    const record = fixture({ faculty: actor.id, student: h.users.student.id, reservationToken: undefined }); addSlot(h, record);
    await mutateAvailability({ actor, id: record.availability, action: "update", input: { mode: "Face-to-Face", location: "Office" } });
    const booked = await createAppointmentRequest({ data: record, actor: h.users.student });
    assert.equal(booked.consultationMode, "Face-to-Face"); assert.equal(booked.location, "Office");
    assert.equal(booked.meetingPlatform, ""); assert.equal(booked.reservationToken, undefined);
    await transitionAppointment({ id: booked._id, actor: h.users.student, action: "cancel" });
    await mutateAvailability({ actor, id: record.availability, action: "update", input: { isActive: false } });
    await assert.rejects(createAppointmentRequest({ data: { ...record, _id: newId() }, actor: h.users.student }), /no longer available/);
    await mutateAvailability({ actor, id: record.availability, action: "update", input: { isActive: true,
      startAt: "2099-01-02T02:00:00Z", endAt: "2099-01-02T02:30:00Z" } });
    await assert.rejects(createAppointmentRequest({ data: { ...record, _id: newId() }, actor: h.users.student }), /schedule changed/);
  } finally { await h.close(); }
});

test("all appointment transition paths share the provider lock; retries preserve single committed reservations", async () => {
  const h = await appointmentHttp(), faculty = h.users.faculty, student = h.users.student;
  try {
    const record = fixture({ faculty: faculty.id, student: student.id, reservationToken: undefined }); addSlot(h, record);
    h.retry(); const booked = await createAppointmentRequest({ data: record, actor: student });
    let expected = h.lockCalls.length;
    const command = async args => { await transitionAppointment({ id: booked._id, ...args }); assert.equal(h.lockCalls.length, ++expected); };
    const schedule = { startAt: new Date("2099-02-01T02:00:00Z"), endAt: new Date("2099-02-01T02:30:00Z"), mode: "Online", meetingPlatform: "Teams" };
    await command({ actor: faculty, action: "propose", reason: "Change schedule", schedule });
    await command({ actor: student, action: "reject_proposal", expectedProposalAt: h.state.appointments[0].proposedAt });
    await command({ actor: faculty, action: "confirm" });
    await command({ actor: faculty, action: "propose", reason: "Change schedule", schedule });
    await command({ actor: student, action: "accept_proposal", expectedProposalAt: h.state.appointments[0].proposedAt });
    await command({ actor: student, action: "cancel" });
    for (const action of ["reject", "expire"]) {
      const pending = fixture({ faculty: faculty.id, student: student.id }); h.state.appointments.push(pending); addSlot(h, pending);
      await transitionAppointment({ id: pending._id, actor: action === "expire" ? { role: "system" } : faculty, action, reason: "Unavailable",
        ...(action === "expire" && { now: pending.startAt }) });
      assert.equal(h.lockCalls.length, ++expected);
    }
    const request = fixture({ faculty: faculty.id, student: student.id, availability: undefined, startAt: undefined, endAt: undefined,
      reservationToken: undefined, bookingMethod: "schedule_request" });
    const created = await createAppointmentRequest({ data: request, actor: student }); assert.equal(h.lockCalls.length, ++expected);
    await transitionAppointment({ id: created._id, actor: faculty, action: "confirm", schedule }); assert.equal(h.lockCalls.length, ++expected);
    assert.equal(h.state.holds.length, 30);
  } finally { await h.close(); }
});

test("forced mutation-first interleavings reject stale booking and concurrent active creates cannot both commit", async () => {
  for (const action of ["edit", "deactivate", "delete", "create"]) {
    const h = await appointmentHttp(), actor = h.users.faculty;
    const original = User.updateOne, entered = deferred(), release = deferred();
    try {
      const record = fixture({ faculty: actor.id, student: h.users.student.id, reservationToken: undefined });
      if (action !== "create") addSlot(h, record);
      let first = true;
      User.updateOne = async (...args) => {
        if (first) { first = false; entered.resolve(); await release.promise; }
        return original(...args);
      };
      const mutation = mutateAvailability({ actor, id: action === "create" ? undefined : record.availability,
        action: action === "create" || action === "delete" ? action : "update",
        input: action === "create" ? input() : action === "edit" ? { startAt: "2099-01-02T02:00:00Z", endAt: "2099-01-02T02:30:00Z" } : { isActive: false } });
      await entered.promise;
      const competing = action === "create" ? mutateAvailability({ actor, action: "create", input: input() })
        : createAppointmentRequest({ data: record, actor: h.users.student });
      release.resolve(); await mutation;
      await assert.rejects(competing, action === "create" ? /overlaps/ : /schedule changed|no longer available/);
      assert.equal(h.state.appointments.length, 0); assert.equal(h.lockCalls.length, 2);
    } finally { release.resolve(); User.updateOne = original; await h.close(); }
  }
});

test("availability failures roll back the provider revision; retries commit one version and one slot", async () => {
  const h = await appointmentHttp(), actor = h.users.faculty;
  try {
    h.fail("slots");
    await assert.rejects(mutateAvailability({ actor, action: "create", input: input() }), /Injected slots/);
    assert.equal(h.state.slots.length, 0); assert.equal(h.state.users.find(row => row.id === actor.id).schedulingRevision, undefined);
    h.fail(undefined); h.retry();
    const slot = await mutateAvailability({ actor, action: "create", input: input() });
    assert.equal(h.state.slots.length, 1); assert.equal(h.state.users.find(row => row.id === actor.id).schedulingRevision, 1);
    h.retry();
    const updated = await mutateAvailability({ actor, id: slot._id, action: "update", input: { isActive: false, expectedVersion: 0 } });
    assert.equal(updated.__v, 1); assert.equal(h.state.users.find(row => row.id === actor.id).schedulingRevision, 2);
    h.fail("slots");
    await assert.rejects(mutateAvailability({ actor, id: slot._id, action: "delete", input: { expectedVersion: 1 } }), /Injected slots/);
    assert.equal(h.state.slots.length, 1); assert.equal(h.state.users.find(row => row.id === actor.id).schedulingRevision, 2);
  } finally { await h.close(); }
});

test("accepting a proposal rereads its published slot and rejects changed details without releasing the original reservation", async () => {
  const h = await appointmentHttp(), actor = h.users.faculty;
  try {
    const record = fixture({ faculty: actor.id, student: h.users.student.id, reservationToken: undefined }); addSlot(h, record);
    const booked = await createAppointmentRequest({ data: record, actor: h.users.student });
    const token = h.state.slots[0].reservationToken;
    const target = await mutateAvailability({ actor, action: "create", input: input({ startAt: "2099-02-01T02:00:00Z", endAt: "2099-02-01T02:30:00Z" }) });
    await transitionAppointment({ id: booked._id, actor, action: "propose", availabilityId: target._id, reason: "Move consultation" });
    await mutateAvailability({ actor, id: target._id, action: "update", input: { meetingPlatform: "Zoom", expectedVersion: 0 } });
    await assert.rejects(transitionAppointment({ id: booked._id, actor: h.users.student, action: "accept_proposal",
      expectedProposalAt: h.state.appointments[0].proposedAt }), /proposed slot changed/);
    assert.equal(h.state.slots[0].reservationToken, token); assert.equal(h.state.appointments[0].status, "Reschedule Proposed");
    assert.equal(h.state.holds.length, 30);
  } finally { await h.close(); }
});

test("provider lock requires a transaction, initializes missing revisions and orders multiple providers deterministically", async () => {
  const original = User.updateOne, calls = [], session = {};
  try {
    User.updateOne = async (filter, update, options) => { calls.push([filter, update, options]); return { matchedCount: 1 }; };
    await assert.rejects(lockProviderSchedules(["a"]), /transaction/);
    await lockProviderSchedules(["b", "a", "b"], session);
    assert.deepEqual(calls.map(call => call[0]._id), ["a", "b"]);
    assert.deepEqual(calls[0][1], { $inc: { schedulingRevision: 1 } }); assert.equal(calls[0][2].session, session);
    assert.equal(User.schema.path("schedulingRevision").options.select, false);
    assert.equal(Availability.schema.path("reservationToken").options.select, false);
    User.updateOne = async () => ({ matchedCount: 0 });
    await assert.rejects(lockProviderSchedules(["missing"], session), error => error.statusCode === 404);
  } finally { User.updateOne = original; }
});

for (const role of ["faculty", "dean"]) test(`${role} combined calendar includes slot states and appointments without occupied-slot duplication`, async () => {
  const h = await appointmentHttp(), actor = h.users[role];
  try {
    const create = extra => mutateAvailability({ actor, action: "create", input: input(extra) });
    const pendingSlot = await create({ meetingLink: "https://private.test/slot" });
    await create({ startAt: "2099-01-01T03:00:00Z", endAt: "2099-01-01T03:30:00Z" });
    await create({ isActive: false });
    const confirmedSlot = await create({ startAt: "2099-01-01T04:00:00Z", endAt: "2099-01-01T04:30:00Z" });
    h.state.appointments.push(fixture({ faculty: actor.id, availability: pendingSlot._id, student: h.users.student.id }));
    h.state.appointments.push(fixture({ faculty: actor.id, availability: confirmedSlot._id, status: "Confirmed", student: h.users.otherStudent.id,
      startAt: confirmedSlot.startAt, endAt: confirmedSlot.endAt }));
    const response = await h.request(`/faculty/calendar?start=2099-01-01&end=2099-01-01&includeAvailability=true`, role);
    const body = await response.json(); assert.equal(response.status, 200);
    assert.equal(body.events.length, 4);
    assert.deepEqual(body.events.map(event => event.status).sort(), ["Available", "Confirmed", "Inactive", "Pending"]);
    assert.equal(body.events.find(event => event.status === "Pending").displayStatus, "Pending request");
    assert.equal(body.events.find(event => event.status === "Confirmed").displayStatus, "Confirmed consultation");
    assert.doesNotMatch(JSON.stringify(body), /private.test|reservationToken|schedulingRevision/);
    const defaultCalendar = await h.request("/faculty/calendar?start=2099-01-01&end=2099-01-01", role);
    assert.deepEqual((await defaultCalendar.json()).events.map(event => event.status).sort(), ["Available", "Confirmed", "Inactive", "Pending"]);
  } finally { await h.close(); }
});

test("Student discovery preserves matching contract and excludes private links and tokenless Pending conflicts", async () => {
  const h = await appointmentHttp(), actor = h.users.faculty, original = StudentAvailability.find;
  try {
    StudentAvailability.find = () => ({ select() { return this; }, lean: async () => [] });
    const slot = await mutateAvailability({ actor, action: "create", input: input({ meetingLink: "https://private.test/meeting" }) });
    let response = await h.request(`/availability/faculty/${actor.id}`);
    let body = await response.json(); assert.equal(response.status, 200);
    assert.equal(body.hasActiveStudentAvailability, false); assert.equal(body.schedules[0].bookable, true);
    assert.equal(body.schedules[0].availabilityId, slot._id); assert.equal(body.schedules[0].matchingType, "Based on Faculty availability only");
    assert.doesNotMatch(JSON.stringify(body), /meetingLink|private.test|reservationToken|schedulingRevision/);
    for (const status of ["Pending", "Reschedule Proposed", "Confirmed"]) {
      h.state.appointments = [fixture({ faculty: actor.id, student: h.users.otherStudent.id, availability: slot._id, status })];
      response = await h.request(`/availability/faculty/${actor.id}`); body = await response.json();
      assert.equal(body.schedules.length, 0);
    }
  } finally { StudentAvailability.find = original; await h.close(); }
});
