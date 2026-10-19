import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, addSlot } from "./helpers/appointmentHarness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import Appointment from "../src/models/Appointment.js";
import Availability from "../src/models/Availability.js";
import StudentAvailability from "../src/models/StudentAvailability.js";
import Task from "../src/models/Task.js";
import Notification from "../src/models/Notification.js";
import { login, ensureDean } from "../src/controllers/authController.js";
import { migrateDeanAccount } from "../src/services/deanAccountMigrationService.js";

const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } });
const chain = (value) => {
  const result = { then: (yes, no) => Promise.resolve(value).then(yes, no) };
  for (const method of ["select", "populate", "sort", "skip", "limit", "lean"]) result[method] = () => result;
  return result;
};
function patch(object, key, value, restores) {
  const original = object[key]; object[key] = value; restores.push(() => { object[key] = original; });
}

test("User and audit validation recognize Dean and reject Admin as a current role", () => {
  assert.deepEqual(User.schema.path("role").enumValues, ["student", "faculty", "dean"]);
  assert.deepEqual(AuditLog.schema.path("actorRole").enumValues, ["student", "faculty", "dean", "system"]);
  assert.ok(AuditLog.schema.path("subjectRole").enumValues.includes("dean"));
});

test("Dean login uses username and the stored role remains authoritative", async () => {
  const restores = [], queries = [];
  const password = "TestingPassword1";
  const user = { id: "account", name: "Dean", role: "dean", accountStatus: "Active", registrationStatus: "Approved", password: await bcrypt.hash(password, 4) };
  patch(User, "findOne", query => { queries.push(query); return chain(user); }, restores);
  patch(User, "findById", async () => null, restores);
  patch(AuditLog, "create", async record => record, restores);
  try {
    let res = response();
    await login({ params: { role: "dean" }, body: { username: "Management", password } }, res);
    assert.deepEqual(queries[0], { username: "management" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.role, "dean");
    assert.equal("password" in res.body.user, false);
    res = response();
    await login({ params: { role: "faculty" }, body: { email: "management", password } }, res);
    assert.equal(res.statusCode, 401);
  } finally { restores.reverse().forEach(fn => fn()); }
});

test("HTTP Dean management is read-only while personal Faculty actions remain owner-scoped", async () => {
  const h = await appointmentHttp();
  const restores = [];
  patch(Appointment, "aggregate", () => ({ option: async () => [{ records: [], count: [{ total: 0 }] }] }), restores);
  patch(Appointment, "populate", async rows => rows, restores);
  const findDocumentAppointment = Appointment.findById;
  patch(Appointment, "findById", id => {
    const query = findDocumentAppointment(id);
    query.maxTimeMS = () => query;
    return query;
  }, restores);
  try {
    const record = fixture({ student: h.users.student.id, faculty: h.users.dean.id,
      supportingDocument: { name: "test.txt", data: "data:text/plain;base64,dGVzdA==",
        toObject: () => ({ name: "test.txt", data: "data:text/plain;base64,dGVzdA==" }) } });
    h.state.appointments.push(record); addSlot(h, record);
    for (const role of ["student", "faculty", "dean"]) {
      assert.equal((await h.request('/dean/appointments', role)).status, role === "dean" ? 200 : 403);
      assert.equal((await h.request('/dean/appointments/'+record._id+'/document', role)).status, role === "dean" ? 200 : 403);
      assert.equal((await h.request('/dean/appointments/'+record._id+'/documents/unknown', role, "DELETE", {})).status, 403);
    }
    assert.equal((await h.request('/appointments/'+record._id+'/status', "faculty", "PUT", { status: "Confirmed" })).status, 404);
    assert.equal((await h.request('/appointments/'+record._id+'/status', "dean", "PUT", { status: "Confirmed" })).status, 200);
    assert.equal((await h.request('/appointments/'+record._id+'/status', "dean", "PUT", { status: "Completed" })).status, 400);
    assert.equal(h.state.appointments[0].status, "Confirmed");
    assert.equal(h.state.audits.length, 1);
  } finally { restores.reverse().forEach(restore => restore()); await h.close(); }
});

test("Dean publishes without an optional link, Student books, and management never broadens personal ownership", async () => {
  const h = await appointmentHttp(), restores = [];
  patch(Availability, "create", async input => {
    const model = new Availability(input);
    await model.validate();
    h.state.slots.push({ ...model.toObject(), _id: model.id, id: model.id, faculty: String(model.faculty) });
    return model;
  }, restores);
  patch(StudentAvailability, "find", () => chain([]), restores);
  patch(Availability, "findOneAndDelete", async filter => {
    assert.equal(filter.faculty, h.users.dean.id, "deletion must bind the authenticated Dean");
    const index = h.state.slots.findIndex(slot => String(slot._id) === String(filter._id) && String(slot.faculty) === filter.faculty);
    return index < 0 ? null : h.state.slots.splice(index, 1)[0];
  }, restores);
  patch(Appointment, "aggregate", pipeline => {
    if (pipeline.some(stage => stage.$group)) {
      assert.equal(String(pipeline[0].$match.faculty), h.users.dean.id);
      return Promise.resolve([]);
    }
    return { option: async () => [{ records: h.state.appointments, count: [{ total: h.state.appointments.length }] }] };
  }, restores);
  patch(Appointment, "populate", async rows => rows, restores);
  try {
    const foreign = fixture({ student: h.users.student.id, faculty: h.users.faculty.id });
    h.state.appointments.push(foreign); addSlot(h, foreign);
    const body = { startAt: "2099-02-01T02:00:00Z", endAt: "2099-02-01T02:30:00Z",
      mode: "Online", meetingPlatform: "Teams", faculty: h.users.faculty.id, owner: h.users.faculty.id,
      facultyId: h.users.faculty.id, isActive: false };
    const created = await h.request("/availability", "dean", "POST", body);
    assert.equal(created.status, 201);
    const slot = (await created.json()).availability;
    assert.equal(slot.faculty, h.users.dean.id);
    assert.equal(slot.meetingLink, "");
    assert.equal(slot.isActive, true);
    const discovered = await h.request(`/availability/faculty/${h.users.dean.id}`, "student");
    assert.equal(discovered.status, 200);
    assert.deepEqual((await discovered.json()).schedules.map(row => row._id), [slot._id]);
    const booked = await h.request("/appointments", "student", "POST", {
      availabilityId: slot._id, subject: "Dean consultation", reason: "Discuss project",
      faculty: h.users.faculty.id, owner: h.users.otherStudent.id, student: h.users.otherStudent.id,
    });
    assert.equal(booked.status, 201);
    const consultation = (await booked.json()).appointment;
    assert.equal(consultation.faculty, h.users.dean.id);
    assert.equal(consultation.student, h.users.student.id);
    assert.equal((await h.request(`/appointments/${consultation._id}/status`, "dean", "PUT", { status: "Confirmed" })).status, 200);

    // The same authenticated Dean may use management, but personal APIs stay bound to that identity.
    const management = await h.request("/dean/appointments", "dean");
    assert.equal(management.status, 200);
    assert.deepEqual((await management.json()).consultations.map(row => row.recordId).sort(), [foreign._id, consultation._id].sort());
    const forged = `faculty=${h.users.faculty.id}&facultyId=${h.users.faculty.id}&owner=${h.users.faculty.id}`;
    const personal = await h.request(`/appointments/mine?${forged}`, "dean");
    assert.equal(personal.status, 200);
    assert.deepEqual((await personal.json()).appointments.map(row => row._id), [consultation._id]);
    const mine = await h.request(`/availability/mine?${forged}`, "dean");
    assert.equal(mine.status, 200);
    assert.deepEqual((await mine.json()).availability.map(row => row._id), [slot._id]);
    const requestSchedules = await h.request(`/availability/request-schedules?${forged}`, "dean");
    assert.equal(requestSchedules.status, 200);
    assert.deepEqual((await requestSchedules.json()).schedules.map(row => row._id), [slot._id]);
    const redirectedOwner = await h.request(`/availability/faculty/${h.users.faculty.id}?${forged}`, "dean");
    assert.equal(redirectedOwner.status, 200);
    assert.deepEqual((await redirectedOwner.json()).schedules.map(row => row._id), [slot._id]);
    const calendar = await h.request(`/faculty/calendar?start=2099-02-01&end=2099-02-01&${forged}`, "dean");
    assert.equal(calendar.status, 200);
    assert.deepEqual((await calendar.json()).events.map(row => row.id), [consultation._id]);
    for (const [path, method, payload] of [
      [`/availability/${foreign.availability}/details`, "GET"],
      [`/availability/${foreign.availability}`, "PUT", body],
      [`/availability/${foreign.availability}`, "DELETE", {}],
      [`/appointments/${foreign._id}/status`, "PUT", { status: "Confirmed", faculty: h.users.dean.id }],
    ]) assert.equal((await h.request(path, "dean", method, payload)).status, 404, path);
    assert.equal(h.state.appointments.find(row => row._id === foreign._id).status, "Pending");
    assert.equal(h.state.slots.find(row => String(row._id) === String(foreign.availability)).faculty, h.users.faculty.id);
  } finally { restores.reverse().forEach(restore => restore()); await h.close(); }
});

function migrationHarness(accounts) {
  const writes = [], auditWrites = [];
  const users = {
    findOne: async query => accounts.find(a => a.username === query.username),
    find: () => ({ toArray: async () => accounts.filter(a => ["admin", "dean"].includes(a.role)) }),
    updateOne: async (query, update) => { writes.push([query, update]); const account = accounts.find(a => a._id === query._id && a.role === query.role); if (account) Object.assign(account, update.$set); return { modifiedCount: account ? 1 : 0 }; },
    updateMany: async (query, update) => { writes.push([query, update]); for (const account of accounts) if (account.approvalMethod === query.approvalMethod) Object.assign(account, update.$set); },
  };
  const auditLogs = { updateMany: async (...args) => auditWrites.push(args) };
  return { users, auditLogs, writes, auditWrites, username: "legacy" };
}

test("migration preserves account identity and password, metadata provenance, and reruns safely", async () => {
  const legacy = { _id: "same-id", username: "legacy", role: "admin", password: "opaque-test-hash", approvedBy: "same-reference" };
  const accounts = [legacy, { _id: "student-id", username: "student", role: "student", approvalMethod: "admin" }];
  const harness = migrationHarness(accounts);
  assert.equal((await migrateDeanAccount(harness)).status, "converted");
  assert.deepEqual(legacy, { _id: "same-id", username: "legacy", role: "dean", password: "opaque-test-hash", approvedBy: "same-reference" });
  assert.equal(accounts[1].approvalMethod, "dean");
  assert.equal(harness.auditWrites.length, 0);
  assert.equal((await migrateDeanAccount(harness)).status, "already-dean");
  assert.equal(harness.writes.filter(([q]) => q._id).length, 1);
});

test("migration conflicts and wrong identifiers stop before any writes; missing account is not created", async () => {
  for (const accounts of [
    [{ _id: "a", username: "legacy", role: "admin" }, { _id: "b", username: "other", role: "dean" }],
    [{ _id: "a", username: "legacy", role: "admin" }, { _id: "b", username: "other", role: "admin" }],
    [{ _id: "a", username: "legacy", role: "student" }],
    [{ _id: "a", username: "other", role: "dean" }],
  ]) {
    const harness = migrationHarness(accounts);
    await assert.rejects(migrateDeanAccount(harness), /conflict|another role/);
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.auditWrites.length, 0);
  }
  const harness = migrationHarness([]);
  assert.equal((await migrateDeanAccount(harness)).status, "missing");
  assert.equal(harness.writes.length, 0);
});

test("migration never touches audit history, including on reruns", async () => {
  const harness = migrationHarness([{ _id: "a", username: "legacy", role: "admin" }]);
  harness.auditLogs.updateMany = async () => assert.fail("Historical audit mutation");
  assert.equal((await migrateDeanAccount(harness)).status, "converted");
  assert.equal((await migrateDeanAccount(harness)).status, "already-dean");
  assert.equal(harness.auditWrites.length, 0);
});

test("initialization verifies the existing Dean without creating a duplicate", async () => {
  const restores = [];
  const harness = migrationHarness([{ _id: "a", username: env.deanUsername, role: "dean" }]);
  patch(User.collection, "findOne", harness.users.findOne, restores);
  patch(User.collection, "find", harness.users.find, restores);
  patch(User.collection, "updateMany", harness.users.updateMany, restores);
  patch(AuditLog.collection, "updateMany", harness.auditLogs.updateMany, restores);
  patch(User, "create", async () => assert.fail("existing Dean must not be duplicated"), restores);
  try { await ensureDean(); } finally { restores.reverse().forEach(fn => fn()); }
});

test("preferred Dean environment variables override independent legacy fallbacks", async () => {
  const keys = ["DEAN_USERNAME", "DEAN_PASSWORD", "ADMIN_USERNAME", "ADMIN_PASSWORD"];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.ADMIN_USERNAME = "Legacy"; process.env.ADMIN_PASSWORD = "legacy-test-value";
    delete process.env.DEAN_USERNAME; delete process.env.DEAN_PASSWORD;
    const legacy = await import("../src/config/env.js?core01-legacy");
    assert.equal(legacy.env.deanUsername, "legacy");
    assert.equal(legacy.env.deanPassword, "legacy-test-value");
    process.env.DEAN_USERNAME = "Preferred"; process.env.DEAN_PASSWORD = "preferred-test-value";
    const preferred = await import("../src/config/env.js?core01-preferred");
    assert.equal(preferred.env.deanUsername, "preferred");
    assert.equal(preferred.env.deanPassword, "preferred-test-value");
  } finally { for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } }
});
