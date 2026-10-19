import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import SupportingDocument from "../src/models/SupportingDocument.js";
import { sectionFor, parseConsultationQuery, listFacultyConsultations, detailRecord } from "../src/services/facultyConsultationService.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
const id = "1234567890abcdef12345678", owner = "abcdef123456789012345678";
const now = new Date("2026-10-19T04:00:00Z"), before = new Date(+now - 1), after = new Date(+now + 1);
const chain = value => { const q = { then: (yes, no) => Promise.resolve(value).then(yes, no) }; for (const k of ["select", "populate", "maxTimeMS", "lean"]) q[k] = () => q; return q; };
const row = extra => ({ _id: id, faculty: owner, student: { name: "Student", email: "PRIVATE", studentId: "PRIVATE", program: "PRIVATE" }, status: "Confirmed", startAt: before, endAt: after, consultationMode: "Online", meetingLink: "https://meeting.example/test", subject: "Course", reason: "Concern", __v: 2, notes: "PRIVATE", reservationToken: "PRIVATE", ...extra });
test("exact half-open grouping includes running Confirmed and requires valid schedules", () => {
  assert.equal(sectionFor(row(), now), "Upcoming");
  assert.equal(sectionFor(row({ endAt: now }), now), "Awaiting Attendance Update");
  assert.equal(sectionFor(row({ endAt: before }), now), "Compatibility");
  assert.equal(sectionFor(row({ startAt: null }), now), "Compatibility");
  for (const status of ["Pending", "Reschedule Proposed", "Awaiting Attendance Update", "Attendance Review"]) assert.equal(sectionFor(row({ status, startAt: null }), now), status);
  for (const status of ["Completed", "Rejected", "Cancelled", "Expired", "No Show"]) assert.equal(sectionFor(row({ status }), now), "Recently Finalized");
  for (const status of ["Approved", "Rescheduled", "Needs Reschedule", "Awaiting Faculty Schedule", "unknown"]) assert.equal(sectionFor(row({ status }), now), "Compatibility");
});
test("strict section queries reject arbitrary owners and unbounded pages", () => {
  for (const input of [{ faculty: owner }, { facultyId: owner }, { ownerId: owner }, { section: ["Upcoming"] }, { limit: "100" }, { page: "0" }, { page: "10001" }, { page: "1.1" }, { section: "Recently Finalized", page: "2" }, { section: "Compatibility", page: "2" }]) assert.throws(() => parseConsultationQuery(input), { statusCode: 400 });
});
test("database pagination precedes safe name-only population; stable section sorts and one now", async () => {
  const old = Appointment.aggregate, pop = Appointment.populate;
  try {
    for (const section of ["Upcoming", "Pending", "Reschedule Proposed", "Awaiting Attendance Update", "Attendance Review", "Recently Finalized", "Compatibility"]) {
      Appointment.aggregate = pipeline => {
        assert.equal(String(pipeline[0].$match.faculty), owner);
        assert.equal(pipeline[1].$set.personalSection.$switch.branches[4].then.$cond[0].$gt[1], now);
        assert.equal(pipeline[2].$match.personalSection, section);
        const records = pipeline[3].$facet.records;
        assert.ok(records[0].$sort._id); assert.equal(records[2].$limit, 20);
        assert.equal(records[1].$skip, 0);
        assert.equal(records[3].$project.meetingLink, undefined);
        return { option: async () => [{ records: [row()], count: [{ total: 50 }] }] };
      };
      Appointment.populate = async (rows, options) => { assert.equal(options.select, "name"); return rows; };
      const result = await listFacultyConsultations({ faculty: owner, input: { section }, now });
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE|meetingLink|notes|studentId|email|program/);
      assert.equal(result.pagination.totalPages, ["Recently Finalized", "Compatibility"].includes(section) ? 1 : 3);
    }
  } finally { Appointment.aggregate = old; Appointment.populate = pop; }
});
test("detail projections gate links by assignment/state/mode/schedule, history reasons and actions", () => {
  for (const role of ["faculty", "dean"]) {
    const actor = { id: owner, role };
    for (const status of ["Confirmed", "Awaiting Attendance Update", "Attendance Review", "Completed", "Pending", "Reschedule Proposed", "Cancelled", "Rejected", "Expired", "No Show"]) {
      const result = detailRecord(row({ status }), actor, now);
      assert.equal(Boolean(result.meetingLink), ["Confirmed", "Awaiting Attendance Update", "Attendance Review", "Completed"].includes(status));
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE|notes|reservationToken|studentId|email|program/);
    }
    for (const extra of [{ consultationMode: "Face-to-Face" }, { endAt: before }, { startAt: null }, { meetingLink: "javascript:alert(1)" }, { meetingLink: "https://" }, { meetingLink: "https://user:secret@meeting.example" }]) assert.equal(detailRecord(row(extra), actor, now).meetingLink, undefined);
    assert.equal(detailRecord(row(), { ...actor, id }, now).meetingLink, undefined);
    assert.equal(detailRecord(row(), { ...actor, management: true }, now).meetingLink, undefined);
    assert.equal(detailRecord(row({ startAt: after, endAt: new Date(+after + 1000) }), actor, now).actions.propose, true);
    assert.equal(detailRecord(row(), actor, now).actions.propose, false);
    assert.equal(detailRecord(row(), actor, now).actions.cancel, false);
    assert.deepEqual(detailRecord(row({ status: "Approved" }), actor, now).actions, {});
    const result = detailRecord(row({ status: "Rejected", statusHistory: [
      { newStatus: "Rejected", changedAt: after, source: "reject", reason: "Decision reason" },
      { newStatus: "Attendance Review", changedAt: now, source: "attendance_review", reason: "PRIVATE" },
      { newStatus: "Confirmed", changedAt: before, source: "confirm", reason: "Confirmed reason" },
    ] }), actor, now);
    assert.equal(result.confirmedSchedule, true);
    assert.deepEqual(result.statusHistory.map(e => e.newStatus), ["Confirmed", "Attendance Review", "Rejected"]);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    assert.equal(detailRecord(row({ status: "Pending" }), actor, now).confirmedSchedule, false);
  }
});
test("HTTP personal routes scope Faculty and Dean, deny cross-account details/documents and GET writes", async () => {
  const h = await appointmentHttp(), restores = [];
  const patch = (obj, key, value) => { const old = obj[key]; obj[key] = value; restores.push(() => obj[key] = old); };
  let assigned;
  try {
    for (const model of [Appointment, SupportingDocument]) for (const method of ["create", "updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "bulkWrite"]) patch(model, method, () => assert.fail("GET wrote data"));
    patch(Appointment.prototype, "save", () => assert.fail("GET saved data"));
    patch(Appointment, "findOne", filter => chain(filter.faculty === assigned ? row({ faculty: assigned, status: "Pending", supportingDocuments: [], supportingDocument: { name: "file.txt", mimeType: "text/plain", data: "data:text/plain;base64,c2FmZQ==" } }) : null));
    patch(Appointment, "exists", filter => chain(filter.faculty === assigned));
    patch(Appointment, "findById", () => chain(row({ faculty: assigned, status: "Pending", attendance: null })));
    patch(Appointment, "aggregate", pipeline => ({ option: async () => [{ records: String(pipeline[0].$match.faculty) === assigned ? [row()] : [], count: [] }] }));
    patch(Appointment, "populate", async rows => rows);
    for (const role of ["faculty", "dean"]) {
      assigned = h.users[role].id;
      const list = await h.request("/appointments/consultations", role); assert.equal(list.status, 200); assert.equal((await list.json()).appointments.length, 1);
      const detail = await h.request(`/appointments/consultations/${id}`, role); assert.equal(detail.status, 200); assert.doesNotMatch(JSON.stringify(await detail.json()), /PRIVATE|data:text/);
      const doc = await h.request(`/appointments/consultations/${id}/document`, role); assert.equal(doc.status, 200); assert.equal(await doc.text(), "safe"); assert.equal(doc.headers.get("cache-control"), "no-store");
      for (const other of [role === "faculty" ? "dean" : "faculty", "otherFaculty"]) {
        assert.equal((await h.request(`/appointments/consultations/${id}`, other)).status, 404);
        assert.equal((await h.request(`/appointments/consultations/${id}/document`, other)).status, 404);
      }
      for (const suffix of ["", `/${id}`, `/${id}/document`]) assert.equal((await h.request(`/appointments/consultations${suffix}?ownerId=${assigned}`, role)).status, 400);
    }
    assert.equal((await h.request("/appointments/consultations", "student")).status, 403);
  } finally { restores.reverse().forEach(fn => fn()); await h.close(); }
});
