import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import AccountImport from "../src/models/AccountImport.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import { createManualAccount } from "../src/services/manualAccountService.js";
import { assertProvisioningPrerequisites, assertImportPrerequisites, institutionalIndex } from "../src/services/accountImportMigrationService.js";
import { login } from "../src/controllers/authController.js";

const actor = new mongoose.Types.ObjectId().toString();
const input = (role = "student") => ({ institutional_id: " 000123 ", first_name: " Juan ",
  last_name: "Santos", official_email: ` JUAN@${role === "student" ? env.studentDomain : env.facultyDomain} `, role });
function harness() {
  const restore = [];
  const patch = (object, key, value) => { const original = object[key]; object[key] = value; restore.push(() => { object[key] = original; }); };
  const h = { users: [], audits: [], conflicts: [], finalConflicts: [], queries: [], hashes: 0,
    role: "dean", owner: actor, indexes: [{ key: { email: 1 }, unique: true }, { key: { username: 1 }, unique: true }, institutionalIndex],
    topology: { setName: "mock-only" }, ended: false, saves: 0 };
  const session = { async withTransaction(work, options) {
    assert.equal(options.readConcern.level, "snapshot"); assert.equal(options.writeConcern.w, "majority");
    const before = [h.users.slice(), h.audits.slice(), h.notifications.slice()];
    try {
      await work();
      if (h.retry) { [h.users, h.audits, h.notifications] = before.map((values) => values.slice()); await work(); }
      if (h.uncertain) throw { hasErrorLabel: (label) => label === "UnknownTransactionCommitResult" };
    } catch (error) { if (!h.uncertain) [h.users, h.audits, h.notifications] = before; throw error; }
  }, async endSession() { h.ended = true; } };
  patch(mongoose, "startSession", async () => { h.sessions = (h.sessions || 0) + 1; if (h.sessionFailure) throw new Error("private session detail"); return session; });
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command: async () => h.topology }) };
  restore.push(() => { mongoose.connection.db = originalDb; });
  patch(User.collection, "indexes", async () => h.indexes);
  patch(User.collection, "findOne", async () => h.anomaly || null);
  patch(AccountImport.collection, "indexes", async () => { h.importReads = (h.importReads || 0) + 1; return []; });
  patch(User, "find", (query) => {
    h.queries.push(query);
    let activeSession;
    return { select() { return this; }, session(value) { assert.equal(value, session); activeSession = value; return this; },
      async lean() { if (h.queryFailure) throw new Error("private query detail");
        return [...h.conflicts, ...(activeSession ? h.finalConflicts : []), ...h.users]
          .filter((user) => query.$or.some((part) => Object.entries(part).some(([field, { $in }]) => $in.includes(user[field])))); } };
  });
  patch(User.prototype, "save", async function (options) {
    assert.equal(options.session, session); assert.equal(this.isNew, true); assert.equal(this.validateSync(), undefined);
    h.saves++;
    if (h.saveFailure) throw new Error("private hash/ID detail");
    if (h.race) throw Object.assign(new Error("private index/value detail"), { code: 11000, keyPattern: h.race });
    this.createdAt = new Date("2026-10-13T00:00:00Z");
    h.users.push(this.toObject()); this.isNew = false; return this;
  });
  h.notifications = [];
  patch(Notification, "create", async (records, options) => {
    assert.equal(options.session, session);
    if (h.notificationFailure) throw new Error("private notification detail");
    h.notifications.push(...records); return records;
  });
  patch(Notification, "updateOne", async (filter, update) => {
    if (h.notificationFailure) throw new Error("private notification detail");
    if (!h.notifications.some(n => n.deduplicationKey === filter.deduplicationKey)) h.notifications.push(update.$setOnInsert);
    return { modifiedCount: 1 };
  });
  patch(AuditLog, "create", async (records, options) => {
    assert.equal(options.session, session);
    if (h.auditFailure) throw new Error("private audit detail");
    h.audits.push(...records); return records;
  });
  patch(User, "findById", async () => ({ id: h.owner, _id: h.owner, role: h.role,
    accountStatus: h.inactive ? "Inactive" : "Active", registrationStatus: "Approved" }));
  const hash = bcrypt.hash;
  patch(bcrypt, "hash", async (...args) => { h.hashes++; assert.equal(args[1], 12);
    if (h.hashFailure) throw new Error("private password detail"); return hash(...args); });
  const logs = [];
  for (const method of ["log", "warn", "error"]) patch(console, method, (...args) => logs.push(args));
  h.logs = logs; h.patch = patch; h.restore = () => restore.reverse().forEach((fn) => fn());
  return h;
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const safe = (value) => assert.doesNotMatch(JSON.stringify(value), /000123|institutionalId|studentId|employeeId|password|\$2[aby]\$|private|index/i);

test("Student and Faculty mapping, optional middle name, password safety, and immediate login", async () => {
  for (const role of ["student", "faculty"]) {
    const h = harness();
    try {
      const result = await createManualAccount(input(role), actor);
      assert.equal(result.statusCode, 201); assert.equal(h.users.length, 1); assert.equal(h.hashes, 1); assert.equal(h.audits.length, 1);
      const user = h.users[0];
      assert.equal(user.institutionalId, "000123"); assert.equal(user[role === "student" ? "studentId" : "employeeId"], "000123");
      assert.equal(user.middleName, ""); assert.equal(user.name, "Juan Santos"); assert.equal(user.email, user.username);
      assert.equal(user.email, `juan@${role === "student" ? env.studentDomain : env.facultyDomain}`);
      assert.equal(user.accountSource, "manual"); assert.equal(user.accountStatus, "Active"); assert.equal(user.registrationStatus, "Approved");
      assert.equal(String(user.createdBy), actor); assert.equal(user.program, undefined); assert.equal(user.position, undefined);
      assert.equal(user.approvedBy, undefined); assert.equal(user.approvedAt, undefined); assert.equal(user.approvalMethod, null);
      assert.equal(bcrypt.getRounds(user.password), 12); assert.ok(await bcrypt.compare("000123", user.password));
      safe(result); safe(h.logs); safe(h.audits);
      assert.doesNotMatch(JSON.stringify(h.audits), /Juan|Santos|@|email|name|institutional_id|body/i);
      assert.equal(String(h.audits[0].actorUser), actor); assert.equal(String(h.audits[0].subjectUser), String(user._id));
      assert.equal(h.importReads, undefined); assert.equal(h.ended, true);
      assert.deepEqual(Object.keys(result.body.user).sort(), ["id", "name", "email", "role", "accountStatus", "accountSource", "createdAt"].sort());
      h.patch(User, "findOne", () => ({ select() { return this; }, then(yes, no) { return Promise.resolve(new User(user)).then(yes, no); } }));
      // Login uses its existing generic audit, outside the provisioning transaction.
      h.patch(AuditLog, "create", async () => ({}));
      const res = response();
      await login({ params: { role }, body: { identifier: user.email, password: "000123" } }, res);
      assert.equal(res.statusCode, 200); assert.ok(res.body.token); assert.equal(res.body.user.role, role);
      assert.doesNotMatch(JSON.stringify(res.body), /password|\$2[aby]\$/i);
    } finally { h.restore(); }
  }
});

test("strict request allowlist rejects system fields, arbitrary types and role escalation", async () => {
  const h = harness();
  try {
    for (const key of ["password", "passwordHash", "accountStatus", "registrationStatus", "accountSource", "createdBy", "permissions", "approvedBy", "approvedAt", "approvalMethod", "customRole", "__proto__"])
      assert.equal((await createManualAccount(JSON.parse(JSON.stringify(input()).slice(0, -1) + `,"${key}":"override"}`), actor)).statusCode, 400, key);
    for (const body of [null, [], "x", { ...input(), institutional_id: 123 }, { ...input(), middle_name: null }, { ...input(), role: {} }])
      assert.equal((await createManualAccount(body, actor)).statusCode, 400);
    for (const role of ["dean", "admin", "program chair", "custom", ""])
      assert.equal((await createManualAccount({ ...input(), role }, actor)).body.errors.role !== undefined, true);
    assert.equal(h.hashes, 0); assert.equal(h.saves, 0);
  } finally { h.restore(); }
});

test("required fields, Unicode ID boundary, names, email format and role domains", async () => {
  const h = harness();
  try {
    for (const field of ["institutional_id", "first_name", "last_name", "official_email", "role"]) {
      const body = input(); delete body[field];
      const result = await createManualAccount(body, actor); assert.equal(result.statusCode, 422); assert.ok(result.body.errors[field]);
    }
    for (const [field, value] of [["first_name", "<script>"], ["middle_name", "A1"], ["last_name", "x".repeat(81)],
      ["official_email", "bad-email"], ["official_email", `x@${env.facultyDomain}`], ["institutional_id", "é".repeat(37)],
      ["institutional_id", "x".repeat(73)], ["institutional_id", "a\u0000b"]]) {
      const result = await createManualAccount({ ...input(), [field]: value }, actor);
      assert.equal(result.statusCode, 422, field); assert.ok(result.body.errors[field], field);
    }
    assert.equal((await createManualAccount({ ...input("faculty"), official_email: `x@${env.studentDomain}` }, actor)).statusCode, 422);
    assert.ok((await createManualAccount({ ...input(), first_name: "a".repeat(60), last_name: "b".repeat(60) }, actor)).body.errors.name);
    assert.equal(h.hashes, 0);
    const result = await createManualAccount({ ...input(), institutional_id: "é".repeat(36), middle_name: " Q. " }, actor);
    assert.equal(result.statusCode, 201); assert.equal(h.users[0].middleName, "Q.");
    assert.ok(await bcrypt.compare("é".repeat(36), h.users[0].password));
  } finally { h.restore(); }
});

test("conflicts check all canonical/legacy IDs across roles and both email fields inside transaction", async () => {
  for (const final of [false, true]) for (const field of ["institutionalId", "studentId", "employeeId", "email", "username"]) {
    const h = harness();
    try {
      h[final ? "finalConflicts" : "conflicts"] = [{ role: "faculty", [field]: ["email", "username"].includes(field) ? `juan@${env.studentDomain}` : "000123" }];
      const result = await createManualAccount(input(), actor);
      assert.equal(result.statusCode, 409); assert.ok(result.body.errors[["email", "username"].includes(field) ? "official_email" : "institutional_id"]);
      assert.equal(h.users.length, 0); assert.equal(h.audits.length, 0); assert.equal(h.notifications.length, 0); safe(result); safe(h.logs);
      assert.deepEqual(h.queries[0].$or.map((part) => Object.keys(part)[0]), ["studentId", "employeeId", "institutionalId", "email", "username"]);
    } finally { h.restore(); }
  }
});

test("duplicate-key races return safe field feedback even without recovery matches", async () => {
  for (const field of ["institutionalId", "studentId", "employeeId", "email", "username", "unknown"]) {
    const h = harness();
    try {
      h.race = { [field]: 1 };
      const result = await createManualAccount(input(), actor);
      assert.equal(result.statusCode, 409); assert.ok(result.body.errors[["email", "username"].includes(field) ? "official_email" : "institutional_id"]);
      safe(result); safe(h.logs); assert.equal(h.users.length, 0); assert.equal(h.audits.length, 0);
    } finally { h.restore(); }
  }
});

test("User/audit failures roll back; retries hash once; uncertain commits never claim success", async () => {
  for (const failure of ["notificationFailure", "saveFailure", "auditFailure", "hashFailure", "sessionFailure", "queryFailure"]) {
    const h = harness();
    try {
      h[failure] = true;
      const result = await createManualAccount(input(), actor);
      assert.equal(result.statusCode, 503); assert.equal(h.users.length, 0); assert.equal(h.audits.length, 0); safe(result); safe(h.logs);
      assert.equal(result.body.code, "SERVICE_UNAVAILABLE"); assert.doesNotMatch(result.body.message, /Refresh/);
    } finally { h.restore(); }
  }
  const h = harness();
  try {
    h.retry = true;
    assert.equal((await createManualAccount(input(), actor)).statusCode, 201);
    assert.equal(h.hashes, 1); assert.equal(h.saves, 2); assert.equal(h.users.length, 1); assert.equal(h.audits.length, 1);
    h.retry = false; h.users = []; h.audits = []; h.uncertain = true;
    const result = await createManualAccount(input(), actor);
    assert.equal(result.statusCode, 503); assert.equal(result.body.code, "ACCOUNT_CREATION_UNCERTAIN");
    assert.match(result.body.message, /Refresh the user list/); safe(result); safe(h.logs);
  } finally { h.restore(); }
});

test("missing provisioning setup returns a stable sanitized 503 before hashing, sessions or writes", async () => {
  for (const failure of ["institutionalId", "email", "username", "coverage", "topology"]) {
    const h = harness();
    try {
      if (failure === "coverage") h.anomaly = { _id: "private-record" };
      else if (failure === "topology") h.topology = {};
      else h.indexes = h.indexes.filter((index) => !index.key[failure]);
      await assert.rejects(assertProvisioningPrerequisites({ users: User.collection, db: mongoose.connection.db }),
        (error) => error.code === "PROVISIONING_SETUP_UNAVAILABLE");
      const result = await createManualAccount(input(), actor);
      assert.equal(result.statusCode, 503); assert.equal(result.body.code, "PROVISIONING_SETUP_UNAVAILABLE");
      assert.equal(result.body.message, "Account creation is temporarily unavailable until account provisioning setup is completed.");
      assert.equal(h.hashes, 0); assert.equal(h.sessions, undefined); assert.equal(h.saves, 0);
      assert.deepEqual(h.users, []); assert.deepEqual(h.audits, []); safe(result); safe(h.logs);
      assert.doesNotMatch(JSON.stringify(result.body), /stack|topology|connection|institutionalId_unique|Refresh/i);
    } finally { h.restore(); }
  }
});

test("provisioning prerequisites are independent of TTL; CSV retains its lifecycle prerequisites", async () => {
  const h = harness();
  try {
    await assertProvisioningPrerequisites({ users: User.collection, db: mongoose.connection.db });
    assert.equal(h.importReads, undefined);
    await assert.rejects(assertImportPrerequisites({ users: User.collection, imports: AccountImport.collection, db: mongoose.connection.db }));
    assert.equal(h.importReads, 1);
    for (const field of ["institutionalId", "email", "username"]) {
      const original = h.indexes; h.indexes = original.filter((index) => !index.key[field]);
      assert.equal((await createManualAccount(input(), actor)).statusCode, 503); h.indexes = original;
    }
    h.anomaly = { _id: "unmigrated" }; assert.equal((await createManualAccount(input(), actor)).statusCode, 503);
    h.anomaly = null; h.topology = {}; assert.equal((await createManualAccount(input(), actor)).statusCode, 503);
    assert.equal(h.saves, 0); assert.equal(h.hashes, 0);
  } finally { h.restore(); }
});

test("HTTP Dean authorization, creator provenance, no-store, malformed bodies and per-Dean limit", async () => {
  const h = harness();
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}/api/dean/users`;
  const call = async (body = input(), authenticated = true, raw = false, url = base) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Connection: "close",
      ...(authenticated && { Authorization: `Bearer ${jwt.sign({ sub: h.owner }, env.jwtSecret)}` }) }, body: raw ? body : JSON.stringify(body) });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  try {
    const anonymous = await call(input(), false); assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get("cache-control"), "no-store");
    for (const role of ["student", "faculty"]) { h.role = role; assert.equal((await call()).status, 403); }
    h.role = "dean"; h.inactive = true; assert.equal((await call()).status, 403); h.inactive = false;
    const malformed = await call('{"password":"PRIVATE_SECRET"', true, true);
    assert.equal(malformed.status, 400); assert.equal(malformed.headers.get("cache-control"), "no-store"); safe(malformed.body); safe(h.logs);
    const alternate = await call('{"password":"PRIVATE_SECRET"', true, true, base.replace("/api/dean/users", "/API/DEAN/USERS"));
    assert.equal(alternate.status, 400); safe(alternate.body); safe(h.logs);
    const success = await call(); assert.equal(success.status, 201); assert.equal(success.headers.get("cache-control"), "no-store");
    assert.equal(String(h.users[0].createdBy), actor); safe(success.body);
    assert.equal((await call({ ...input(), createdBy: new mongoose.Types.ObjectId().toString() })).status, 400);
    for (let n = 0; n < 8; n++) assert.equal((await call({ ...input(), institutional_id: "unused", official_email: "unused@example.test", role: "dean" })).status, 422);
    const limited = await call(); assert.equal(limited.status, 429); assert.equal(limited.headers.get("cache-control"), "no-store"); safe(limited.body);
    h.owner = new mongoose.Types.ObjectId().toString();
    assert.equal((await call({ ...input(), institutional_id: "000124", official_email: `other@${env.studentDomain}` })).status, 201);
    assert.equal(String(h.users[1].createdBy), h.owner);
  } finally { await new Promise((resolve) => server.close(resolve)); h.restore(); }
});


test("manual account notification commits once with the account and safe identity-free text", async () => {
  const h = harness();
  try {
    h.retry = true;
    assert.equal((await createManualAccount(input(), actor)).statusCode, 201);
    assert.equal(h.notifications.length, 1);
    const notification = h.notifications[0];
    assert.equal(notification.recipient, actor);
    assert.equal(notification.category, "Management");
    assert.equal(notification.actionUrl, `/dean/users?userId=${h.users[0]._id}`);
    safe(h.notifications);
  } finally { h.restore(); }
});
