import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { authenticate } from "../src/middleware/auth.js";
import Appointment from "../src/models/Appointment.js";
import AuditLog from "../src/models/AuditLog.js";
import Availability from "../src/models/Availability.js";
import OneTimeScheduleHold from "../src/models/OneTimeScheduleHold.js";
import User from "../src/models/User.js";
import { provisionedUser } from "../src/services/accountProvisioningService.js";
import { previewDeanTransfer, transferDeanPrivileges } from "../src/services/deanTransferService.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";

const query = value => {
  const result = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ["select", "limit", "session", "lean"]) result[method] = () => result;
  return result;
};
const deanId = "000000000000000000000001";
const facultyId = "000000000000000000000002";
const password = "FixturePassword1";
const now = new Date("2026-11-12T00:00:00.000Z");
const base = { name: "Fixture Person", accountStatus: "Active", registrationStatus: "Approved", updatedAt: now };
const hash = await bcrypt.hash(password, 4);
const dean = { ...base, _id: deanId, role: "dean", email: `dean@${env.facultyDomain}`, institutionalId: "FIX-001", employeeId: "FIX-001", password: hash };
const faculty = { ...base, _id: facultyId, role: "faculty", email: `faculty@${env.facultyDomain}`,
  username: `faculty@${env.facultyDomain}`, institutionalId: "FIX-002", employeeId: "FIX-002", password: hash };
const request = { successorId: facultyId, successorVersion: now.toISOString(), outgoingVersion: now.toISOString(),
  disposition: "Active", currentPassword: password, confirmation: "TRANSFER" };

test("successor previews verify approved access, official identity and actual credential readiness", async t => {
  let candidate = faculty;
  t.mock.method(User, "findOne", () => query(candidate));
  const review = async () => (await previewDeanTransfer(dean, facultyId)).body;
  assert.equal((await review()).successorIssue, null);
  assert.equal((await review()).canRemainFaculty, true);
  assert.equal(Object.hasOwn((await review()).successor, "password"), false);
  for (const changes of [{ role: "student" }, { role: "dean" }, { accountStatus: "Inactive" }, { registrationStatus: "Pending" }, { registrationStatus: "Rejected" }]) {
    candidate = { ...faculty, ...changes };
    assert.equal((await review()).successorIssue, "SUCCESSOR_INELIGIBLE");
  }
  for (const changes of [{ institutionalId: undefined, employeeId: undefined }, { email: "person@example.test" }, { username: undefined }, { emailVerified: false }]) {
    candidate = { ...faculty, ...changes };
    assert.equal((await review()).successorIssue, "SUCCESSOR_IDENTITY_REQUIRED");
  }
  const provisioned = await provisionedUser({ valid: true, role: "faculty", first_name: "Fixture", last_name: "Person",
    institutional_id: faculty.institutionalId, official_email: faculty.email }, { source: "manual", creator: deanId });
  candidate = { ...faculty, ...provisioned.toObject(), passwordChangedAt: now, passwordResetAt: now };
  assert.equal((await review()).successorIssue, "SUCCESSOR_PASSWORD_REQUIRED");
  candidate.password = "malformed";
  assert.equal((await review()).successorIssue, "SUCCESSOR_PASSWORD_REQUIRED");
  candidate.password = hash;
  assert.equal((await review()).successorIssue, null);
  candidate = null;
  assert.equal((await review()).code, "SUCCESSOR_INELIGIBLE");
  assert.equal((await previewDeanTransfer(dean, deanId)).body.code, "TRANSFER_INPUT_INVALID");
});

function transactionFixture(t, { current = dean, successor = faculty, failedWrite, open = false, auditFailure = false, commitFailure } = {}) {
  let active = false;
  const calls = { writes: [], audits: [], commits: 0, aborts: 0, ends: 0 };
  const session = {
    startTransaction(options) { active = true; assert.deepEqual(options, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 30000 }); },
    inTransaction: () => active,
    async commitTransaction() { calls.commits++; active = false; if (commitFailure) throw commitFailure; },
    async abortTransaction() { active = false; calls.aborts++; },
    async endSession() { calls.ends++; },
  };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(mongoose.connection, "collection", name => {
    assert.equal(name, "installationState");
    return { async updateOne(filter, changes, options) {
      assert.equal(options.session, session);
      assert.deepEqual(filter, { _id: "dean-initialized" });
      assert.deepEqual(changes, { $inc: { deanTransferRevision: 1 } });
      return { modifiedCount: 1 };
    } };
  });
  t.mock.method(User, "find", () => query([current]));
  t.mock.method(User, "findById", () => query(successor));
  t.mock.method(User, "updateOne", async (filter, change, options) => {
    calls.writes.push({ filter, change });
    assert.equal(options.session, session);
    return { modifiedCount: calls.writes.length === failedWrite ? 0 : 1 };
  });
  t.mock.method(Appointment, "exists", () => query(open));
  t.mock.method(Availability, "exists", () => query(false));
  t.mock.method(OneTimeScheduleHold, "exists", () => query(false));
  t.mock.method(AuditLog, "create", async ([record], options) => {
    assert.equal(options.session, session);
    await new AuditLog(record).validate();
    if (auditFailure) throw new Error("audit failure");
    calls.audits.push(record);
  });
  return calls;
}

test("transfer validates the exact request, verifies the current password and rechecks stale previews", async t => {
  const calls = transactionFixture(t);
  for (const changes of [{ role: "dean" }, { username: "unexpected" }, { successorId: deanId }, { confirmation: "transfer" }])
    assert.equal((await transferDeanPrivileges(dean, { ...request, ...changes })).body.code, "TRANSFER_INPUT_INVALID");
  assert.equal((await transferDeanPrivileges(dean, { ...request, currentPassword: "WrongFixture1" })).body.code, "TRANSFER_PASSWORD_INVALID");
  assert.equal((await transferDeanPrivileges(dean, { ...request, successorVersion: null })).body.code, "TRANSFER_CONFLICT");
  assert.equal((await transferDeanPrivileges(dean, { ...request, outgoingVersion: null })).body.code, "TRANSFER_CONFLICT");
  assert.deepEqual([calls.writes.length, calls.commits, calls.aborts, calls.ends], [0, 0, 3, 3]);
});

test("successful writes change only roles, status, versions and affected session revisions", async t => {
  const calls = transactionFixture(t);
  assert.equal((await transferDeanPrivileges(dean, request)).body.code, "TRANSFER_COMPLETED");
  assert.deepEqual(calls.writes.map(({ filter, change }) => {
    const { updatedAt, deanAccessRelinquishedAt, ...set } = change.$set;
    assert.ok(updatedAt > now);
    assert.equal(deanAccessRelinquishedAt instanceof Date, set.role === "faculty");
    return [filter._id, set];
  }), [[deanId, { role: "faculty", accountStatus: "Active", authRevision: 1 }],
    [facultyId, { role: "dean", accountStatus: "Active", authRevision: 1 }]]);
  assert.deepEqual(calls.audits[0].subjectUsers, [deanId, facultyId]);
  assert.equal(calls.audits[0].actorUser, deanId);
  assert.equal(calls.audits[0].metadata.outgoingAccountStatus, "Active");
  assert.deepEqual([calls.commits, calls.aborts, calls.ends], [1, 0, 1]);
});

for (const [name, options, disposition, code, expectedCommits] of [
  ["missing successor", { successor: null }, "Active", "TRANSFER_CONFLICT", 0],
  ["inactive successor", { successor: { ...faculty, accountStatus: "Inactive" } }, "Active", "SUCCESSOR_INELIGIBLE", 0],
  ["former Dean lacks Faculty identity", { current: { ...dean, email: undefined } }, "Active", "OUTGOING_FACULTY_INELIGIBLE", 0],
  ["unresolved consultations", { open: true }, "Inactive", "OUTGOING_CONSULTATIONS_OPEN", 0],
  ["conditional successor write fails", { failedWrite: 2 }, "Active", "TRANSFER_CONFLICT", 0],
  ["audit insertion fails", { auditFailure: true }, "Active", "TRANSFER_UNAVAILABLE", 0],
  ["commit outcome is unknown", { commitFailure: { hasErrorLabel: label => label === "UnknownTransactionCommitResult" } }, "Active", "TRANSFER_UNCERTAIN", 1],
  ["deactivating an eligible former Dean", {}, "Inactive", "TRANSFER_COMPLETED", 1],
]) test(name, async t => {
  const calls = transactionFixture(t, options);
  assert.equal((await transferDeanPrivileges(dean, { ...request, disposition })).body.code, code);
  assert.deepEqual([calls.commits, calls.aborts, calls.ends], [expectedCommits, 1 - expectedCommits, 1]);
  if (expectedCommits) assert.equal(calls.writes.length, 2);
});

test("transfer route rejects anonymous, Student, Faculty and inactive Dean callers", async () => {
  const http = await appointmentHttp();
  try {
    for (const [role, status] of [[null, 401], ["student", 403], ["faculty", 403], ["dean", 400]])
      assert.equal((await http.request("/dean/privilege-transfer", role, "POST", { role: "dean" })).status, status);
    http.users.dean.accountStatus = "Inactive";
    assert.equal((await http.request("/dean/privilege-transfer", "dean", "POST", request)).status, 403);
  } finally { await http.close(); }
});

test("authentication rejects stale and malformed revisions and preserves unaffected legacy tokens", async t => {
  let user = dean;
  t.mock.method(User, "findById", async () => user);
  const check = async claims => {
    const req = { headers: { authorization: `Bearer ${jwt.sign({ sub: deanId, ...claims }, env.jwtSecret)}` } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
    await authenticate(req, res, () => {});
    return res.statusCode;
  };
  assert.equal(await check({}), 200);
  assert.equal(await check({ authRevision: 0 }), 200);
  for (const authRevision of [-1, 0.1, "0", null]) assert.equal(await check({ authRevision }), 401);
  user = { ...dean, role: "faculty", accountStatus: "Inactive", authRevision: 1 };
  assert.equal(await check({}), 401);
  assert.equal(await check({ authRevision: 0 }), 401);
  assert.equal(await check({ authRevision: 1 }), 403);
  user = { ...faculty, role: "dean", authRevision: 1 };
  assert.equal(await check({}), 401);
  assert.equal(await check({ authRevision: 1 }), 200);
});
