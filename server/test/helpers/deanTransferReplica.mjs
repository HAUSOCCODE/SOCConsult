import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyConsultationWorkflow } from "./consultationWorkflowReplica.mjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const run = promisify(execFile);
const password = "PersonalFixture42";

export async function verifyDeanTransfer({ database, uri, serverRoot, coldStart, deanId, deanPassword }) {
  const { env } = await import("../../src/config/env.js");
  const { default: app } = await import("../../src/app.js");
  const { default: User } = await import("../../src/models/User.js");
  const { default: AuditLog } = await import("../../src/models/AuditLog.js");
  const { default: AccountImport } = await import("../../src/models/AccountImport.js");
  const { migrateAccountImport, assertProvisioningPrerequisites } = await import("../../src/services/accountImportMigrationService.js");
  const { transferDeanPrivileges } = await import("../../src/services/deanTransferService.js");
  const users = database.collection("users");
  const installation = database.collection("installationState");
  const audits = database.collection("auditlogs");
  const appointments = database.collection("appointments");
  const before = await users.findOne({ _id: deanId });
  const tokenFor = id => jwt.sign({ sub: String(id) }, env.jwtSecret, { expiresIn: "8h" });
  const studentId = new mongoose.Types.ObjectId();
  await users.insertOne({ _id: studentId, name: "Student Fixture", role: "student", studentId: "FIX-STUDENT", institutionalId: "FIX-STUDENT", accountStatus: "Active" });
  await users.updateOne({ username: "reserved.fixture" }, { $set: { employeeId: "FIX-RESERVED", institutionalId: "FIX-RESERVED" } });
  await Promise.all([User.init(), AccountImport.init()]);
  assert.ok((await migrateAccountImport({ users, imports: database.collection("accountimports"), apply: true })).applied);

  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const request = async (path, { token, method = "GET", body } = {}) => {
    const headers = { ...(token && { Authorization: `Bearer ${token}` }), Connection: "close" };
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers, body: body instanceof FormData ? body : JSON.stringify(body),
    });
    const contentType = response.headers.get("content-type");
    return { status: response.status, contentType, body: contentType?.includes("application/pdf")
      ? Buffer.from(await response.arrayBuffer()) : await response.json() };
  };
  const signIn = (role, identifier, secret) => request(`/auth/login/${role}`, { method: "POST", body: { identifier, password: secret } });
  const preview = (token, id) => request(`/dean/privilege-transfer/successors/${id}`, { token });
  const payload = (preview, disposition, currentPassword) => ({
    successorId: preview.successor._id, successorVersion: preview.successor.version, outgoingVersion: preview.outgoingVersion,
    disposition, currentPassword, confirmation: "TRANSFER",
  });
  const marker = () => installation.findOne({ _id: "dean-initialized" });
  const transferAudits = () => audits.find({ action: "dean_privilege_transferred" }).sort({ createdAt: 1 }).toArray();
  const provision = (number, token) => request("/dean/users", { token, method: "POST", body: {
    role: "faculty", institutional_id: `FIX-${number}`, official_email: `fixture-${number}@${env.facultyDomain}`,
    first_name: "Faculty", last_name: "Fixture",
  } });
  const now = new Date();
  const end = new Date(+now + 3600000);
  try {
    const deanLogin = await signIn("dean", before.username, deanPassword);
    assert.equal(deanLogin.status, 200);
    const originalToken = deanLogin.body.token;
    const workflow = await verifyConsultationWorkflow({ database, request, signIn, deanToken: originalToken, env });
    const candidates = [];
    for (const number of [1, 2]) {
      let candidate = workflow.faculty;
      if (number === 2) {
        const created = await provision(number, originalToken);
        assert.equal(created.status, 201, JSON.stringify(created.body));
        candidate = created.body.user;
      }
      const { id, email } = candidate;
      assert.equal((await preview(originalToken, id)).body.successorIssue, "SUCCESSOR_PASSWORD_REQUIRED");
      const initialLogin = await signIn("faculty", email, `FIX-${number}`);
      assert.equal(initialLogin.status, 200);
      const changed = await request("/auth/change-password", { token: initialLogin.body.token, method: "PUT",
        body: { currentPassword: `FIX-${number}`, newPassword: password, confirmNewPassword: password } });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      assert.equal((await signIn("faculty", email, `FIX-${number}`)).status, 401);
      const account = await users.findOne({ _id: new mongoose.Types.ObjectId(id) });
      const appointment = await appointments.insertOne({ faculty: account._id, student: studentId, status: "Confirmed",
        startAt: now, endAt: end, attendance: { studentResponded: true },
        supportingDocuments: [{ storageKey: `fixture-${number}`, uploadedBy: studentId }] });
      const slot = await database.collection("availabilities").insertOne({ faculty: account._id, startAt: now, endAt: end, isActive: true });
      const record = await database.collection("consultationrecords").insertOne({ appointment: appointment.insertedId, facultyAuthor: account._id });
      candidates.push({ account, token: initialLogin.body.token, appointment: appointment.insertedId, slot: slot.insertedId, record: record.insertedId });
    }

    const firstPreview = (await preview(originalToken, candidates[0].account._id)).body;
    assert.equal(firstPreview.successorIssue, null);
    assert.equal(firstPreview.canRemainFaculty, false);
    const inactive = payload(firstPreview, "Inactive", deanPassword);
    const outgoing = await User.findById(deanId);
    const open = await appointments.insertOne({ faculty: deanId, student: studentId, status: "Pending" });
    const blocked = await request("/dean/privilege-transfer", { token: originalToken, body: inactive, method: "POST" });
    assert.equal(blocked.body.code, "OUTGOING_CONSULTATIONS_OPEN");
    assert.equal((await appointments.findOne({ _id: open.insertedId })).status, "Pending");
    await appointments.deleteOne({ _id: open.insertedId }); // Retire the synthetic blocker fixture.

    const originalUpdate = User.updateOne;
    User.updateOne = function (filter, ...args) {
      return filter.role === "faculty" ? Promise.resolve({ modifiedCount: 0 }) : originalUpdate.call(this, filter, ...args);
    };
    try { assert.equal((await transferDeanPrivileges(outgoing, inactive)).body.code, "TRANSFER_CONFLICT"); }
    finally { User.updateOne = originalUpdate; }
    const originalAudit = AuditLog.create;
    AuditLog.create = async () => { throw new Error("Injected fixture failure"); };
    try { assert.equal((await transferDeanPrivileges(outgoing, inactive)).body.code, "TRANSFER_UNAVAILABLE"); }
    finally { AuditLog.create = originalAudit; }
    assert.equal((await users.findOne({ _id: deanId })).role, "dean");
    assert.equal((await users.findOne({ _id: candidates[0].account._id })).role, "faculty");
    assert.equal((await marker()).deanTransferRevision, undefined);
    assert.equal((await transferAudits()).length, 0);

    const secondPreview = (await preview(originalToken, candidates[1].account._id)).body;
    // Competing processes use separate MongoDB clients and the same stored marker.
    const compete = input => run(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { setTimeout as delay } from 'node:timers/promises';
      import mongoose from 'mongoose';
      import User from './src/models/User.js';
      import { transferDeanPrivileges } from './src/services/deanTransferService.js';
      const [id, input] = process.argv.slice(1);
      await mongoose.connect(process.env.MONGODB_URI);
      const actor = await User.findOne({ _id: id, role: 'dean' });
      assert.ok(actor);
      const payload = JSON.parse(input);
      const barrier = mongoose.connection.collection('pei06TransferContenders');
      await barrier.insertOne({ _id: payload.successorId });
      for (let attempt = 0; attempt < 200 && await barrier.countDocuments() < 2; attempt++) await delay(25);
      assert.equal(await barrier.countDocuments(), 2);
      const result = await transferDeanPrivileges(actor, payload);
      console.log(result.body.code);
      await mongoose.disconnect();
    `, String(deanId), JSON.stringify(input)], {
      cwd: serverRoot, timeout: 45000, windowsHide: true,
      env: { ...process.env, NODE_ENV: "test", MONGODB_URI: uri },
    });
    const competitors = await Promise.all([compete(inactive), compete(payload(secondPreview, "Inactive", deanPassword))]);
    assert.deepEqual(competitors.map(result => result.stdout.trim()).sort(), ["TRANSFER_COMPLETED", "TRANSFER_CONFLICT"]);
    const firstDean = await users.findOne({ role: "dean" });
    const winner = candidates.find(entry => entry.account._id.equals(firstDean._id));
    const other = candidates.find(entry => entry !== winner);
    assert.equal(await users.countDocuments({ role: "dean" }), 1);
    assert.equal((await marker()).deanTransferRevision, 1);
    assert.equal((await transferAudits()).length, 1);
    const archived = await users.findOne({ _id: deanId });
    assert.deepEqual([archived.role, archived.accountStatus, archived.authRevision, archived.password], ["faculty", "Inactive", 1, before.password]);
    assert.ok(archived.deanAccessRelinquishedAt instanceof Date);
    assert.equal((await request("/dean/privilege-transfer", { token: originalToken, body: inactive, method: "POST" })).status, 401);
    assert.equal((await request("/auth/me", { token: winner.token })).status, 401);
    assert.equal((await preview(winner.token, other.account._id)).status, 401);
    assert.equal((await request("/auth/me", { token: tokenFor(studentId) })).status, 200);
    assert.equal((await request("/auth/me", { token: workflow.studentToken })).status, 200);
    assert.equal((await request("/auth/me", { token: other.token })).status, 200);
    assert.equal((await signIn("dean", before.username, deanPassword)).status, 401);
    assert.equal((await signIn("faculty", firstDean.email, password)).status, 401);
    await assertProvisioningPrerequisites({ users, db: database });

    const newLogin = await signIn("dean", firstDean.username, password);
    assert.equal(newLogin.status, 200);
    const newToken = newLogin.body.token;
    assert.equal(jwt.decode(newToken).authRevision, 1);
    assert.equal(newLogin.body.user.id, String(firstDean._id));
    if (String(firstDean._id) === workflow.faculty.id) await workflow.verifyReport(newToken);
    assert.equal((await provision(3, newToken)).status, 201);
    const activation = await request(`/dean/users/${deanId}/status`, { token: newToken, method: "PATCH", body: {
      accountStatus: "Active", expectedStatus: "Inactive", version: archived.updatedAt.toISOString(),
    } });
    assert.equal(activation.body.code, "FACULTY_IDENTITY_REQUIRED");

    const next = (await preview(newToken, other.account._id)).body;
    assert.equal(next.canRemainFaculty, true);
    const active = payload(next, "Active", password);
    assert.equal((await request("/dean/privilege-transfer", { token: newToken, body: active, method: "POST" })).body.code, "TRANSFER_COMPLETED");
    assert.equal((await request("/auth/me", { token: newToken })).status, 401);
    assert.equal((await request("/auth/me", { token: other.token })).status, 401);
    assert.equal(await users.countDocuments({ role: "dean" }), 1);
    assert.equal((await marker()).deanTransferRevision, 2);
    const history = await transferAudits();
    assert.deepEqual(history.map(row => [String(row.actorUser), String(row.relatedEntityId), row.metadata.outgoingAccountStatus]),
      [[String(deanId), String(winner.account._id), "Inactive"], [String(winner.account._id), String(other.account._id), "Active"]]);
    const former = await signIn("faculty", winner.account.email, password);
    assert.equal(former.status, 200);
    assert.equal((await signIn("dean", winner.account.username, password)).status, 401);
    assert.equal((await preview(former.body.token, other.account._id)).status, 403);
    await coldStart("stale.transfer", "StaleFixture90");
    const fresh = await signIn("dean", other.account.username, password);
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.user.id, String(other.account._id));
    for (const [entry, token] of [[winner, former.body.token], [other, fresh.body.token]]) {
      const current = await users.findOne({ _id: entry.account._id });
      for (const key of ["_id", "email", "username", "institutionalId", "employeeId", "password"])
        assert.deepEqual(current[key], entry.account[key]);
      const record = await appointments.findOne({ _id: entry.appointment });
      assert.deepEqual([record.faculty, record.student, record.status, record.attendance.studentResponded, record.supportingDocuments[0].uploadedBy],
        [entry.account._id, studentId, "Confirmed", true, studentId]);
      assert.deepEqual((await database.collection("consultationrecords").findOne({ _id: entry.record })).facultyAuthor, entry.account._id);
      const personal = await request("/availability/mine", { token });
      assert.equal(personal.status, 200);
      const workflowOwner = String(entry.account._id) === workflow.faculty.id;
      const ownedSlots = [String(entry.slot), ...(workflowOwner ? workflow.slotIds : [])];
      assert.deepEqual(personal.body.availability.map(slot => slot._id).sort(), ownedSlots.sort());
      const history = await request("/appointments/faculty-history?status=Completed", { token });
      assert.equal(history.status, 200);
      assert.deepEqual(history.body.consultations.map(row => row._id), workflowOwner ? [workflow.completedId] : []);
    }
    assert.equal(await appointments.countDocuments({ _id: { $in: candidates.map(entry => entry.appointment) } }), 2);
    if (String(other.account._id) === workflow.faculty.id) await workflow.verifyReport(fresh.body.token);
    assert.equal((await marker()).deanTransferRevision, 2);
    assert.equal((await transferAudits()).length, 2);
    console.log("PASS: real Dean transfer, rollback, competing processes, provisioning, sign-in and JWT revocation, restart, and record ownership.");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
