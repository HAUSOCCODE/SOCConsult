import assert from "node:assert/strict";
import Groq from "groq-sdk";
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
import { generateNarrative, renderNarrative, narrativeMaterial } from "../src/services/reportNarrativeAdapter.js";
import { buildReport, parseReportFilters, loadReportData } from "../src/services/deanReportDataService.js";
const id = "1234567890abcdef12345678", filters = { start: "2026-10-01", end: "2026-10-16" }, actor = { id, _id: id, role: "dean", accountStatus: "Active" };
const chain = value => { const q = { then: (yes, no) => Promise.resolve(value).then(yes, no) }; for (const k of ["select", "session", "option"]) q[k] = () => q; return q; };
const completion = input => {
  const { candidates, totalConsultations } = JSON.parse(input.messages[1].content);
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(Object.fromEntries(Object.entries(candidates).map(([key, ids]) => [key, ids.slice(0, totalConsultations === 1 ? 1 : 2)]))) } }] };
};
const snapshotPayload = input => { const { candidates, candidateText, ...snapshot } = JSON.parse(input.messages[1].content); return snapshot; };

test("structured narratives explain authoritative nonzero findings with targeted recommendations", async () => {
  const rows = [
    { status: "Completed", consultationMode: "Online", attendance: { finalOutcome: "Completed", finalizationSource: "dean_review" } },
    { status: "Completed", consultationMode: "Online", attendance: { finalOutcome: "Student No-show", finalizationSource: "participant_agreement" } },
    { status: "Completed", consultationMode: "Face-to-Face" },
    { status: "Attendance Review", consultationMode: "Online" },
    { status: "Pending" },
  ];
  const snapshot = aggregateSnapshot(filters, buildReport(rows, filters, new Date()).summary);
  let calls = 0;
  const client = { chat: { completions: { create: async input => { calls++; return completion(input); } } } };
  const text = await generateNarrative(snapshot, client);
  assert.equal(calls, 1);
  assert.deepEqual(text.split("\n").filter(line => ["Executive Summary", "Consultation Activity", "Attendance Analysis", "Key Observations", "Recommendations"].includes(line)), ["Executive Summary", "Consultation Activity", "Attendance Analysis", "Key Observations", "Recommendations"]);
  assert.match(text, /covers 5 consultation requests/);
  assert.match(text, /3 requests were recorded as Completed/);
  assert.match(text, /remaining 1 request fell into other workflow statuses/);
  assert.match(text, /3 online requests, 1 face-to-face request and 1 request without a recorded mode/);
  for (const phrase of ["1 consultation had verified attendance", "1 record had a verified student no-show", "1 historical completion remained unverified", "1 record was under attendance review", "1 record had no verified final attendance outcome"]) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /Expired|Cancelled|Rejected|Faculty No-show|: 0/);
  assert.match(text, /does not establish attendance/);
  assert.match(text, /prioritize outstanding attendance cases/i);
  assert.ok(text.length < 2200);
  const clean = aggregateSnapshot(filters, buildReport(rows.slice(0, 1), filters, new Date()).summary);
  assert.deepEqual(Object.keys(narrativeMaterial(clean).recommendations), ["complete"]);
});

test("single-record narratives remain concise and distinguish verified attendance from workflow completion", async () => {
  const run = async row => {
    const snapshot = aggregateSnapshot(filters, buildReport([row], filters, new Date()).summary);
    return generateNarrative(snapshot, { chat: { completions: { create: async input => completion(input) } } });
  };
  const verified = await run({ status: "Completed", consultationMode: "Online", attendance: { finalOutcome: "Completed", finalizationSource: "dean_review" } });
  assert.match(verified, /covers 1 consultation request created/);
  assert.match(verified, /1 request was recorded as Completed/);
  assert.match(verified, /1 consultation had verified attendance/);
  assert.doesNotMatch(verified, /no-show|unverified|Workflow completion alone|: 0/);
  assert.ok(verified.split(/\s+/).length < 130);
  const historical = await run({ status: "Completed", consultationMode: "Online" });
  assert.match(historical, /1 historical completion remained unverified/);
  assert.match(historical, /does not establish attendance/);
  assert.doesNotMatch(historical, /1 consultation had verified attendance/);
  assert.ok(historical.split(/\s+/).length < 160);
  const noShow = await run({ status: "Completed", attendance: { finalOutcome: "Faculty No-show", finalizationSource: "dean_review" } });
  assert.match(noShow, /1 record had a verified faculty no-show/);
  assert.doesNotMatch(noShow, /1 consultation had verified attendance/);
});

test("invalid provider plans cannot inject claims, omit facts, or cause retries", async () => {
  const snapshot = aggregateSnapshot(filters, buildReport([{ status: "Pending" }], filters, new Date()).summary);
  const candidates = { observations: ["scope", "verification"], recommendations: ["review", "verification"] };
  for (const content of ["not JSON", "null", "[]", JSON.stringify({ ...candidates, count: 99 }), JSON.stringify({ ...candidates, observations: ["scope", "scope"] }), JSON.stringify({ ...candidates, recommendations: ["review"] }), JSON.stringify({ ...candidates, observations: ["scope", "Attendance increased by 99%"] })]) {
    let calls = 0;
    const client = { chat: { completions: { create: async () => { calls++; return { choices: [{ finish_reason: "stop", message: { content } }] }; } } } };
    await assert.rejects(generateNarrative(snapshot, client), /AI_INVALID_OUTPUT/);
    assert.equal(calls, 1);
  }
  const timeout = Object.assign(new Error("private provider detail"), { name: "APIConnectionTimeoutError" });
  let calls = 0;
  await assert.rejects(generateNarrative(snapshot, { chat: { completions: { create: async () => { calls++; throw timeout; } } } }), error => error === timeout);
  assert.equal(calls, 1);
});

test("empty datasets and unauthorized actors never invoke AI; duplicate requests are bounded", async () => {
  const oldAggregate = Appointment.aggregate, oldAudit = AuditLog.create;
  let calls = 0, release;
  const adapter = async () => { calls++; await new Promise(resolve => { release = resolve; }); throw new Error("AI_UNAVAILABLE"); };
  const oldNotification = Notification.create;
  Notification.create = async records => records;
  AuditLog.create = async records => records;
  try {
    Appointment.aggregate = () => chain([]);
    await assert.rejects(createNarrative(filters, actor, adapter), { statusCode: 422 });
    await assert.rejects(generateNarrative({ totalConsultations: 0 }, { chat: { completions: { create: () => assert.fail("empty provider call") } } }), { statusCode: 422 });
    for (const identity of [{ ...actor, role: "faculty" }, { ...actor, role: "student" }, { ...actor, accountStatus: "Inactive" }]) await assert.rejects(createNarrative(filters, identity, adapter), { statusCode: 403 });
    assert.equal(calls, 0);
    Appointment.aggregate = () => chain([{ status: "Pending" }]);
    const first = createNarrative(filters, actor, adapter);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    await assert.rejects(createNarrative(filters, actor, adapter), { statusCode: 429 });
    release(); await assert.rejects(first, /AI_UNAVAILABLE/);
    // Failure releases the guard; a manual retry can load the dataset again.
    Appointment.aggregate = () => chain([]);
    await assert.rejects(createNarrative(filters, actor, adapter), { statusCode: 422 });
  } finally { Appointment.aggregate = oldAggregate; AuditLog.create = oldAudit; Notification.create = oldNotification; }
});

test("aggregate payload matches report classifications and adapter has no tools or private data", async () => {
  const rows = [{ status: "Completed", attendance: {}, consultationMode: "Online", reason: "SECRET", student: { name: "SECRET" } }, { status: "Completed", attendance: { finalOutcome: "Student No-show", finalizationSource: "dean_review" }, consultationMode: "Face-to-Face" }];
  const snapshot = aggregateSnapshot(filters, buildReport(rows, filters, new Date()).summary);
  assert.deepEqual(Object.keys(snapshot), ["dateRange", "totalConsultations", "statusCounts", "attendanceOutcomeCounts", "consultationModeCounts"]);
  assert.equal(snapshot.attendanceOutcomeCounts["Historical unverified Completed"], 1);
  assert.equal(snapshot.attendanceOutcomeCounts["Student No-show"], 1);
  let request;
  const client = { chat: { completions: { create: async input => { request = input; return completion(input); } } } };
  assert.equal(await generateNarrative(snapshot, client), renderNarrative(snapshot, JSON.parse(completion(request).choices[0].message.content)));
  assert.deepEqual(snapshotPayload(request), snapshot);
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

test("server aggregate reaches mocked Groq without any private field or mutation capability", async () => {
  const restores = [], sentinels = {
    name: "PRIVATE_NAME_SENTINEL", id: "PRIVATE_ID_SENTINEL", email: "PRIVATE_EMAIL_SENTINEL@example.invalid",
    concern: "PRIVATE_CONCERN_SENTINEL", notes: "PRIVATE_NOTES_SENTINEL", document: "PRIVATE_DOCUMENT_SENTINEL",
    link: "https://private.invalid/PRIVATE_LINK_SENTINEL", reason: "PRIVATE_REASON_SENTINEL", raw: "PRIVATE_RAW_RECORD_SENTINEL",
  };
  const patch = (object, key, value) => { const old = object[key]; object[key] = value; restores.push(() => { object[key] = old; }); };
  const oldKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "isolated-test-never-sent";
  let outbound, calls = 0;
  patch(Appointment, "aggregate", () => chain([{
    _id: sentinels.id, student: { name: sentinels.name, studentId: sentinels.id, email: sentinels.email },
    faculty: { name: sentinels.name, employeeId: sentinels.id, email: sentinels.email },
    subject: sentinels.concern, concern: sentinels.concern, reason: sentinels.reason, notes: sentinels.notes,
    supportingDocuments: [{ originalName: sentinels.document, cloudinaryUrl: sentinels.link }],
    meetingLink: sentinels.link, providerUrl: sentinels.link, rawRecords: [sentinels.raw],
    status: "Completed", consultationMode: "Online",
    attendance: { finalOutcome: "Completed", finalizationSource: "dean_review", reason: sentinels.reason },
  }]));
  patch(AuditLog, "create", async records => records);
  patch(User, "findById", () => chain(actor));
  patch(mongoose, "startSession", async () => ({ withTransaction: async work => work(), endSession: async () => {} }));
  patch(ReportNarrative, "create", async ([record]) => [{ ...record, _id: id }]);
  patch(Groq.prototype, "post", async (path, options) => {
    calls++; assert.equal(path, "/openai/v1/chat/completions"); outbound = options.body;
    return completion(outbound);
  });
  try {
    const result = await createNarrative(filters, actor);
    assert.equal(calls, 1);
    const payload = snapshotPayload(outbound);
    assert.deepEqual(payload, aggregateSnapshot(filters, buildReport([{
      status: "Completed", consultationMode: "Online", attendance: { finalOutcome: "Completed", finalizationSource: "dean_review" },
    }], filters, new Date()).summary));
    for (const value of Object.values(sentinels)) assert.ok(!JSON.stringify(outbound).includes(value), value);
    for (const field of ["tools", "tool_choice", "functions", "function_call"]) assert.equal(outbound[field], undefined);
    assert.deepEqual(outbound.messages.map(message => message.role), ["system", "user"]);
    assert.equal(result.disclaimer, DISCLAIMER); assert.equal(result.reviewState, "unreviewed");
  } finally {
    restores.reverse().forEach(restore => restore());
    if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey;
  }
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
  let protectedReads = 0;
  Appointment.aggregate = () => { protectedReads++; return chain([{ status: "Pending", consultationMode: "Online" }]); };
  User.findById = value => chain({ ...actor, id: value, _id: value, role: value.startsWith("f") ? "faculty" : value.startsWith("s") ? "student" : "dean" });
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, body, role = "dean", method = "POST") => fetch(base + path, { method, headers: { "Content-Type": "application/json", Connection: "close", ...(role && { Authorization: `Bearer ${jwt.sign({ sub: role }, env.jwtSecret)}` }) }, ...(method !== "GET" && { body: typeof body === "string" ? body : JSON.stringify(body) }) });
  try {
    for (const role of ["public", "student", "faculty", "dean"]) assert.equal((await request(`/${role}/ai/chat`, {})).status, 404);
    assert.equal((await request("/dean/reports/ai-summary", null, "dean", "GET")).status, 404);
    for (const role of [null, "student", "faculty"]) { const r = await request("/dean/reports/ai-summaries", filters, role); assert.equal(r.status, role ? 403 : 401); assert.equal(r.headers.get("cache-control"), "no-store"); }
    assert.equal(protectedReads, 0, "authorization must precede aggregate reads");
    const unavailable = await request("/dean/reports/ai-summaries", filters, "dean-unavailable");
    assert.equal(unavailable.status, 503); assert.match(await unavailable.text(), /PDF reports remain available/);
    Appointment.aggregate = () => chain([]);
    const empty = await request("/dean/reports/ai-summaries", filters, "dean-empty");
    assert.equal(empty.status, 422); assert.equal((await empty.json()).code, "AI_EMPTY_DATASET");
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
  patch(Appointment, "aggregate", () => chain([{ status: "Pending", consultationMode: "Online" }]));
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
