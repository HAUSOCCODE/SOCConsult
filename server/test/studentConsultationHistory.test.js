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
  STUDENT_HISTORY_STATUSES,
  manilaHistoryBoundary,
  safeStudentHistoryRecord,
  studentHistoryQuery,
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
