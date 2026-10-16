import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import AuditLog from "../src/models/AuditLog.js";
import User from "../src/models/User.js";
import AccountImport from "../src/models/AccountImport.js";
import Appointment from "../src/models/Appointment.js";
import ReportNarrative from "../src/models/ReportNarrative.js";
import Notification from "../src/models/Notification.js";
import { AUDIT_ACTIONS, safeMetadata, validateAudit } from "../src/services/auditPolicy.js";
import { auditControllerInternals, getManagementAuditLogs, exportAuditLogs, getAuditUserLogs } from "../src/controllers/auditController.js";
import { validateAccountImport } from "../src/controllers/accountImportController.js";
import { login, logout } from "../src/controllers/authController.js";
import { createNarrative } from "../src/services/reportNarrativeService.js";

const restores = [];
const patch = (object, key, value) => { const old = object[key]; object[key] = value; restores.push(() => object[key] = old); };
afterEach(() => { while (restores.length) restores.pop()(); });
const id = new mongoose.Types.ObjectId();
const actor = { _id: id, id: String(id), role: "dean", accountStatus: "Active" };
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
const chain = value => ({ select() { return this; }, session() { return this; }, option() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, maxTimeMS() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const event = (action = "login", metadata = {}) => ({ actorUser: id, actorRole: "dean", subjectUser: id, subjectRole: "dean", action, category: "Authentication", relatedEntityType: "User", relatedEntityId: id, metadata });

test("every action rejects prohibited fields and wrong values at storage boundary", async () => {
  const prohibited = ["password", "initialPassword", "institutionalId", "passwordHash", "token", "cookie", "authorization", "apiKey", "body", "file", "document", "reason", "prompt", "exception", "facultyName", "studentName", "topic"];
  for (const action of AUDIT_ACTIONS) {
    await new AuditLog(event(action)).validate();
    for (const key of prohibited) {
      const record = event(action, { [key]: "PRIVATE" });
      assert.deepEqual(safeMetadata(action, record.metadata), {});
      await assert.rejects(new AuditLog(record).validate(), /Unsafe audit metadata/);
    }
  }
  for (const metadata of [{ role: "PRIVATE" }, { role: { token: "PRIVATE" } }, { role: ["dean"] }]) await assert.rejects(new AuditLog(event("login", metadata)).validate());
  for (const metadata of [{ totalRows: -1 }, { totalRows: "10" }, { totalRows: 100001 }, { totalRows: { token: "PRIVATE" } }]) await assert.rejects(new AuditLog(event("accounts_csv_validated", metadata)).validate());
  for (const changes of [{ before: { password: "PRIVATE" } }, { after: { status: "PRIVATE" } }]) await assert.rejects(new AuditLog({ ...event(), changes }).validate());
  await assert.rejects(new AuditLog({ ...event(), details: { reason: "PRIVATE" } }).validate());
  const failure = new AuditLog({ action: "login_failed", category: "Authentication", actorRole: "system", metadata: { role: "dean" } });
  await failure.validate();
  assert.equal(failure.actorUser, undefined);
  assert.equal(failure.relatedEntityId, undefined);
});

test("model permits insertion and blocks all document, query and bulk mutations without database access", async () => {
  const record = new AuditLog(event());
  await record.validate();
  assert.equal(record.isNew, true);
  record.isNew = false;
  await assert.rejects(record.save(), /immutable/);
  await assert.rejects(record.deleteOne(), /immutable/);
  for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"]) await assert.rejects(AuditLog[operation]({}, {}), /immutable/);
  await assert.rejects(AuditLog.bulkWrite([{ deleteOne: { filter: {} } }]), /immutable/);
  await assert.rejects(AuditLog.insertMany([{ ...event(), metadata: { token: "PRIVATE" } }]), /Unsafe/);
  assert.ok(AuditLog.schema.indexes().some(([fields]) => fields.createdAt === -1 && fields._id === -1));
  assert.ok(AuditLog.schema.indexes().every(([, options]) => options.expireAfterSeconds === undefined));
});

test("legacy projection excludes private strings in every field and interprets admin without rewriting", () => {
  const legacy = { ...event("account_deactivated"), _id: id, actorRole: "admin", actorUser: { _id: id, name: "PRIVATE name" }, description: "PRIVATE exception", changes: { before: { password: "PRIVATE" }, after: { status: "PRIVATE" } }, metadata: { reason: "PRIVATE", topic: "PRIVATE", facultyName: "PRIVATE", role: "PRIVATE" }, createdAt: new Date() };
  const before = JSON.stringify(legacy);
  const projected = auditControllerInternals.publicLog(legacy);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|password|reason|topic|facultyName/);
  assert.equal(projected.actor.role, "dean");
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(auditControllerInternals.publicLog({ ...legacy, action: "PRIVATE", relatedEntityType: "PRIVATE" }).action, "legacy_activity");
});

test("legacy user history and CSV export use the same safe projection without dropping the protected routes", async () => {
  const legacy = { ...event("account_deactivated"), _id: id, actorRole: "admin", description: "PRIVATE exception", metadata: { reason: "PRIVATE" }, changes: { before: { password: "PRIVATE" }, after: { status: "Inactive" } }, createdAt: new Date() };
  const projections = [];
  patch(User, "findOne", () => chain({ _id: id, role: "student", name: "Registered user" }));
  patch(AuditLog, "find", () => { const result = chain([legacy]); result.select = value => { projections.push(value); return result; }; return result; });
  patch(AuditLog, "countDocuments", () => chain(1));
  patch(AuditLog, "findOne", () => chain({ createdAt: legacy.createdAt }));
  const history = response(); await getAuditUserLogs({ params: { userId: String(id) }, query: {} }, history);
  assert.equal(history.body.logs.length, 1); assert.doesNotMatch(JSON.stringify(history.body), /PRIVATE|password|reason/);
  const csv = { ...response(), set() {}, send(value) { this.csv = value; } };
  await exportAuditLogs({ query: { userId: String(id) } }, csv);
  assert.match(csv.csv, /Account deactivated/); assert.match(csv.csv, new RegExp(String(id))); assert.doesNotMatch(csv.csv, /PRIVATE|password|reason/);
  for (const projection of projections) assert.doesNotMatch(projection, /description|metadata\.reason|details\.reason|password/);
});

test("actual model creation and insertMany acknowledge safe writes while rejecting validation bypasses", async () => {
  const inserted = [];
  patch(AuditLog.collection, "insertOne", async value => { inserted.push(value); return { acknowledged: true, insertedId: value._id }; });
  patch(AuditLog.collection, "insertMany", async values => { inserted.push(...values); return { acknowledged: true, insertedIds: values.map(value => value._id) }; });
  const record = await AuditLog.create({ ...event(), description: "PRIVATE supplied description" });
  assert.equal(record.isNew, false); assert.equal(inserted.length, 1); assert.doesNotMatch(inserted[0].description, /PRIVATE/);
  await AuditLog.insertMany([event()]); assert.equal(inserted.length, 2);
  await assert.rejects(AuditLog.insertMany([{ ...event(), rawBody: "PRIVATE" }]), /strict|Field/i);
  await assert.rejects(AuditLog.insertMany([event()], { lean: true }), /Unvalidated/);
  assert.equal(inserted.length, 2);
});

test("management feed validates filters, pagination, date span, projection and stable sort", async () => {
  const calls = [];
  patch(AuditLog, "find", query => { calls.push(["query", query]); const result = chain([{ ...event(), _id: id, description: "PRIVATE", createdAt: new Date() }]); for (const method of ["select", "sort", "skip", "limit", "maxTimeMS"]) result[method] = value => { calls.push([method, value]); return result; }; return result; });
  patch(AuditLog, "countDocuments", () => chain(21));
  for (const query of [{ page: "0" }, { page: "1.5" }, { limit: "101" }, { startDate: "2026-02-30" }, { startDate: "2020-01-01", endDate: "2026-01-01" }, { category: "PRIVATE" }, { action: "PRIVATE" }, { actorRole: "admin" }, { targetId: "PRIVATE" }, { targetType: "PRIVATE" }]) {
    const res = response(); await getManagementAuditLogs({ query }, res); assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);
  }
  const res = response();
  await getManagementAuditLogs({ query: { page: "2", limit: "20", actorRole: "dean", action: "login", startDate: "2026-01-01", endDate: "2026-01-31" } }, res);
  assert.equal(res.body.pagination.total, 21);
  assert.deepEqual(calls.find(([key]) => key === "sort")[1], { createdAt: -1, _id: -1 });
  assert.equal(calls.find(([key]) => key === "skip")[1], 20);
  assert.equal(calls.find(([key]) => key === "limit")[1], 20);
  assert.doesNotMatch(calls.find(([key]) => key === "select")[1], /description|password|token/);
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE/);
  assert.deepEqual(calls[0][1].actorRole, { $in: ["dean", "admin"] });
});

test("HTTP rejects non-Deans before querying, protects all audit routes, rejects private filters and has no mutation endpoints", async () => {
  let queries = 0;
  patch(AuditLog, "find", () => { queries++; return chain([]); });
  patch(AuditLog, "aggregate", () => { queries++; return chain([]); });
  patch(AuditLog, "countDocuments", () => { queries++; return chain(0); });
  patch(User, "findById", value => chain({ ...actor, role: value === "student" ? "student" : value === "faculty" ? "faculty" : "dean", accountStatus: value === "inactive" ? "Inactive" : "Active" }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/dean`;
  const call = (path, role, method = "GET") => fetch(base + path, { method, headers: role ? { Authorization: `Bearer ${jwt.sign({ sub: role }, env.jwtSecret)}` } : {} });
  try {
    for (const path of ["/audit-logs", "/audit-users", `/audit-users/${id}/logs`, `/audit-logs/export?userId=${id}`]) for (const role of [null, "student", "faculty", "inactive"]) {
      const res = await call(path, role); assert.equal(res.status, role ? 403 : 401); assert.equal(res.headers.get("cache-control"), "no-store");
    }
    assert.equal(queries, 0);
    for (const query of ["reason=PRIVATE", "metadata=PRIVATE", "page=1&page=2", "limit[$gt]=1", "search=PRIVATE&token=PRIVATE"]) assert.equal((await call(`/audit-logs?${query}`, "dean")).status, 400);
    assert.equal(queries, 0);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) for (const path of ["/audit-logs", `/audit-logs/${id}`, `/audit-users/${id}/logs`]) assert.equal((await call(path, "dean", method)).status, 404);
    assert.equal(queries, 0);
    assert.equal((await call("/audit-logs", "dean")).status, 200);
    patch(AuditLog, "find", () => { throw new Error("PRIVATE database details"); });
    const unavailable = await call("/audit-logs", "dean");
    assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get("cache-control"), "no-store"); assert.doesNotMatch(await unavailable.text(), /PRIVATE/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("Dean login/logout require acknowledged writes and return safe failure without a token", async () => {
  const user = { ...actor, password: await bcrypt.hash("Password1", 4) };
  patch(User, "findOne", () => chain(user));
  patch(AuditLog, "create", async () => { throw new Error("PRIVATE database message"); });
  const res = response(); await login({ params: { role: "dean" }, body: { username: "dean", password: "Password1" } }, res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.token, undefined); assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE/);
  const out = response(); await logout({ user }, out); assert.equal(out.statusCode, 503);
});

test("CSV validation is atomic with its safe count-only audit, rejects safely, rolls back and survives retries", async () => {
  const stored = [], audits = []; let failAudit = false, retry = false;
  patch(User, "find", () => chain([]));
  const session = { async withTransaction(work) { const before = [stored.length, audits.length]; try { await work(); if (retry) { stored.length = before[0]; audits.length = before[1]; await work(); } } catch (error) { stored.length = before[0]; audits.length = before[1]; throw error; } }, async endSession() {} };
  patch(mongoose, "startSession", async () => session);
  patch(AccountImport, "create", async ([record], options) => { assert.equal(options.session, session); stored.push(record); return [record]; });
  patch(AuditLog, "create", async (records, options) => { const record = Array.isArray(records) ? records[0] : records; if (failAudit) throw new Error("PRIVATE"); validateAudit(record); if (record.relatedEntityType === "AccountImport") assert.equal(options.session, session); audits.push(record); return records; });
  patch(Notification, "create", async values => values);
  const run = async csv => { const req = { user: actor, file: { buffer: Buffer.from(csv), originalname: "PRIVATE.csv" } }; const res = response(); await validateAccountImport(req, res); assert.equal(req.file, undefined); return res; };
  const csv = "institutional_id,first_name,last_name,official_email,role\n000123,Juan,Santos,juan@student.hau.edu.ph,student";
  assert.equal((await run(csv)).statusCode, 200); assert.equal(audits[0].metadata.outcome, "valid");
  assert.doesNotMatch(JSON.stringify(audits), /PRIVATE|Juan|Santos|000123|@|filename|rows":/);
  assert.equal((await run(csv.replace(",student", ",dean"))).statusCode, 200); assert.equal(audits.at(-1).metadata.outcome, "invalid");
  assert.equal((await run("bad headers")).statusCode, 400); assert.equal(audits.at(-1).metadata.code, "CSV_REJECTED");
  const before = [stored.length, audits.length]; failAudit = true; assert.equal((await run(csv)).statusCode, 500); assert.deepEqual([stored.length, audits.length], before);
  failAudit = false; retry = true; await run(csv); assert.equal(stored.length, before[0] + 1); assert.equal(audits.length, before[1] + 1);
});

test("AI attempts distinguish known rejection, timeout, successful persistence and uncertain commit", async () => {
  const audits = []; let mode = "provider";
  patch(Appointment, "aggregate", () => chain([]));
  patch(User, "findById", () => chain(actor));
  patch(Notification, "create", async values => values);
  patch(AuditLog, "create", async (values, options) => { for (const value of values) { validateAudit(value); audits.push({ ...value, atomic: Boolean(options?.session) }); } return values; });
  patch(ReportNarrative, "create", async ([value]) => [{ ...value, _id: id }]);
  patch(mongoose, "startSession", async () => ({ async withTransaction(work) { if (mode === "uncertain") throw Object.assign(new Error("PRIVATE"), { hasErrorLabel: label => label === "UnknownTransactionCommitResult" }); return work(); }, async endSession() {} }));
  const input = { start: "2026-01-01", end: "2026-01-31" };
  for (const [error, outcome] of [[new Error("AI_INVALID_OUTPUT"), "failed"], [Object.assign(new Error("PRIVATE timeout"), { name: "APIConnectionTimeoutError" }), "uncertain"], [Object.assign(new Error("PRIVATE"), { status: 400 }), "failed"], [Object.assign(new Error("PRIVATE"), { status: 500 }), "uncertain"]]) {
    await assert.rejects(createNarrative(input, actor, async () => { throw error; }));
    assert.equal(audits.at(-1).metadata.outcome, outcome); assert.equal(audits.at(-2).action, "ai_generation_started");
  }
  mode = "success"; await createNarrative(input, actor, async () => "Safe report narrative.");
  assert.equal(audits.at(-1).metadata.outcome, "success"); assert.equal(audits.at(-1).atomic, true); assert.equal(audits.at(-2).action, "report_narrative_generated");
  mode = "uncertain"; await assert.rejects(createNarrative(input, actor, async () => "Safe report narrative."));
  assert.equal(audits.at(-1).metadata.code, "COMMIT_UNCERTAIN"); assert.equal(audits.at(-1).metadata.outcome, "uncertain");
  assert.doesNotMatch(JSON.stringify(audits), /PRIVATE|Safe report narrative|prompt|snapshot/);
});

test("source contracts keep secrets out of audit writers and expose audit only under Advanced", async () => {
  for (const file of ["services/activityService.js", "services/appointmentTransitionService.js", "services/attendanceReviewService.js", "services/attendanceService.js", "services/reportNarrativeService.js", "controllers/accountImportController.js"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    for (const match of source.matchAll(/metadata:\s*\{([^}]*)\}/g)) assert.doesNotMatch(match[1], /\b(reason|password|token|cookie|authorization|apiKey|prompt|body|file|topic|facultyName|studentName)\b/);
  }
  const migration = await readFile(new URL("../src/services/deanAccountMigrationService.js", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /auditLogs\.(update|delete|replace)/);
  const navigation = await readFile(new URL("../../client/src/layouts/DeanLayout.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(navigation, /audit-logs|Audit Logs/);
  const accounts = await readFile(new URL("../../client/src/pages/Dean/UserManagement.jsx", import.meta.url), "utf8");
  assert.match(accounts, /Advanced/); assert.match(accounts, /\/dean\/audit-logs/);
});
