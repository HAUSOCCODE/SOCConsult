import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import SupportingDocument from "../src/models/SupportingDocument.js";
import { parseRequestQuery, listFacultyRequests, facultyRequestDetails } from "../src/services/facultyRequestService.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";

const id = "1234567890abcdef12345678", docId = "abcdef123456789012345678";
const chain = value => { const q = { then: (yes, no) => Promise.resolve(value).then(yes, no) }; for (const key of ["select", "populate", "maxTimeMS", "lean"]) q[key] = () => q; return q; };
const row = (extra = {}) => ({ _id: id, student: { name: "Student", studentId: "PRIVATE", email: "PRIVATE" }, faculty: "PRIVATE", subject: "<b>Course</b>", reason: "Concern\n".repeat(90), status: "Pending", createdAt: new Date(), startAt: null, supportingDocuments: [{ _id: docId, originalName: "file.txt", mimeType: "text/plain", cloudinaryUrl: "PRIVATE", cloudinaryPublicId: "PRIVATE" }], meetingLink: "PRIVATE", reservationToken: "PRIVATE", attendance: { reviewReason: "PRIVATE" }, __v: 3, ...extra });

test("request query rejects owner IDs, arrays, invalid statuses and unbounded pages", () => {
  assert.deepEqual(parseRequestQuery(), { status: "Pending", page: 1 });
  for (const input of [{ faculty: id }, { facultyId: id }, { ownerId: id }, { status: ["Pending"] }, { status: "Completed" }, { page: "0" }, { page: "10001" }, { page: {} }, { limit: "100" }, { status: "All", sort: "oldest" }]) assert.throws(() => parseRequestQuery(input), { statusCode: 400 });
});

test("list uses owner match, database filtering, stable sorting and bounded pagination; All retains every status", async () => {
  const old = Appointment.aggregate, oldPopulate = Appointment.populate;
  try {
    Appointment.populate = async (rows, options) => { assert.equal(options.select, "name"); return rows; };
    for (const status of ["Pending", "Reschedule Proposed", "Confirmed", "Rejected", "Cancelled", "Expired", "All"]) {
      Appointment.aggregate = pipeline => {
        assert.equal(String(pipeline[0].$match.faculty), id);
        assert.equal(pipeline[0].$match.status, status === "All" ? undefined : status);
        const records = pipeline[1].$facet.records;
        assert.deepEqual(records.find(x => x.$sort).$sort, status === "Pending" ? { requestUnscheduled: 1, requestStartSort: 1, _id: 1 } : { createdAt: -1, _id: -1 });
        assert.deepEqual(records.find(x => "$skip" in x), { $skip: 20 });
        assert.deepEqual(records.find(x => x.$limit), { $limit: 20 });
        assert.equal(records.at(-1).$project.meetingLink, undefined);
        const statuses = status === "All" ? ["Awaiting Attendance Update", "Attendance Review", "Completed", "No Show", "Awaiting Faculty Schedule"] : [status];
        return { option: options => { assert.equal(options.maxTimeMS, 10000); return Promise.resolve([{ records: statuses.map(s => row({ status: s })), count: [{ total: 43 }] }]); } };
      };
      const result = await listFacultyRequests({ faculty: id, input: { status, page: "2" } });
      assert.deepEqual(result.pagination, { page: 2, limit: 20, total: 43, totalPages: 3 });
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE|cloudinary|studentId|meetingLink|reviewReason/);
      assert.equal(result.requests[0].subject, "<b>Course</b>"); assert.equal(result.requests[0].reason.length, 180);
      assert.equal(result.requests[0].startAt, null); assert.equal(result.requests[0].hasSupportingDocuments, true);
      if (status === "All") assert.deepEqual(result.requests.map(r => r.status), ["Awaiting Attendance Update", "Attendance Review", "Completed", "No Show", "Awaiting Faculty Schedule"]);
    }
  } finally { Appointment.aggregate = old; Appointment.populate = oldPopulate; }
});

test("fresh details query ownership before legacy metadata and return only safe fields", async () => {
  const old = Appointment.findOne, oldDoc = SupportingDocument.findOne;
  try {
    Appointment.findOne = filter => { assert.deepEqual(filter, { _id: id, faculty: docId }); return chain(null); };
    SupportingDocument.findOne = () => assert.fail("Unowned detail read protected metadata");
    await assert.rejects(facultyRequestDetails({ id, faculty: docId }), { statusCode: 404 });
    Appointment.findOne = () => chain(row({ supportingDocuments: [docId] }));
    SupportingDocument.findOne = filter => { assert.deepEqual(filter, { _id: docId, appointment: id }); return chain({ _id: docId, originalName: "file.txt", cloudinaryUrl: "PRIVATE" }); };
    const result = await facultyRequestDetails({ id, faculty: docId });
    assert.equal(result.appointment.reason, row().reason);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|studentId|meetingLink|reviewReason/);
    assert.deepEqual(result.appointment.supportingDocuments, [{ _id: docId, originalName: "file.txt", mimeType: undefined, size: undefined }]);
  } finally { Appointment.findOne = old; SupportingDocument.findOne = oldDoc; }
});

test("Faculty and Dean HTTP personal endpoints deny cross-user reads before file access and GETs never write", async () => {
  const h = await appointmentHttp(), restores = [];
  const patch = (object, key, value) => { const old = object[key]; object[key] = value; restores.push(() => object[key] = old); };
  let owner, reads = 0;
  try {
    for (const model of [Appointment, SupportingDocument]) {
      for (const method of ["create", "updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "bulkWrite"]) patch(model, method, () => assert.fail(`GET invoked ${method}`));
      patch(model.prototype, "save", () => assert.fail("GET invoked save"));
    }
    patch(Appointment, "findOne", filter => {
      assert.equal(filter._id, id);
      if (filter.faculty !== owner) return chain(null);
      reads++;
      return chain(row({ faculty: owner, student: h.users.student.id, supportingDocuments: [], supportingDocument: { name: "file.txt", mimeType: "text/plain", data: "data:text/plain;base64,c2FmZQ==" } }));
    });
    patch(Appointment, "exists", filter => chain(filter._id === id && filter.faculty === owner));
    patch(Appointment, "aggregate", pipeline => ({ option: options => {
      assert.equal(options.maxTimeMS, 10000);
      const match = pipeline[0].$match;
      assert.ok(Object.values(h.users).some(user => user.id === String(match.faculty)));
      return Promise.resolve([{ records: String(match.faculty) === owner ? [row()] : [], count: String(match.faculty) === owner ? [{ total: 1 }] : [] }]);
    } }));
    patch(Appointment, "populate", async rows => rows);
    patch(SupportingDocument, "findOne", () => assert.fail("Unowned file read"));
    for (const role of ["faculty", "dean"]) {
      owner = h.users[role].id;
      const list = await h.request("/appointments/requests", role);
      assert.equal(list.status, 200); assert.equal((await list.json()).requests.length, 1);
      const otherList = await h.request("/appointments/requests", role === "dean" ? "faculty" : "dean");
      assert.equal((await otherList.json()).requests.length, 0);
      let response = await h.request(`/appointments/requests/${id}`, role);
      assert.equal(response.status, 200); assert.doesNotMatch(JSON.stringify(await response.json()), /PRIVATE|data:text|studentId/);
      response = await h.request(`/appointments/requests/${id}/document`, role);
      assert.equal(response.status, 200); assert.equal(await response.text(), "safe");
      assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const before = reads;
      for (const other of [role === "dean" ? "faculty" : "dean", "otherFaculty"]) {
        assert.equal((await h.request(`/appointments/requests/${id}`, other)).status, 404);
        assert.equal((await h.request(`/appointments/requests/${id}/document`, other)).status, 404);
      }
      assert.equal(reads, before);
      assert.equal((await h.request(`/appointments/requests/${id}?facultyId=${owner}`, role)).status, 400);
      assert.equal((await h.request(`/appointments/requests?facultyId=${owner}`, role)).status, 400);
      assert.equal((await h.request(`/appointments/requests/${id}/documents/${docId}`, role)).status, 404);
      assert.equal((await h.request(`/appointments/requests/${docId}/document`, role)).status, 404);
    }
    assert.equal((await h.request("/appointments/requests", "student")).status, 403);
    assert.equal(h.state.audits.length, 0);
  } finally { restores.reverse().forEach(fn => fn()); await h.close(); }
});

test("Pending pages keep chronological ties stable and place missing/null schedules last", async () => {
  const old = Appointment.aggregate, oldPopulate = Appointment.populate;
  const faculty = id;
  const rows = Array.from({ length: 23 }, (_, i) => row({ _id: String(i + 1).padStart(24, "0"), faculty, supportingDocuments: [], startAt: new Date(`2026-10-${String(20 + Math.floor(i / 8)).padStart(2, "0")}T00:00:00Z`) }));
  rows.push(row({ _id: "999999999999999999999998", faculty, startAt: null }), row({ _id: "999999999999999999999999", faculty, startAt: undefined }));
  rows.push(row({ _id: docId, faculty: docId, startAt: new Date("2026-01-01") }), row({ status: "Confirmed", faculty, startAt: new Date("2026-01-01") }));
  try {
    Appointment.populate = async values => values;
    Appointment.aggregate = pipeline => ({ option: async () => {
      const match = pipeline[0].$match, records = pipeline[1].$facet.records;
      const matched = rows.filter(row => row.faculty === String(match.faculty) && (!match.status || row.status === match.status));
      const expr = (expression, row) => {
        if (typeof expression === "string" && expression.startsWith("$")) return row[expression.slice(1)];
        if (expression === null || typeof expression !== "object") return expression;
        if (expression.$type) return expr(expression.$type, row) instanceof Date ? "date" : "missing";
        if (expression.$eq) return expr(expression.$eq[0], row) === expr(expression.$eq[1], row);
        if (expression.$cond) return expr(expression.$cond[expr(expression.$cond[0], row) ? 1 : 2], row);
        throw Error("Unsupported expression");
      };
      let pageRows = matched.map(row => ({ ...row }));
      for (const stage of records) {
        if (stage.$set) pageRows = pageRows.map(row => ({ ...row, ...Object.fromEntries(Object.entries(stage.$set).map(([key, value]) => [key, expr(value, row)])) }));
        if (stage.$sort) pageRows.sort((a, b) => { for (const [key, direction] of Object.entries(stage.$sort)) { if (a[key] < b[key]) return -direction; if (a[key] > b[key]) return direction; } return 0; });
        if ("$skip" in stage) pageRows = pageRows.slice(stage.$skip);
        if (stage.$limit) pageRows = pageRows.slice(0, stage.$limit);
      }
      return [{ records: pageRows, count: [{ total: matched.length }] }];
    } });
    const first = await listFacultyRequests({ faculty, input: {} });
    const second = await listFacultyRequests({ faculty, input: { page: "2" } });
    assert.equal(first.requests.length, 20); assert.equal(second.requests.length, 5); assert.equal(first.pagination.total, 25);
    assert.deepEqual([...first.requests, ...second.requests].map(row => row._id), rows.slice(0, 25).map(row => row._id));
    assert.deepEqual(second.requests.slice(-2).map(row => row.startAt), [null, null]);
  } finally { Appointment.aggregate = old; Appointment.populate = oldPopulate; }
});
