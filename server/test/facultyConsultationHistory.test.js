import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import {
  FACULTY_HISTORY_MAX_LIMIT,
  FACULTY_HISTORY_STATUSES,
  facultyHistoryQuery,
  listFacultyConsultationHistory,
  parseFacultyHistoryInput,
  safeFacultyHistoryRecord,
} from "../src/services/facultyConsultationHistoryService.js";

const id = () => new mongoose.Types.ObjectId().toString();
const tokenFor = value => jwt.sign({ sub: value }, env.jwtSecret);
const listen = () => new Promise(resolve => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Faculty history validates canonical server filters and preserves status/outcome separation", () => {
  assert.deepEqual(FACULTY_HISTORY_STATUSES, ["Completed", "Cancelled", "Rejected", "Expired", "Attendance Review"]);
  assert.equal(FACULTY_HISTORY_MAX_LIMIT, 50);
  const faculty = id();
  const filters = parseFacultyHistoryInput({ page: "2", limit: "5", from: "2026-10-01", to: "2026-10-20", status: "Completed", attendanceOutcome: "Student No-show", mode: "Online", search: "  Student 123  " });
  const query = facultyHistoryQuery({ faculty, filters, studentIds: [id()] });
  assert.equal(query.faculty, faculty);
  assert.equal(query.status, "Completed");
  assert.equal(query["attendance.finalOutcome"], "Student No-show");
  assert.equal(query.consultationMode, "Online");
  assert.equal(filters.search, "Student 123");
  assert.equal(filters.from.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(filters.to.toISOString(), "2026-10-20T16:00:00.000Z");
  for (const invalid of [{ status: "Pending" }, { attendanceOutcome: "No Show" }, { mode: "Hybrid" }, { from: "bad" }, { from: "2026-10-21", to: "2026-10-20" }, { page: "0" }, { limit: "51" }, { facultyId: id() }, { search: "x".repeat(101) }])
    assert.throws(() => parseFacultyHistoryInput(invalid));

  const safe = safeFacultyHistoryRecord({ _id: id(), student: { _id: id(), name: "Student", studentId: "S-1", email: "private@test", password: "secret" }, subject: "Algorithms", reason: "Review", status: "Completed", consultationMode: "Online", attendance: { finalOutcome: "Student No-show", studentResponse: { outcome: "Completed", reason: "private" }, facultyResponse: { reason: "private" } }, meetingLink: "private-link", reservationToken: "token" });
  assert.equal(safe.status, "Completed");
  assert.equal(safe.finalAttendanceOutcome, "Student No-show");
  assert.doesNotMatch(JSON.stringify(safe), /private@test|secret|studentResponse|facultyResponse|private-link|reservationToken/);
});

test("Faculty history endpoint is authenticated, role restricted, personally scoped, sorted and paginated", async () => {
  const facultyA = id(), facultyB = id(), dean = id(), student = id();
  const originalFindById = User.findById, originalFind = Appointment.find, originalCount = Appointment.countDocuments;
  const queries = [];
  User.findById = async value => ({ _id: String(value), id: String(value), name: "Account", role: String(value) === student ? "student" : String(value) === dean ? "dean" : "faculty", accountStatus: "Active" });
  Appointment.find = query => {
    queries.push(query);
    const rows = String(query.faculty) === facultyA ? [{ _id: id(), student: { _id: student, name: "Assigned Student", studentId: "S-1" }, subject: "Algorithms", reason: "Review", startAt: new Date("2026-10-01T01:00:00Z"), endAt: new Date("2026-10-01T02:00:00Z"), consultationMode: "Online", status: "Completed", attendance: { finalOutcome: "Completed" }, supportingDocuments: [] }] : [];
    const chain = { select: () => chain, populate: () => chain, sort: value => { chain.sortValue = value; return chain; }, skip: value => { chain.skipValue = value; return chain; }, limit: value => { chain.limitValue = value; return chain; }, lean: async () => rows };
    return chain;
  };
  Appointment.countDocuments = async query => String(query.faculty) === facultyA ? 1 : 0;
  const server = await listen(), base = `http://127.0.0.1:${server.address().port}/api/appointments/faculty-history`;
  const call = async (actor, suffix = "") => { const response = await fetch(`${base}${suffix}`, { headers: actor ? { Authorization: `Bearer ${tokenFor(actor)}` } : {} }); return { status: response.status, body: await response.json() }; };
  try {
    assert.equal((await call()).status, 401);
    assert.equal((await call(student)).status, 403);
    const own = await call(facultyA, "?page=1&limit=10&status=Completed");
    assert.equal(own.status, 200); assert.equal(own.body.consultations.length, 1); assert.equal(own.body.pagination.total, 1);
    assert.equal((await call(facultyB)).body.consultations.length, 0);
    assert.equal((await call(dean)).body.consultations.length, 0);
    assert.equal((await call(facultyA, "?status=Pending")).status, 400);
    assert.ok(queries.every(query => [facultyA, facultyB, dean].includes(String(query.faculty))));
  } finally {
    await new Promise(resolve => server.close(resolve));
    User.findById = originalFindById; Appointment.find = originalFind; Appointment.countDocuments = originalCount;
  }
});

test("Student search is restricted to owned history before stable database pagination", async () => {
  const faculty = id(), ownedStudent = new mongoose.Types.ObjectId(), otherStudent = new mongoose.Types.ObjectId();
  const originalDistinct = Appointment.distinct, originalFind = Appointment.find, originalCount = Appointment.countDocuments, originalUserFind = User.find;
  let distinctQuery, finalQuery, skip, limit, userQuery;
  Appointment.distinct = async (_field, query) => { distinctQuery = query; return [ownedStudent]; };
  User.find = query => { userQuery = query; const chain = { select: () => chain, lean: async () => [{ _id: ownedStudent }] }; return chain; };
  Appointment.find = query => {
    finalQuery = query;
    const chain = { select: () => chain, populate: () => chain, sort: value => { assert.deepEqual(value, { startAt: -1, _id: -1 }); return chain; }, skip: value => { skip = value; return chain; }, limit: value => { limit = value; return chain; }, lean: async () => [] };
    return chain;
  };
  Appointment.countDocuments = async () => 11;
  try {
    const result = await listFacultyConsultationHistory({ faculty, input: { search: "A.*", page: "2", limit: "5", mode: "Online" } });
    assert.equal(String(distinctQuery.faculty), faculty);
    assert.equal(distinctQuery.consultationMode, "Online");
    assert.deepEqual(userQuery._id.$in, [ownedStudent]);
    assert.ok(userQuery.$or.every(condition => Object.values(condition)[0].source === "A\\.\\*"));
    assert.deepEqual(finalQuery.student.$in, [ownedStudent]);
    assert.notDeepEqual(finalQuery.student.$in, [otherStudent]);
    assert.equal(skip, 5); assert.equal(limit, 5);
    assert.deepEqual(result.pagination, { page: 2, limit: 5, total: 11, totalPages: 3 });
  } finally {
    Appointment.distinct = originalDistinct; Appointment.find = originalFind; Appointment.countDocuments = originalCount; User.find = originalUserFind;
  }
});

test("Faculty History UI uses server filtering, pagination, safe states and personal read-only details", async () => {
  const [page, routes, service, details] = await Promise.all([
    read("../../client/src/pages/Faculty/FacultyConsultationHistory.jsx"),
    read("../src/routes/appointmentRoutes.js"),
    read("../src/services/facultyConsultationHistoryService.js"),
    read("../../client/src/components/appointments/PersonalConsultationDetails.jsx"),
  ]);
  for (const text of ["Date From", "Date To", "Appointment Status", "Attendance Outcome", "Consultation Mode", "Student name or institutional ID", "Apply Filters", "Clear Filters", "Previous", "Next", "No consultation history yet.", "No historical consultations match the selected filters.", "View Details", "Loading consultation record..."]) assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /appointments\/faculty-history/);
  assert.match(page, /AbortController/);
  assert.match(page, /detailSequence/);
  assert.match(page, /FacultyAppointmentDetailsModal personal/);
  assert.match(routes, /listFacultyConsultationHistory\(\{ faculty: req\.user\.id/);
  assert.match(service, /sort\(\{ startAt: -1, _id: -1 \}\).*skip.*limit/);
  assert.match(service, /attendance\.finalOutcome/);
  assert.match(details, /SupportingDocumentViewer|ConsultationRecordForm/);
  assert.doesNotMatch(page, /PDF|Export Report|>Confirm<|>Reject<|>Reschedule<|Submit Attendance/);
});
