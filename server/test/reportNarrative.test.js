import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import Appointment from "../src/models/Appointment.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import ReportNarrative from "../src/models/ReportNarrative.js";
import ReportNarrativeReview from "../src/models/ReportNarrativeReview.js";
import { aggregateSnapshot, createNarrative, readNarrative, reviewNarrative, DISCLAIMER } from "../src/services/reportNarrativeService.js";
import { generateNarrative } from "../src/services/reportNarrativeAdapter.js";
import { buildReport, parseReportFilters, loadReportData } from "../src/services/deanReportDataService.js";
const id = "1234567890abcdef12345678", filters = { start: "2026-10-01", end: "2026-10-16" }, actor = { id, _id: id, role: "dean", accountStatus: "Active" };
const chain = value => { const q = { then: (yes, no) => Promise.resolve(value).then(yes, no) }; for (const k of ["select", "session", "option"]) q[k] = () => q; return q; };

test("aggregate payload matches report classifications and adapter has no tools or private data", async () => {
  const rows = [{ status: "Completed", attendance: {}, consultationMode: "Online", reason: "SECRET", student: { name: "SECRET" } }, { status: "Completed", attendance: { finalOutcome: "Student No-show", finalizationSource: "dean_review" }, consultationMode: "Face-to-Face" }];
  const snapshot = aggregateSnapshot(filters, buildReport(rows, filters, new Date()).summary);
  assert.deepEqual(Object.keys(snapshot), ["dateRange", "totalConsultations", "statusCounts", "attendanceOutcomeCounts", "consultationModeCounts"]);
  assert.equal(snapshot.attendanceOutcomeCounts["Historical unverified Completed"], 1);
  assert.equal(snapshot.attendanceOutcomeCounts["Student No-show"], 1);
  let request;
  const client = { chat: { completions: { create: async input => { request = input; return { choices: [{ finish_reason: "stop", message: { content: "Two consultations were recorded." } }] }; } } } };
  assert.equal(await generateNarrative(snapshot, client), "Two consultations were recorded.");
  assert.deepEqual(JSON.parse(request.messages[1].content), snapshot);
  assert.equal(request.tools, undefined); assert.equal(request.tool_choice, undefined);
  assert.doesNotMatch(JSON.stringify(request), /SECRET/);
  for (const message of [{ content: "" }, { content: "x".repeat(3001) }, { content: "https://secret.test" }, { content: "ok", tool_calls: [{}] }, { content: "ok", function_call: {} }]) {
    client.chat.completions.create = async () => ({ choices: [{ finish_reason: "stop", message }] });
    await assert.rejects(generateNarrative(snapshot, client));
  }
  client.chat.completions.create = async () => ({ choices: [{ finish_reason: "length", message: { content: "Partial" } }] });
  await assert.rejects(generateNarrative(snapshot, client));
  for (const key of ["total", "prompt", "history", "snapshot", "narrative"]) assert.throws(() => parseReportFilters({ ...filters, [key]: "SECRET" }), { statusCode: 400 });
});

test("immutable records reject private fields and all application mutations", async () => {
  for (const Model of [ReportNarrative, ReportNarrativeReview]) {
    assert.throws(() => new Model({ concern: "SECRET" }), /strict mode/);
    for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"]) await assert.rejects(Model[operation]({}, {}), /immutable/);
    await assert.rejects(Model.bulkWrite([]), /immutable/);
  }
  assert.ok(ReportNarrativeReview.schema.indexes().some(([keys, options]) => keys.summary === 1 && options.unique));
  const summary = new ReportNarrative({ dean: id, filters, snapshot: aggregateSnapshot(filters, buildReport([], filters, new Date()).summary), narrative: "Zero consultations.", generatedAt: new Date() });
  await summary.validate(); assert.equal(summary.reviewState, "unreviewed");
  summary.isNew = false; await assert.rejects(summary.save(), /immutable/);
});

test("generation, regeneration, review versions, rollback, filter query parity and limits", async () => {
  const restores = [], records = [], reviews = [], audits = []; let staged, failure = "", revoked = false, rowCount = 1, calls = 0, pipeline;
  const patch = (o, k, v) => { const old = o[k]; o[k] = v; restores.push(() => o[k] = old); };
  const session = { async withTransaction(work) { staged = []; const result = await work(); staged.forEach(fn => fn()); return result; }, async endSession() {} };
  patch(Notification, "create", async records => { assert.equal(records[0].type, "ai_summary_failed"); assert.doesNotMatch(JSON.stringify(records), /SECRET|unavailable|snapshot|prompt/); return records; });
  patch(mongoose, "startSession", async () => session);
  patch(User, "findById", () => chain(revoked ? { ...actor, role: "student" } : actor));
  patch(Appointment, "aggregate", input => { pipeline = input; return chain(Array(rowCount).fill({ status: "Pending", consultationMode: "Online" })); });
  patch(Appointment, "populate", () => assert.fail("AI must not populate identities"));
  patch(ReportNarrative, "create", async ([data]) => { if (failure === "summary") throw new Error("SECRET"); const record = { ...data, _id: id }; staged.push(() => records.push(record)); return [record]; });
  patch(ReportNarrative, "findById", () => chain(records[0] || null));
  patch(ReportNarrativeReview, "findOne", () => chain(reviews[0] || null));
  patch(ReportNarrativeReview, "create", async ([data]) => { if (failure === "duplicate") throw Object.assign(new Error(), { code: 11000 }); staged.push(() => reviews.push(data)); return [data]; });
  patch(AuditLog, "create", async ([data], options) => { if (failure === "audit" && options?.session) throw new Error("SECRET"); if (options?.session) staged.push(() => audits.push(data)); else audits.push(data); return [data]; });
  const adapter = async snapshot => { calls++; assert.equal(snapshot.totalConsultations, rowCount); return "One consultation was recorded."; };
  try {
    const input = { ...filters, facultyId: id, status: "Completed", mode: "Online", attendanceOutcome: "Completed" };
    const first = await createNarrative(input, actor, adapter);
    assert.deepEqual(pipeline[0].$match, parseReportFilters(input).filter);
    assert.equal(pipeline[2].$limit, 1001);
    assert.doesNotMatch(JSON.stringify(pipeline.at(-1)), /student|faculty|reason|notes|subject/);
    assert.equal(first.reviewState, "unreviewed"); assert.equal(first.version, 1); assert.equal(first.disclaimer, DISCLAIMER);
    await createNarrative(input, actor, adapter); assert.equal(records.length, 2); assert.equal(calls, 2);
    for (const value of [{}, { expectedVersion: 1, narrative: "edit" }, { expectedVersion: "1" }]) await assert.rejects(reviewNarrative(id, value, actor), { statusCode: 400 });
    await assert.rejects(reviewNarrative(id, { expectedVersion: 2 }, actor), { statusCode: 409 });
    failure = "audit"; await assert.rejects(reviewNarrative(id, { expectedVersion: 1 }, actor)); assert.equal(reviews.length, 0);
    failure = "duplicate"; await assert.rejects(reviewNarrative(id, { expectedVersion: 1 }, actor), { statusCode: 409 });
    failure = ""; const approved = await reviewNarrative(id, { expectedVersion: 1 }, actor); assert.equal(approved.version, 2); assert.equal(approved.reviewState, "reviewed");
    await assert.rejects(reviewNarrative(id, { expectedVersion: 1 }, actor), { statusCode: 409 });
    assert.equal((await readNarrative(id, actor)).reviewState, "reviewed");
    assert.doesNotMatch(JSON.stringify(audits), /narrative":|snapshot|filters|SECRET/);
    for (const mode of ["summary", "audit"]) { failure = mode; await assert.rejects(createNarrative(filters, actor, adapter)); assert.equal(records.length, 2); }
    failure = ""; revoked = true; await assert.rejects(createNarrative(filters, actor, adapter), { statusCode: 403 }); assert.equal(records.length, 2); revoked = false;
    rowCount = 1001; await assert.rejects(loadReportData(filters, actor), { statusCode: 413 });
    await assert.rejects(createNarrative(filters, { ...actor, role: "faculty" }, adapter), { statusCode: 403 });
    await assert.rejects(createNarrative(filters, actor, async () => { throw new Error("unavailable"); })); assert.equal(records.length, 2);
  } finally { restores.reverse().forEach(fn => fn()); }
});

test("HTTP isolation, authorization, rate limits, no-store and sanitized parser/provider failures", async () => {
  const oldAudit = AuditLog.create;
  AuditLog.create = async records => records;
  const oldNotify = Notification.create;
  Notification.create = async records => records;
  const old = User.findById;
  const oldAggregate = Appointment.aggregate, oldKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  Appointment.aggregate = () => chain([]);
  User.findById = value => chain({ ...actor, id: value, _id: value, role: value.startsWith("f") ? "faculty" : value.startsWith("s") ? "student" : "dean" });
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, body, role = "dean", method = "POST") => fetch(base + path, { method, headers: { "Content-Type": "application/json", Connection: "close", ...(role && { Authorization: `Bearer ${jwt.sign({ sub: role }, env.jwtSecret)}` }) }, ...(method !== "GET" && { body: typeof body === "string" ? body : JSON.stringify(body) }) });
  try {
    for (const role of ["public", "student", "faculty", "dean"]) assert.equal((await request(`/${role}/ai/chat`, {})).status, 404);
    assert.equal((await request("/dean/reports/ai-summary", null, "dean", "GET")).status, 404);
    const unavailable = await request("/dean/reports/ai-summaries", filters, "dean-unavailable");
    assert.equal(unavailable.status, 503); assert.match(await unavailable.text(), /PDF reports remain available/);
    for (const role of [null, "student", "faculty"]) { const r = await request("/dean/reports/ai-summaries", filters, role); assert.equal(r.status, role ? 403 : 401); assert.equal(r.headers.get("cache-control"), "no-store"); }
    for (const [body, status] of [['{"SECRET":', 400], [JSON.stringify({ SECRET: "x".repeat(2200) }), 413]]) { const r = await request("/dean/reports/ai-summaries", body); assert.equal(r.status, status); assert.equal(r.headers.get("cache-control"), "no-store"); assert.doesNotMatch(await r.text(), /SECRET/); }
    assert.equal((await request("/dean/reports/ai-summaries?total=9", filters)).status, 400);
    for (let i = 0; i < 3; i++) assert.equal((await request("/dean/reports/ai-summaries", { ...filters, prompt: "SECRET" })).status, 400);
    assert.equal((await request("/dean/reports/ai-summaries", filters)).status, 429);
    for (let i = 0; i < 8; i++) assert.equal((await request(`/dean/reports/ai-summaries/${id}/review`, {})).status, 400);
    assert.equal((await request(`/dean/reports/ai-summaries/${id}/review`, {})).status, 429);
  } finally { AuditLog.create = oldAudit; Notification.create = oldNotify; User.findById = old; Appointment.aggregate = oldAggregate; if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey; await new Promise(resolve => server.close(resolve)); }
});

test("only Reports mounts AI UI and only narrative adapter imports Groq", async () => {
  for (const path of ["layouts/DeanLayout.jsx", "layouts/StudentLayout.jsx", "layouts/FacultyLayout.jsx", "pages/Public/LandingPage.jsx"]) assert.doesNotMatch(await readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8"), /AIAssistant|AIGuide|ReportNarrativePanel/);
  const panel = await readFile(new URL("../../client/src/components/dean/ReportNarrativePanel.jsx", import.meta.url), "utf8");
  assert.ok(panel.includes(DISCLAIMER)); assert.doesNotMatch(panel, /textarea|dangerouslySetInnerHTML|contentEditable/);
});


test("AI failure notices preserve original errors and skip uncertain commit outcomes", async () => {
  const restores = [], notices = [];
  const patch = (o, k, v) => { const old = o[k]; o[k] = v; restores.push(() => o[k] = old); };
  let mode = "provider", attempts = 0;
  const raw = new Error("AI_INVALID_OUTPUT");
  patch(AuditLog, "create", async records => records);
  patch(Appointment, "aggregate", () => chain([]));
  patch(mongoose, "startSession", async () => ({
    async withTransaction() {
      if (mode === "uncertain") throw Object.assign(new Error("SECRET uncertain"), { hasErrorLabel: label => label === "UnknownTransactionCommitResult" });
      throw raw;
    }, async endSession() {}
  }));
  patch(Notification, "create", async rows => { attempts++; notices.push(...rows); if (mode === "delivery") throw new Error("SECRET delivery error"); return rows; });
  const warnings = []; patch(console, "warn", value => warnings.push(value));
  try {
    await assert.rejects(createNarrative(filters, actor, async () => { throw raw; }), error => error === raw);
    mode = "storage";
    await assert.rejects(createNarrative(filters, actor, async () => "A report summary."), error => error === raw);
    mode = "uncertain";
    await assert.rejects(createNarrative(filters, actor, async () => "A report summary."));
    assert.equal(attempts, 2);
    mode = "delivery";
    await assert.rejects(createNarrative(filters, actor, async () => { throw raw; }), error => error === raw);
    assert.equal(attempts, 3); assert.equal(warnings.length, 1);
    assert.doesNotMatch(JSON.stringify([notices, warnings]), /SECRET|snapshot|prompt|narrative/);
  } finally { restores.reverse().forEach(fn => fn()); }
});
