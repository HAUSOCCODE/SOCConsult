import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import SupportingDocument from "../src/models/SupportingDocument.js";
import {
  STUDENT_HISTORY_STATUSES,
  manilaHistoryBoundary,
  safeStudentHistoryRecord,
  studentHistoryQuery,
  safeDocuments,
} from "../src/services/studentConsultationHistoryService.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const tokenFor = id => jwt.sign({ sub: id }, env.jwtSecret);
const listen = () => new Promise(resolve => {
  const server = app.listen(0, "127.0.0.1", () => resolve(server));
});

test("Student history classification, Manila dates, filters, and safe records are explicit", () => {
  assert.deepEqual(STUDENT_HISTORY_STATUSES, ["Completed", "Rejected", "Cancelled", "Expired", "Attendance Review"]);
  assert.equal(manilaHistoryBoundary("2026-10-20").toISOString(), "2026-10-19T16:00:00.000Z");
  assert.equal(manilaHistoryBoundary("2026-10-20", true).toISOString(), "2026-10-20T16:00:00.000Z");
  assert.equal(manilaHistoryBoundary("2026-02-30"), null);
  const student = new mongoose.Types.ObjectId();
  const faculty = new mongoose.Types.ObjectId();
  const query = studentHistoryQuery({ student, status: "Completed", mode: "Online", faculty: String(faculty), from: "2026-10-01", to: "2026-10-20" });
  assert.equal(query.student, student);
  assert.equal(query.status, "Completed");
  assert.equal(query.consultationMode, "Online");
  assert.equal(String(query.faculty), String(faculty));
  assert.equal(query.startAt.$gte.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(query.startAt.$lt.toISOString(), "2026-10-20T16:00:00.000Z");
  assert.throws(() => studentHistoryQuery({ student, status: "Pending" }), /Invalid history status/);
  assert.throws(() => studentHistoryQuery({ student, mode: "Hybrid" }), /Invalid consultation mode/);
  assert.throws(() => studentHistoryQuery({ student, from: "2026-10-21", to: "2026-10-20" }), /From date/);

  const safe = safeStudentHistoryRecord({
    _id: "appointment", status: "Completed", subject: "Algorithms", reason: "Complexity",
    faculty: { _id: "faculty", name: "Faculty Name", email: "private@example.test", password: "secret" },
    attendance: { policyVersion: "policy", finalOutcome: "Completed" },
    meetingLink: "private-link", reservationToken: "private-token", notes: "private-note",
    statusHistory: [{ previousStatus: "Confirmed", newStatus: "Completed", changedAt: new Date(), changedByRole: "System", changedBy: "private-id", reason: "private-reason", source: "private-source" }],
    supportingDocuments: [{ _id: "document", originalName: "safe.pdf", cloudinaryPublicId: "private-public-id" }],
  });
  const serialized = JSON.stringify(safe);
  assert.match(serialized, /Algorithms|Completed|safe\.pdf/);
  for (const hidden of ["private@example.test", "secret", "private-link", "private-token", "private-note", "private-id", "private-reason", "private-source", "private-public-id"])
    assert.doesNotMatch(serialized, new RegExp(hidden));
});

test("Student history endpoint is authenticated, ownership scoped, paginated, and read only", async () => {
  const studentA = new mongoose.Types.ObjectId().toString();
  const studentB = new mongoose.Types.ObjectId().toString();
  const faculty = new mongoose.Types.ObjectId().toString();
  const originalFindById = User.findById;
  const originalFind = Appointment.find;
  const originalCount = Appointment.countDocuments;
  const queries = [];
  User.findById = async id => ({ _id: String(id), id: String(id), name: "Student", role: "student", accountStatus: "Active" });
  Appointment.find = query => {
    queries.push(query);
    const rows = String(query.student) === studentA ? [{
      _id: "appointment-a", student: studentA, faculty: { _id: faculty, name: "Faculty A" },
      subject: "Algorithms", reason: "Review", startAt: new Date("2026-10-01T01:00:00Z"), endAt: new Date("2026-10-01T02:00:00Z"),
      consultationMode: "Online", meetingPlatform: "Teams", status: "Completed",
      attendance: { policyVersion: "policy", finalOutcome: "Completed" }, statusHistory: [], supportingDocuments: [],
    }] : [];
    const chain = { select: () => chain, populate: () => chain, sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => rows };
    return chain;
  };
  Appointment.countDocuments = async query => String(query.student) === studentA ? 1 : 0;
  const server = await listen();
  const base = `http://127.0.0.1:${server.address().port}/api/appointments/student-history`;
  const call = async (id, suffix = "") => {
    const response = await fetch(`${base}${suffix}`, { headers: id ? { Authorization: `Bearer ${tokenFor(id)}` } : {} });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await call()).status, 401);
    const own = await call(studentA, "?status=Completed&mode=Online");
    assert.equal(own.status, 200);
    assert.equal(own.body.consultations.length, 1);
    assert.equal(own.body.pagination.total, 1);
    assert.equal((await call(studentB)).body.consultations.length, 0);
    assert.equal((await call(studentA, "?status=Pending")).status, 400);
    assert.ok(queries.every(query => [studentA, studentB].includes(String(query.student))));
  } finally {
    await new Promise(resolve => server.close(resolve));
    User.findById = originalFindById;
    Appointment.find = originalFind;
    Appointment.countDocuments = originalCount;
  }
});

test("Student History UI has required filters and read-only details without deletion", async () => {
  const [page, modal] = await Promise.all([
    read("../../client/src/pages/Student/StudentConsultationHistory.jsx"),
    read("../../client/src/components/appointments/StudentAppointmentDetailsModal.jsx"),
  ]);
  for (const text of ["From", "To", "Faculty / Provider", "Status", "Consultation mode", "Attendance Review"])
    assert.match(page, new RegExp(text));
  assert.match(page, /student-history/);
  assert.match(page, /readOnly historyMode/);
  assert.match(modal, /historyMode/);
  assert.match(modal, /Status History/);
  assert.doesNotMatch(page, /delete|destroy|remove/i);
  assert.doesNotMatch(page, /Awaiting Attendance Update/);
});

test("history preserves safe original preferences separately from assigned schedules for both roles", async () => {
  const { safeFacultyHistoryRecord } = await import("../src/services/facultyConsultationHistoryService.js");
  const { formatManilaHistorySchedule, requestedDateLabel } = await import("../../client/src/utils/appointmentSchedule.js");
  for (const status of ["Rejected", "Cancelled", "Expired", "Completed", "Attendance Review"]) {
    const row = { _id: "owned", status, initiatedByRole: "student", requestedConsultationDate: "2026-10-20", requestedConsultationTime: "09:00", availableTimeSlots: [{ startTime: "09:00", endTime: "10:00", private: "SECRET" }, { startTime: "13:00", endTime: "15:00" }] };
    const before = structuredClone(row);
    for (const map of [safeStudentHistoryRecord, safeFacultyHistoryRecord]) {
      const safe = map(row); assert.equal(safe.requestedConsultationDate, "2026-10-20"); assert.equal(safe.requestedConsultationTime, "09:00");
      assert.equal(safe.availableTimeSlots.length, 2); assert.equal(safe.startAt, undefined);
      assert.doesNotMatch(JSON.stringify(safe), /SECRET/);
      const label = formatManilaHistorySchedule(safe); assert.match(label, /Requested Date/); assert.match(label, /Preferred Availability/); assert.match(label, /1:00/); assert.match(label, /3:00/); assert.doesNotMatch(label, /Confirmed Schedule/);
    }
    assert.deepEqual(row, before);
  }
  const completed = { status: "Completed", requestedConsultationDate: "2026-10-19", startAt: "2026-10-19T16:30:00Z", endAt: "2026-10-19T17:30:00Z" };
  assert.match(formatManilaHistorySchedule(completed), /Confirmed Schedule:.*20.*2026.*12:30/);
  assert.match(requestedDateLabel("2026-10-20"), /20.*2026/);
  assert.match(formatManilaHistorySchedule({}), /not recorded/);
  assert.equal(studentHistoryQuery({ student: "owned", from: "2026-10-20" }).startAt.$gte.toISOString(), "2026-10-19T16:00:00.000Z");
  assert.equal(studentHistoryQuery({ student: "owned" }).startAt, undefined);
  for (const path of ["../src/services/studentConsultationHistoryService.js", "../src/services/facultyConsultationHistoryService.js"]) {
    const source = await read(path); assert.match(source, /const projection = ".*requestedConsultationDate requestedConsultationTime availableTimeSlots/);
  }
});

test("legacy metadata hydration matches both appointment and document in one batched read", async () => {
  const first = new mongoose.Types.ObjectId(), second = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
  const ownFirst = new mongoose.Types.ObjectId(), ownSecond = new mongoose.Types.ObjectId(), foreign = new mongoose.Types.ObjectId(), missing = new mongoose.Types.ObjectId();
  const embedded = { _id: new mongoose.Types.ObjectId(), originalName: "embedded.pdf", mimeType: "application/pdf", size: 80, cloudinaryPublicId: "STORAGE_SECRET", data: "RAW_SECRET", url: "PRIVATE_URL" };
  const appointments = [
    { _id: first, supportingDocuments: [ownFirst, ownSecond, foreign, missing, embedded] },
    { _id: second, supportingDocuments: [ownSecond, ownFirst] },
  ];
  const before = JSON.stringify(appointments);
  const rows = [
    { _id: ownFirst, appointment: first, originalName: "first.pdf", mimeType: "application/pdf", size: 10, createdAt: new Date("2026-01-01T00:00:00Z"), publicId: "STORAGE_SECRET", data: "RAW_SECRET" },
    { _id: ownSecond, appointment: second, originalName: "second.pdf", mimeType: "application/pdf", size: 20, resourceType: "PRIVATE_RESOURCE_TYPE" },
    { _id: foreign, appointment: other, originalName: "UNAUTHORIZED_NAME.pdf", url: "PRIVATE_URL" },
  ];
  const originalFind = SupportingDocument.find; let calls = 0, projection;
  SupportingDocument.find = query => {
    calls++;
    assert.deepEqual(query, { $or: [
      { appointment: first, _id: { $in: [ownFirst, ownSecond, foreign, missing] } },
      { appointment: second, _id: { $in: [ownSecond, ownFirst] } },
    ] });
    const chain = { select: value => { projection = value; return chain; }, lean: async () => rows }; return chain;
  };
  try {
    const result = await safeDocuments(appointments);
    assert.equal(calls, 1); assert.equal(projection, "appointment originalName mimeType size createdAt");
    assert.deepEqual(result[0].supportingDocuments.map(doc => doc.originalName), ["first.pdf", "embedded.pdf"]);
    assert.deepEqual(result[1].supportingDocuments.map(doc => doc.originalName), ["second.pdf"]);
    assert.equal(result[0].supportingDocuments[0].uploadedAt, rows[0].createdAt);
    for (const row of result) for (const doc of row.supportingDocuments) {
      assert.deepEqual(Object.keys(doc), ["_id", "originalName", "mimeType", "size", "uploadedAt"]);
    }
    assert.doesNotMatch(JSON.stringify(result), /UNAUTHORIZED_NAME|STORAGE_SECRET|RAW_SECRET|PRIVATE_URL|PRIVATE_RESOURCE_TYPE|cloudinaryPublicId|publicId|resourceType/);
    assert.equal(JSON.stringify(appointments), before);
  } finally { SupportingDocument.find = originalFind; }
});

test("missing legacy metadata is omitted and embedded-only appointments need no document lookup", async () => {
  const appointment = new mongoose.Types.ObjectId(), missing = new mongoose.Types.ObjectId();
  const originalFind = SupportingDocument.find; let calls = 0;
  SupportingDocument.find = () => { calls++; const chain = { select: () => chain, lean: async () => [] }; return chain; };
  try {
    const [deleted] = await safeDocuments([{ _id: appointment, supportingDocuments: [missing] }]);
    assert.deepEqual(deleted.supportingDocuments, []); assert.equal(calls, 1);
    const [embedded, legacyEmpty] = await safeDocuments([
      { _id: appointment, supportingDocuments: [{ _id: "embedded", originalName: "safe.pdf", publicId: "SECRET" }] },
      { _id: new mongoose.Types.ObjectId() },
    ]);
    assert.equal(calls, 1); assert.equal(embedded.supportingDocuments[0].originalName, "safe.pdf");
    assert.doesNotMatch(JSON.stringify(embedded), /SECRET|publicId/); assert.deepEqual(legacyEmpty.supportingDocuments, []);
    assert.deepEqual(await safeDocuments([]), []); assert.equal(calls, 1);
  } finally { SupportingDocument.find = originalFind; }
});
