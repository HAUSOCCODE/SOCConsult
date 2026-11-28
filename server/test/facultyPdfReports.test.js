import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
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

function inflatedStreams(bytes) {
  const source = bytes.toString("latin1");
  const xref = /startxref\n(\d+)\n%%EOF\s*$/.exec(source);
  assert.ok(xref, "PDFKit output has a cross-reference table");
  const table = source.slice(Number(xref[1])).split("\ntrailer\n", 1)[0];
  assert.match(table, /^xref\n/);
  return [...table.matchAll(/^(\d{10}) 00000 n $/gm)].flatMap(([, offset]) => {
    const header = /^\d+ 0 obj\n<<\n([^]*?)\n(?:>>\nstream\n|endobj\n)/.exec(source.slice(Number(offset)));
    if (!header?.[0].endsWith("\nstream\n")) return [];
    assert.match(header[1], /(?:^|\n)\/Filter \/FlateDecode(?:\n|$)/);
    const length = /(?:^|\n)\/Length (\d+)(?:\n|$)/.exec(header[1]);
    assert.ok(length, "PDFKit stream declares its compressed byte length");
    const start = Number(offset) + header[0].length;
    const end = start + Number(length[1]);
    // The last compressed byte can be CR. Only the LF after /Length bytes is a delimiter.
    assert.equal(source.slice(end, end + 11), "\nendstream\n");
    return [inflateSync(bytes.subarray(start, end)).toString()];
  });
}

test("PDF stream extraction preserves a compressed payload ending in a carriage return", async () => {
  const pdf = new PDFDocument({ autoFirstPage: false });
  const chunks = [];
  const collected = new Promise((resolve, reject) => {
    pdf.on("data", chunk => chunks.push(chunk));
    pdf.once("end", () => resolve(Buffer.concat(chunks)));
    pdf.once("error", reject);
  });
  pdf.ref().end("ZZN");
  pdf.end();
  const bytes = await collected;
  assert.match(bytes.toString("latin1"), /\r\nendstream\n/);
  assert.deepEqual(inflatedStreams(bytes), ["ZZN\n"]);
});

function renderedPages(bytes) {
  const streams = inflatedStreams(bytes);
  const cmap = streams.find(stream => stream.includes("begincmap"));
  const glyphs = new Map();
  for (const [, start, values] of cmap.matchAll(/<(\w+)>\s*<\w+>\s*\[([^\]]+)\]/g)) {
    let glyph = parseInt(start, 16);
    for (const [, value] of values.matchAll(/<([\da-f\s]+)>/gi)) {
      glyphs.set(glyph++, String.fromCharCode(...value.replace(/\s/g, "").match(/.{4}/g).map(hex => parseInt(hex, 16))));
    }
  }
  return streams.filter(stream => stream.startsWith("1 0 0 -1 0 595.28 cm")).map(stream =>
    [...stream.matchAll(/<([\da-f]+)>/gi)].map(([, run]) =>
      run.match(/.{4}/g).map(hex => glyphs.get(parseInt(hex, 16))).join("")).join(""));
}

test("a one-row PDF has its page number on the same page as the table", async () => {
  const now = new Date("2026-01-03T01:00:00Z");
  const report = buildFacultyReport([{ status: "Expired", subject: "Synthetic course", startAt: now }],
    { name: "Professor Example" }, { startDate: "2026-01-01", endDate: "2026-01-31" }, now);
  const pages = renderedPages(await generateFacultyReportPdf(report));
  assert.equal(pages.length, 1);
  assert.match(pages[0], /Synthetic course.*Page 1 of 1$/);
});

test("PDF keeps long fields and student ID intact and puts each footer on its own data page", async () => {
  const filters = { startDate: "2026-01-01", endDate: "2026-01-31" };
  const now = new Date("2026-01-03T01:00:00Z");
  const faculty = { firstName: "María Alejandra Celestina".repeat(3), lastName: "Dela Cruz" };
  const row = {
    student: {
      firstName: "María Alejandra Celestina Esperanza Valentina Magdalena Catalina de la Cruz",
      middleName: "Isabel Josefina Rosalinda Francisca Victoria Carolina Antonieta del Rosario",
      lastName: "Fernández de los Santos Villanueva Montenegro Cristóbal",
      studentId: "DEMO-FULL-ID",
    },
    subject: "Advanced Software Engineering and Human Computer Interaction ".repeat(2) + "Capstone Review",
    reason: ("W".repeat(12) + " ").repeat(75) + "Final concern sentence.",
    startAt: now, consultationMode: "Online", status: "Expired",
  };
  const report = buildFacultyReport([row], faculty, filters, now);
  assert.equal(report.records[0].concern, row.reason);
  const single = renderedPages(await generateFacultyReportPdf(report));
  assert.equal(single.length, 1);
  for (const text of ["María", "Cristóbal", "DEMO-FULL-ID", "Capstone Review", "Final concern sentence.", "Expired", "Page 1 of 1"])
    assert.ok(single[0].includes(text), `Missing rendered text: ${text}`);
  const ordinary = { ...row, student: { name: "Fictional Learner" }, subject: "Algorithms", reason: "Review examples." };
  const multiple = renderedPages(await generateFacultyReportPdf(buildFacultyReport(
    Array.from({ length: 34 }, (_, index) => ({ ...(index === 11 ? row : ordinary), subject: `Synthetic course ${index + 1}` })),
    faculty, filters, now,
  )));
  assert.ok(multiple.length > 1);
  multiple.forEach((page, index) => {
    assert.match(page, /Student \/ ID.*Attendance Outcome.*Synthetic course/);
    assert.ok(page.endsWith(`Page ${index + 1} of ${multiple.length}`));
  });
  assert.deepEqual([...multiple.join("").matchAll(/Synthetic course (\d+)/g)].map(match => +match[1]),
    Array.from({ length: 34 }, (_, index) => index + 1));
});

test("report keeps a historical appointment whose populated Student account is unavailable", () => {
  const row = { student: null, status: "Completed" };
  const report = buildFacultyReport([row], { name: "Professor Example" }, {}, new Date());
  assert.equal(report.summary.total, 1);
  assert.equal(report.records[0].student, "Student unavailable");
  assert.equal(report.records[0].institutionalId, "—");
  assert.equal(report.records[0].attendanceOutcome, "Not finalized");
});

function harness({ rows = null, role = "faculty", failMetadata = false } = {}) {
  const actor = id(), student = id(), records = rows || [{ _id: id(), student: { _id: student, name: "Assigned Student", studentId: "S-1" }, subject: "Algorithms", reason: "Review", startAt: new Date("2026-01-10T01:00:00Z"), consultationMode: "Online", status: "Completed", attendance: { finalOutcome: "Completed" } }];
  const restores = [], metadata = [], audits = [], queries = [];
  const patch = (object, key, value) => { const original = object[key]; object[key] = value; restores.push(() => object[key] = original); };
  patch(Appointment, "find", query => { queries.push(query); const chain = { select: () => chain, populate: () => chain, sort: () => chain, limit: () => chain, lean: async () => typeof records === "function" ? records(query, actor) : records }; return chain; });
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

test("Faculty export filters select matching records and totals at Manila day boundaries", async () => {
  const start = "2026-01-09T16:00:00.000Z";
  const end = "2026-01-10T15:59:59.999Z";
  const fixtures = [
    ["Completed", "Completed", "Online", start],
    ["Cancelled", null, "Face-to-Face", end],
    ["Rejected", null, "Online", start],
    ["Expired", null, "Face-to-Face", start],
    ["Attendance Review", null, "Online", end],
    ["Completed", "Student No-show", "Online", end],
    ["Completed", "Faculty No-show", "Face-to-Face", end],
    ["Completed", null, "Online", end],
    ["Completed", "Completed", "Online", "2026-01-09T15:59:59.999Z"],
    ["Completed", "Completed", "Online", "2026-01-10T16:00:00.000Z"],
    ["Completed", "Completed", "Online", start, id()],
  ];
  const h = harness({ rows(query, owner) {
    return fixtures.map(([status, finalOutcome, consultationMode, instant, faculty = owner], index) => ({
      status, attendance: { finalOutcome }, consultationMode, startAt: new Date(instant), faculty, subject: `Fixture ${index + 1}`,
    })).filter(row =>
      row.faculty === query.faculty &&
      (query.status.$in?.includes(row.status) ?? row.status === query.status) &&
      row.startAt >= query.startAt.$gte && row.startAt < query.startAt.$lt &&
      (!query.consultationMode || query.consultationMode === row.consultationMode) &&
      (!query["attendance.finalOutcome"] || query["attendance.finalOutcome"] === row.attendance.finalOutcome));
  } });
  const actor = { id: h.actor, role: h.role, accountStatus: "Active" };
  const period = { startDate: "2026-01-10", endDate: "2026-01-10" };
  try {
    for (const [filter, expected] of [
      [{}, [1, 2, 3, 4, 5, 6, 7, 8]],
      [{ status: "Completed" }, [1, 6, 7, 8]],
      [{ status: "Cancelled" }, [2]],
      [{ status: "Rejected" }, [3]],
      [{ status: "Expired" }, [4]],
      [{ status: "Attendance Review" }, [5]],
      [{ attendanceOutcome: "Completed" }, [1]],
      [{ attendanceOutcome: "Student No-show" }, [6]],
      [{ attendanceOutcome: "Faculty No-show" }, [7]],
      [{ mode: "Online" }, [1, 3, 5, 6, 8]],
      [{ mode: "Face-to-Face" }, [2, 4, 7]],
      [{ status: "Expired", mode: "Face-to-Face" }, [4]],
    ]) {
      const result = await createFacultyReport({ ...period, ...filter }, actor);
      assert.equal(result.total, expected.length);
      const pdf = renderedPages(result.bytes).join("");
      assert.deepEqual([...pdf.matchAll(/Fixture (\d+)/g)].map(match => +match[1]), expected);
      assert.ok(pdf.includes(`Total consultation records: ${expected.length}Appointment Status:`));
      if (!Object.keys(filter).length) {
        assert.match(pdf, /Jan 10, 2026, 00:00.*Jan 10, 2026, 23:59/);
        assert.match(pdf, /Completed: 4 \| Cancelled: 1 \| Rejected: 1 \| Expired: 1 \| Attendance Review: 1/);
        assert.match(pdf, /Completed: 1 \| Student No-show: 1 \| Faculty No-show: 1 \| Not finalized: 5/);
      }
    }
    await assert.rejects(createFacultyReport({ ...period, status: "Expired", attendanceOutcome: "Completed" }, actor), { statusCode: 404 });
    await assert.rejects(createFacultyReport({ ...period, status: "Request Timed Out" }, actor), { statusCode: 400 });
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
