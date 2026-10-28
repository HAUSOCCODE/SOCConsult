import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import ReportExport from "../src/models/ReportExport.js";
import AuditLog from "../src/models/AuditLog.js";
import { buildFacultyReport, createFacultyReport, facultyReportQuery, parseFacultyReportFilters } from "../src/services/facultyReportService.js";
import { generateFacultyReportPdf } from "../src/services/facultyReportPdfService.js";

const id = () => new mongoose.Types.ObjectId().toString();
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const tokenFor = value => jwt.sign({ sub: value }, env.jwtSecret);
const listen = () => new Promise(resolve => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });

test("Faculty report filters use Manila schedule dates, historical values and bounded scalar input", () => {
  const parsed = parseFacultyReportFilters({ startDate: "2026-01-01", endDate: "2026-12-31", status: "Completed", attendanceOutcome: "Student No-show", mode: "Online" });
  assert.equal(parsed.start.toISOString(), "2025-12-31T16:00:00.000Z");
  assert.equal(parsed.endExclusive.toISOString(), "2026-12-31T16:00:00.000Z");
  const faculty = id(), query = facultyReportQuery(faculty, parsed);
  assert.equal(query.faculty, faculty); assert.equal(query.status, "Completed");
  assert.equal(query["attendance.finalOutcome"], "Student No-show"); assert.equal(query.consultationMode, "Online");
  for (const input of [null, {}, { startDate: "bad", endDate: "2026-01-01" }, { startDate: "2026-02-01", endDate: "2026-01-01" }, { startDate: "2025-01-01", endDate: "2026-12-31" }, { startDate: "2026-01-01", endDate: "2026-01-02", status: "Pending" }, { startDate: "2026-01-01", endDate: "2026-01-02", attendanceOutcome: "No Show" }, { startDate: "2026-01-01", endDate: "2026-01-02", mode: "Hybrid" }, { startDate: "2026-01-01", endDate: "2026-01-02", facultyId: id() }, { startDate: ["2026-01-01"], endDate: "2026-01-02" }]) assert.throws(() => parseFacultyReportFilters(input));
});

test("deterministic report summaries separate status/outcome and exclude raw attendance/private fields", () => {
  const rows = [
    { student: { name: "Student One", studentId: "S-1", email: "private@test" }, subject: "Algorithms", reason: "Review complexity", startAt: new Date(), consultationMode: "Online", status: "Completed", attendance: { finalOutcome: "Student No-show", studentResponse: { reason: "private" } } },
    { student: { name: "Student Two", institutionalId: "S-2" }, subject: "Networks", reason: "Routing", startAt: new Date(), consultationMode: "Face-to-Face", status: "Attendance Review", attendance: { facultyResponse: { reason: "private" } } },
  ];
  const report = buildFacultyReport(rows, { name: "Faculty Owner", password: "secret" }, { startDate: "2026-01-01", endDate: "2026-01-31", status: "", attendanceOutcome: "", mode: "" }, new Date());
  assert.equal(report.summary.total, 2); assert.equal(report.summary.status.Completed, 1); assert.equal(report.summary.status["Attendance Review"], 1);
  assert.equal(report.summary.attendance["Student No-show"], 1); assert.equal(report.summary.attendance["Not finalized"], 1);
  assert.equal(report.records[0].status, "Completed"); assert.equal(report.records[0].attendanceOutcome, "Student No-show");
  assert.doesNotMatch(JSON.stringify(report), /private@test|studentResponse|facultyResponse|password|secret/);
});

test("PDFKit output is a readable multi-page PDF with deterministic metadata and no AI narrative", async () => {
  const rows = Array.from({ length: 80 }, (_, index) => ({ student: { name: `Student ${index}`, studentId: `S-${index}` }, subject: "Long subject ".repeat(8), reason: "Long consultation concern ".repeat(20), startAt: new Date("2026-01-02T01:00:00Z"), consultationMode: index % 2 ? "Online" : "Face-to-Face", status: "Completed", attendance: { finalOutcome: "Completed" } }));
  const report = buildFacultyReport(rows, { name: "Faculty Owner" }, { startDate: "2026-01-01", endDate: "2026-01-31", status: "", attendanceOutcome: "", mode: "" }, new Date("2026-02-01T00:00:00Z"));
  const bytes = await generateFacultyReportPdf(report);
  assert.ok(bytes.length > 10000); assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  assert.match(bytes.toString("latin1"), /\/Count\s+[2-9]\d*/);
});

function harness({ rows = null, role = "faculty", failMetadata = false } = {}) {
  const actor = id(), student = id(), records = rows || [{ _id: id(), student: { _id: student, name: "Assigned Student", studentId: "S-1" }, subject: "Algorithms", reason: "Review", startAt: new Date("2026-01-10T01:00:00Z"), consultationMode: "Online", status: "Completed", attendance: { finalOutcome: "Completed" } }];
  const restores = [], metadata = [], audits = [], queries = [];
  const patch = (object, key, value) => { const original = object[key]; object[key] = value; restores.push(() => object[key] = original); };
  patch(Appointment, "find", query => { queries.push(query); const chain = { select: () => chain, populate: () => chain, sort: () => chain, limit: () => chain, lean: async () => records }; return chain; });
  patch(User, "findOne", query => { const value = String(query._id) === actor && query.role === role ? { _id: actor, name: "Faculty Owner", role, accountStatus: "Active" } : null; const chain = { select: () => chain, lean: async () => value, session: () => Promise.resolve(value) }; return chain; });
  patch(mongoose, "startSession", async () => ({ withTransaction: async work => work(), endSession: async () => {} }));
  patch(ReportExport, "create", async values => { if (failMetadata) throw new Error("metadata failed"); const model = new ReportExport(values[0]); await model.validate(); metadata.push(model.toObject()); return [model]; });
  patch(AuditLog, "create", async values => { audits.push(...values); return values; });
  return { actor, role, records, metadata, audits, queries, restore: () => restores.reverse().forEach(fn => fn()) };
}

test("personal service generates only owned rows and atomically records forged-proof metadata and audit", async () => {
  const h = harness();
  try {
    const before = structuredClone(h.records);
    const result = await createFacultyReport({ startDate: "2026-01-01", endDate: "2026-01-31", status: "Completed" }, { id: h.actor, role: h.role, accountStatus: "Active" });
    assert.equal(result.total, 1); assert.equal(result.bytes.subarray(0, 4).toString(), "%PDF");
    assert.match(result.filename, /^faculty-consultation-report-2026-01-01-to-2026-01-31\.pdf$/);
    assert.ok(h.queries.every(query => String(query.faculty) === h.actor));
    assert.equal(h.metadata[0].requestingUser.toString(), h.actor); assert.equal(h.metadata[0].requestingRole, "faculty");
    assert.equal(h.metadata[0].reportType, "faculty_consultation_report"); assert.equal(h.metadata[0].dateBasis, "startAt");
    assert.equal(h.audits[0].action, "report_generated"); assert.equal(h.audits[0].actorRole, "faculty");
    assert.doesNotMatch(JSON.stringify(h.metadata), /records|bytes|Assigned Student|Algorithms/);
    assert.deepEqual(h.records, before);
  } finally { h.restore(); }
});

test("zero rows, PDF/metadata failures, unsupported actors and Dean personal scope never create false success", async () => {
  for (const scenario of [{ rows: [] }, { failMetadata: true }, { role: "dean" }]) {
    const h = harness(scenario);
    try {
      const actor = { id: h.actor, role: h.role, accountStatus: "Active" };
      if (scenario.role === "dean") {
        const result = await createFacultyReport({ startDate: "2026-01-01", endDate: "2026-01-31" }, actor);
        assert.equal(result.total, 1); assert.ok(h.queries.every(query => String(query.faculty) === h.actor)); assert.equal(h.metadata[0].requestingRole, "dean");
      } else {
        await assert.rejects(createFacultyReport({ startDate: "2026-01-01", endDate: "2026-01-31" }, actor));
        assert.equal(h.audits.length, 0); if (!scenario.failMetadata) assert.equal(h.metadata.length, 0);
      }
    } finally { h.restore(); }
  }
  await assert.rejects(createFacultyReport({ startDate: "2026-01-01", endDate: "2026-01-31" }, { id: id(), role: "student", accountStatus: "Active" }));
});

test("HTTP route returns authenticated PDF headers and rejects Students and injected ownership", async () => {
  const h = harness(), student = id(), originalFindById = User.findById;
  User.findById = async value => ({ _id: String(value), id: String(value), name: "Account", role: String(value) === student ? "student" : "faculty", accountStatus: "Active" });
  const server = await listen(), url = `http://127.0.0.1:${server.address().port}/api/faculty/reports/pdf`;
  const call = (actor, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(actor && { Authorization: `Bearer ${tokenFor(actor)}` }) }, body: JSON.stringify(body) });
  try {
    assert.equal((await call(null, {})).status, 401); assert.equal((await call(student, { startDate: "2026-01-01", endDate: "2026-01-31" })).status, 403);
    const response = await call(h.actor, { startDate: "2026-01-01", endDate: "2026-01-31" });
    assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /application\/pdf/); assert.match(response.headers.get("content-disposition"), /^attachment; filename="faculty-consultation-report-/); assert.equal(response.headers.get("cache-control"), "no-store");
    const injected = await call(h.actor, { startDate: "2026-01-01", endDate: "2026-01-31", facultyId: id() }); assert.equal(injected.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); User.findById = originalFindById; h.restore(); }
});

test("FAC-14 UI sends filters only, downloads/revokes a server PDF and contains no Faculty selector or AI controls", async () => {
  const [page, filters, route, service, pdf] = await Promise.all([read("../../client/src/pages/Faculty/FacultyReports.jsx"), read("../../client/src/components/reports/FacultyReportFilters.jsx"), read("../src/routes/facultyRoutes.js"), read("../src/services/facultyReportService.js"), read("../src/services/facultyReportPdfService.js")]);
  for (const copy of ["Faculty Reports", "Generate a PDF report", "Generating PDF...", "Start Date", "End Date", "Appointment Status", "Attendance Outcome", "Consultation Mode", "Generate PDF", "Clear Filters"]) assert.match(page + filters, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /api\.download\("\/faculty\/reports\/pdf"/); assert.match(page, /URL\.createObjectURL/); assert.match(page, /URL\.revokeObjectURL/); assert.match(page, /inFlight\.current/);
  assert.match(route, /req\.user\.id|postFacultyReport/); assert.match(service, /facultyReportQuery\(actor\.id/); assert.match(pdf, /new PDFDocument|Page \$\{page \+ 1\} of \$\{count\}/);
  for (const forbidden of [/facultyId/, /providerId/, /Faculty selector/, /school-wide/i, /Groq|OpenAI|LLM|ReportNarrativePanel/]) assert.doesNotMatch(page + filters + service + pdf, forbidden);
});
