import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import Availability from "../src/models/Availability.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, newId, clone } from "./helpers/appointmentHarness.js";
import { parseCalendarQuery, calendarEvent, facultyCalendar } from "../src/services/facultyCalendarService.js";
const range = "start=2099-01-01&end=2099-01-31";
const slot = (faculty, extra = {}) => ({ _id: newId(), faculty, startAt: new Date("2099-01-01T02:00:00Z"), endAt: new Date("2099-01-01T02:30:00Z"), isActive: true, mode: "Online", meetingPlatform: "Teams", meetingLink: "PRIVATE", ...extra });

test("strict inclusive Manila dates, options and owner rejection", () => {
  const parsed = parseCalendarQuery({ start: "2026-01-01", end: "2026-03-03" });
  assert.equal(parsed.start.toISOString(), "2025-12-31T16:00:00.000Z");
  assert.equal(parsed.endExclusive.toISOString(), "2026-03-03T16:00:00.000Z");
  for (const input of [{ start: "2026-02-30" }, { end: "2026-03-04" }, { start: "bad" }, { start: ["2026-01-01"] }, { start: "2027-01-01" }, { includeFinalized: "1" }, { includeInactive: true }, { includeAvailability: {} }, { facultyId: newId() }, { owner: newId() }])
    assert.throws(() => parseCalendarQuery({ start: "2026-01-01", end: "2026-03-03", ...input }));
  assert.equal(parseCalendarQuery({ start: "2024-02-29", end: "2024-02-29", includeInactive: "false" }).includeInactive, false);
});

test("safe namespaced projections exclude links, attendance, documents and private participant fields", () => {
  const event = calendarEvent(fixture({ student: { name: "Student", email: "PRIVATE" }, attendance: { responses: "PRIVATE" }, supportingDocuments: ["PRIVATE"], meetingLink: "PRIVATE", reason: "PRIVATE", responseNote: "PRIVATE", notes: "PRIVATE", proposedMeetingLink: "PRIVATE" }));
  assert.match(event.id, /^appointment-.*-current$/); assert.equal(event.kind, "appointment");
  assert.doesNotMatch(JSON.stringify(event), /PRIVATE|meetingLink|attendance|supportingDocuments|reason|notes|email/);
});

for (const role of ["faculty", "dean"]) test(role + " personal feed rejects owners, isolates records, and never mutates on GET", async () => {
  const h = await appointmentHttp(), actor = h.users[role];
  try {
    h.state.appointments.push(fixture({ faculty: actor.id }), fixture({ faculty: h.users.otherFaculty.id, subject: "PRIVATE-OTHER" }));
    h.state.slots.push(slot(actor.id, { startAt: new Date("2099-01-02T02:00:00Z"), endAt: new Date("2099-01-02T02:30:00Z") }), slot(h.users.otherFaculty.id));
    const before = clone(h.state);
    let response = await h.request("/faculty/calendar?" + range, role);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json(); assert.equal(data.events.length, 2); assert.doesNotMatch(JSON.stringify(data), /PRIVATE/);
    for (const query of ["&owner=" + actor.id, "&faculty=" + h.users.otherFaculty.id, "&facultyId=" + actor.id, "&includeFinalized=true&includeFinalized=false", "&start=2099-01-02", "&includeInactive=1"]) {
      response = await h.request("/faculty/calendar?" + range + query, role); assert.equal(response.status, 400);
    }
    assert.equal((await h.request("/faculty/calendar?" + range, "student")).status, 403);
    assert.equal((await h.request("/faculty/calendar?" + range, null)).status, 401);
    assert.deepEqual(h.state, before); assert.deepEqual(h.lockCalls, []);
  } finally { await h.close(); }
});

test("all event types, independent proposal membership, original reservations and unreserved proposed slots", async () => {
  const h = await appointmentHttp(), faculty = h.users.faculty.id;
  try {
    const original = slot(faculty), proposed = slot(faculty, { startAt: new Date("2099-01-03T02:00:00Z"), endAt: new Date("2099-01-03T02:30:00Z") });
    const row = fixture({ faculty, availability: original._id, status: "Reschedule Proposed", proposedAvailability: proposed._id, proposedStartAt: proposed.startAt, proposedEndAt: proposed.endAt, proposedConsultationMode: "Online" });
    h.state.slots.push(original, proposed, slot(faculty, { isActive: false, startAt: new Date("2099-01-04T02:00:00Z"), endAt: new Date("2099-01-04T02:30:00Z") }));
    h.state.appointments.push(row);
    for (const [index, status] of ["Pending", "Confirmed", "Awaiting Attendance Update", "Attendance Review"].entries()) h.state.appointments.push(fixture({ faculty, status, startAt: new Date(Date.UTC(2099,0,5+index,2)), endAt: new Date(Date.UTC(2099,0,5+index,3)) }));
    h.state.appointments.push(fixture({ faculty, startAt: null, endAt: null }), fixture({ faculty, startAt: new Date("2099-01-10"), endAt: new Date("2099-01-09") }));
    let response = await h.request("/faculty/calendar?" + range, "faculty"), data = await response.json();
    assert.equal(data.events.length, 8);
    assert.equal(new Set(data.events.map(e => e.id)).size, 8);
    assert.equal(data.events.some(e => e.availabilityId === original._id), false);
    assert.match(data.events.find(e => e.availabilityId === proposed._id).displayStatus, /Available.*not reserved/);
    assert.match(data.events.find(e => e.scheduleRole === "proposed").displayStatus, /awaiting Student response; not reserved/);
    assert.match(data.events.find(e => e.appointmentId === row._id && e.scheduleRole === "current").displayStatus, /Current schedule/);
    response = await h.request("/faculty/calendar?start=2099-01-03&end=2099-01-03&includeInactive=false", "faculty"); data = await response.json();
    assert.equal(data.events.length, 2); assert.equal(data.events.some(e => e.scheduleRole === "current"), false);
    response = await h.request("/faculty/calendar?" + range + "&includeInactive=false&includeAvailability=false", "faculty"); data = await response.json();
    assert.equal(data.events.length, 6); assert.equal(data.events.every(e => e.kind === "appointment"), true);
  } finally { await h.close(); }
});

test("overlap boundaries, inactive toggle, ongoing unavailable slots and past finalized policy", async () => {
  const h = await appointmentHttp(), faculty = h.users.faculty.id;
  try {
    const now = new Date("2099-01-01T02:15:00Z");
    h.state.slots.push(slot(faculty), slot(faculty, { isActive: false, startAt: new Date("2099-01-02T02:00:00Z"), endAt: new Date("2099-01-02T02:30:00Z") }));
    h.state.appointments.push(fixture({ faculty, startAt: new Date("2098-12-31T15:00:00Z"), endAt: new Date("2098-12-31T17:00:00Z") }));
    let data = await facultyCalendar({ faculty, now, input: { start: "2099-01-01", end: "2099-01-02" } });
    assert.equal(data.events.length, 3); assert.equal(data.events.filter(e => e.status === "Inactive").length, 2);
    data = await facultyCalendar({ faculty, now, input: { start: "2099-01-01", end: "2099-01-02", includeInactive: "false" } }); assert.equal(data.events.length, 1);
    h.state.appointments = ["Completed", "Rejected", "Cancelled", "Expired", "No Show"].map(status => fixture({ faculty, status }));
    h.state.appointments.push(fixture({ faculty, status: "Completed", startAt: null, endAt: null }), fixture({ faculty, status: "Completed", startAt: new Date("2099-01-02T02:00:00Z"), endAt: new Date("2099-01-02T02:30:00Z") }));
    const input = { start: "2099-01-01", end: "2099-01-02", includeAvailability: "false" };
    data = await facultyCalendar({ faculty, now: new Date("2099-01-01T03:00:00Z"), input }); assert.equal(data.events.length, 0);
    data = await facultyCalendar({ faculty, now: new Date("2099-01-01T03:00:00Z"), input: { ...input, includeFinalized: "true" } }); assert.equal(data.events.length, 5);
    h.state.appointments = [fixture({ faculty, startAt: new Date("2098-12-31T15:00:00Z"), endAt: new Date("2098-12-31T16:00:00Z") }), fixture({ faculty, startAt: new Date("2099-01-02T16:00:00Z"), endAt: new Date("2099-01-02T17:00:00Z") })];
    data = await facultyCalendar({ faculty, now, input }); assert.equal(data.events.length, 0);
  } finally { await h.close(); }
});

for (const collection of ["appointments", "slots"]) test(collection + " overflow fails explicitly without partial data", async () => {
  const h = await appointmentHttp(), faculty = h.users.faculty.id;
  try {
    h.state[collection] = Array.from({ length: 1001 }, () => collection === "slots" ? slot(faculty) : fixture({ faculty }));
    const response = await h.request("/faculty/calendar?" + range, "faculty");
    assert.equal(response.status, 422); const data = await response.json(); assert.match(data.message, /narrower date range/); assert.equal(data.events, undefined);
  } finally { await h.close(); }
});

for (const role of ["faculty", "dean"]) test(role + " narrow availability details are fresh, owner-only and read-only", async () => {
  const h = await appointmentHttp(), faculty = h.users[role].id;
  try {
    const own = slot(faculty), other = slot(h.users.otherFaculty.id), expired = slot(faculty, { startAt: new Date("2020-01-01"), endAt: new Date("2020-01-02") });
    h.state.slots.push(own, other, expired);
    const get = id => h.request("/availability/" + id + "/calendar-details", role);
    let response = await get(own._id); assert.equal(response.headers.get("cache-control"), "no-store");
    let data = await response.json(); assert.equal(data.availability.status, "Available"); assert.doesNotMatch(JSON.stringify(data), /PRIVATE|meetingLink|reservationToken/);
    own.isActive = false; data = await (await get(own._id)).json(); assert.equal(data.availability.status, "Inactive / unavailable");
    assert.equal((await get(other._id)).status, 404); assert.equal((await get("invalid")).status, 404);
    assert.equal((await h.request("/availability/" + own._id + "/calendar-details?owner=" + faculty, role)).status, 400);
    data = await (await get(expired._id)).json(); assert.equal(data.availability.status, "Expired");
    assert.equal((await h.request("/availability/mine?owner=" + faculty, role)).status, 400);
    assert.equal((await h.request("/availability/mine", role)).headers.get("cache-control"), "no-store");
    assert.deepEqual(h.lockCalls, []);
  } finally { await h.close(); }
});

test("calendar reads apply owner, projections, record limits and query timeouts", async () => {
  const originals = [Appointment.find, Availability.find], calls = [];
  const mock = model => filter => {
    const call = { model, filter }; calls.push(call);
    const chain = { select(value) { call.fields = value; return this; }, populate() { return this; }, sort(value) { call.sort = value; return this; }, limit(value) { call.limit = value; return this; }, maxTimeMS(value) { call.timeout = value; return this; }, async lean() { return []; } }; return chain;
  };
  Appointment.find = mock("appointment"); Availability.find = mock("availability");
  try {
    await facultyCalendar({ faculty: "owner", input: { start: "2099-01-01", end: "2099-01-01" } });
    assert.equal(calls.length, 2);
    for (const call of calls) { assert.equal(call.filter.faculty, "owner"); assert.equal(call.limit, 1001); assert.equal(call.timeout, 10000); assert.deepEqual(call.sort, { startAt: 1, _id: 1 }); assert.doesNotMatch(call.fields, /meetingLink|attendance|supportingDocuments|reason|notes/); }
  } finally { [Appointment.find, Availability.find] = originals; }
});
