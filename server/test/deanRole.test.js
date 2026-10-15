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
import Task from "../src/models/Task.js";
import Notification from "../src/models/Notification.js";
import { register, login, ensureDean } from "../src/controllers/authController.js";
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

test("public registration rejects Dean and cannot elevate Student or Faculty using body.role", async () => {
  let res = response();
  await register({ params: { role: "dean" }, body: {} }, res);
  assert.equal(res.statusCode, 404);
  const restores = [], created = [];
  patch(User, "findOne", async () => null, restores);
  patch(User, "create", async (data) => { created.push(data); return { ...data, id: "account" }; }, restores);
  patch(User, "findById", async () => null, restores);
  patch(User, "find", () => chain([]), restores);
  try {
    for (const role of ["student", "faculty"]) {
      res = response();
      await register({ params: { role }, body: {
        role: "dean", firstName: "Test", lastName: "Person", password: "TestingPassword1",
        email: role === "student" ? `test@${env.studentDomain}` : `test@${env.facultyDomain}`,
        studentId: "ST-1", employeeId: "FA-1", position: "Professor",
        program: "Bachelor of Science in Information Technology",
      } }, res);
      assert.equal(res.statusCode, 201);
      assert.equal(created.at(-1).role, role);
    }
  } finally { restores.reverse().forEach(fn => fn()); }
});

test("Dean login uses username and the stored role remains authoritative", async () => {
  const restores = [], queries = [];
  const password = "TestingPassword1";
  const user = { id: "account", name: "Dean", role: "dean", accountStatus: "Active", registrationStatus: "Approved", password: await bcrypt.hash(password, 4) };
  patch(User, "findOne", query => { queries.push(query); return chain(user); }, restores);
  patch(User, "findById", async () => null, restores);
  try {
    let res = response();
    await login({ params: { role: "dean" }, body: { username: "Management", password } }, res);
    assert.deepEqual(queries[0], { username: "management" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.role, "dean");
    assert.equal("password" in res.body.user, false);
    res = response();
    await login({ params: { role: "faculty" }, body: { email: "management", password } }, res);
    assert.equal(res.statusCode, 403);
  } finally { restores.reverse().forEach(fn => fn()); }
});

test("HTTP Dean management is read-only while personal Faculty actions remain owner-scoped", async () => {
  const h = await appointmentHttp();
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
  } finally { await h.close(); }
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
  assert.equal(harness.auditWrites[0][1][0].$set.metadata.$mergeObjects[1].legacyActorRole, "admin");
  assert.deepEqual(harness.auditWrites[0][0].$or, [{ actorUser: "same-id" }, { actor: "same-id" }]);
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

test("migration rerun completes metadata after an interrupted conversion", async () => {
  const harness = migrationHarness([{ _id: "a", username: "legacy", role: "admin" }]);
  const update = harness.auditLogs.updateMany;
  harness.auditLogs.updateMany = async () => { throw new Error("simulated interruption"); };
  await assert.rejects(migrateDeanAccount(harness), /simulated interruption/);
  harness.auditLogs.updateMany = update;
  assert.equal((await migrateDeanAccount(harness)).status, "already-dean");
  assert.equal(harness.auditWrites.length, 1);
  assert.equal(harness.writes.filter(([query]) => query._id).length, 1);
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
