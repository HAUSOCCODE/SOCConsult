import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import ReportExport from "../src/models/ReportExport.js";
import {
  APPOINTMENT_STATUSES,
  LEGACY_APPOINTMENT_STATUSES,
} from "../src/config/appointmentStatus.js";
import { ATTENDANCE_OUTCOMES } from "../src/config/attendance.js";
import {
  parseReportFilters,
  buildReport,
  safeParticipant,
} from "../src/services/deanReportService.js";
import {
  generateReportPdf,
  PDF_LIMIT,
} from "../src/services/deanReportPdfService.js";

const id = "1234567890abcdef12345678",
  filters = { start: "2026-10-01", end: "2026-10-16" };
const now = new Date("2026-10-16T02:00:00Z");
const row = {
  student: { name: "José Dela Cruz", email: "SECRET" },
  faculty: { name: "Ana Santos", password: "SECRET" },
  createdAt: now,
  startAt: now,
  endAt: now,
  status: "Completed",
  consultationMode: "Online",
  attendance: {
    finalOutcome: "Completed",
    finalizationSource: "dean_review",
    reason: "SECRET",
  },
  subject: "SECRET",
  notes: "SECRET",
  meetingLink: "SECRET",
};
const chain = (value) => {
  const q = { then: (yes, no) => Promise.resolve(value).then(yes, no) };
  for (const key of ["select", "session", "option"]) q[key] = () => q;
  return q;
};

test("report filters use strict canonical values and Manila request dates", () => {
  const parsed = parseReportFilters({
    ...filters,
    facultyId: id,
    status: "Completed",
    mode: "Online",
    attendanceOutcome: "Completed",
  });
  assert.equal(
    parsed.filter.createdAt.$gte.toISOString(),
    "2026-09-30T16:00:00.000Z",
  );
  assert.equal(
    parsed.filter.createdAt.$lt.toISOString(),
    "2026-10-16T16:00:00.000Z",
  );
  assert.equal(String(parsed.filter.faculty), id);
  assert.deepEqual(parsed.filter.$and, [
    {
      status: "Completed",
      "attendance.finalOutcome": "Completed",
      "attendance.finalizationSource": {
        $in: ["participant_agreement", "dean_review"],
      },
    },
  ]);
  for (const status of APPOINTMENT_STATUSES)
    assert.equal(
      parseReportFilters({ ...filters, status }).filter.status,
      status,
    );
  for (const attendanceOutcome of ATTENDANCE_OUTCOMES)
    assert.equal(
      parseReportFilters({ ...filters, attendanceOutcome }).filter.$and[0][
        "attendance.finalOutcome"
      ],
      attendanceOutcome,
    );
  for (const mode of ["Online", "Face-to-Face"])
    assert.equal(
      parseReportFilters({ ...filters, mode }).filter.consultationMode,
      mode,
    );
  parseReportFilters({ start: "2024-01-01", end: "2024-12-31" });
  for (const input of [
    null,
    [],
    "x",
    {},
    { start: filters.start },
    { ...filters, end: "2026-09-30" },
    { ...filters, start: "2026-02-30" },
    { start: "2024-01-01", end: "2025-01-01" },
    { ...filters, start: "2026-1-01" },
    { ...filters, facultyId: { $ne: null } },
    { ...filters, facultyId: "bad" },
    { ...filters, status: ["Completed"] },
    { ...filters, attendanceOutcome: "Present" },
    { ...filters, mode: "Remote" },
    { ...filters, total: 1 },
    { ...filters, studentId: id },
    { ...filters, start: filters.start + "\r\n" },
    ...LEGACY_APPOINTMENT_STATUSES.map((status) => ({ ...filters, status })),
  ])
    assert.throws(() => parseReportFilters(input), { statusCode: 400 });
});

test("same safe rows drive exhaustive totals, trusted outcomes and historical categories", () => {
  const rows = [
    row,
    {
      ...row,
      attendance: {
        finalOutcome: "Completed",
        finalizationSource: "participant_agreement",
      },
    },
    ...["Student No-show", "Faculty No-show"].map((finalOutcome) => ({
      ...row,
      attendance: { finalOutcome, finalizationSource: "dean_review" },
    })),
    { ...row, attendance: {} },
    { ...row, status: "Attendance Review" },
    { ...row, status: "Pending" },
    { ...row, status: "No Show", consultationMode: "bogus" },
  ];
  const report = buildReport(rows, filters, now);
  assert.equal(report.summary.total, 8);
  for (const counts of Object.values(report.summary).filter(
    (value) => typeof value === "object",
  ))
    assert.equal(
      Object.values(counts).reduce((a, b) => a + b, 0),
      8,
    );
  assert.equal(report.summary.attendance.Completed, 2);
  assert.equal(report.summary.attendance["Student No-show"], 1);
  assert.equal(report.summary.attendance["Faculty No-show"], 1);
  assert.equal(report.summary.attendance["Historical unverified Completed"], 1);
  assert.equal(report.summary.attendance["Attendance Review"], 1);
  assert.equal(report.summary.attendance["No verified final outcome"], 2);
  assert.equal(report.records.at(-1).status, "Legacy: No Show");
  assert.doesNotMatch(
    JSON.stringify(report),
    /SECRET|subject|email|password|meetingLink|reason|notes/,
  );
  for (const name of [
    "https://private.test",
    "token=secret",
    "student@example.test",
    "123456",
  ])
    assert.equal(safeParticipant({ name }), "Unavailable");
  assert.equal(safeParticipant({ name: "Bad\nName" }), "Bad Name");
  assert.equal(safeParticipant({ name: "José Dela Cruz" }), "José Dela Cruz");
});

// Decode PDFKit's embedded Unicode glyph map and page content, independently of renderer calls.
function pdfText(bytes) {
  const streams = [];
  const raw = bytes.toString("latin1");
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const end = raw.indexOf("\nendstream", match.index);
    if (end < 0) continue;
    try {
      streams.push(
        inflateSync(
          bytes.subarray(match.index + match[0].length, end),
        ).toString(),
      );
    } catch {
      /* non-compressed or non-text stream */
    }
  }
  const cmap = streams.find((text) => text.includes("begincmap")) || "";
  const glyphs = new Map();
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(
      /<([\da-f]+)>\s*<([\da-f]+)>\s*\[([^\]]+)\]/gi,
    )) {
      let glyph = parseInt(range[1], 16);
      for (const value of range[3].matchAll(/<([\da-f\s]+)>/gi))
        glyphs.set(
          glyph++,
          String.fromCharCode(
            ...value[1]
              .replace(/\s/g, "")
              .match(/.{4}/g)
              .map((hex) => parseInt(hex, 16)),
          ),
        );
    }
  }
  return streams
    .filter((text) => text.includes("BT"))
    .map((text) =>
      [...text.matchAll(/<([\da-f]+)>/gi)]
        .map((match) =>
          (match[1].match(/.{4}/g) || [])
            .map((hex) => glyphs.get(parseInt(hex, 16)) || "")
            .join(""),
        )
        .join(""),
    )
    .join("\n");
}

test("real Unicode PDFs contain safe report content, landscape pages, repeated headers and footer", async () => {
  const report = buildReport(
    Array.from({ length: 30 }, () => row),
    filters,
    now,
  );
  const bytes = await generateReportPdf(report);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length < PDF_LIMIT);
  const raw = bytes.toString("latin1"),
    text = pdfText(bytes);
  assert.match(raw, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.match(raw, /\/FontFile2/);
  for (const expected of [
    "SOC Consultation Report",
    "School of Computing",
    "Total consultations: 30",
    "José Dela Cruz",
    "Ana Santos",
    "Asia/Manila",
    "2026-10-01",
    "Completed",
    "Page 1 of",
    "Administrative reference",
  ])
    assert.ok(text.includes(expected), expected);
  assert.ok((text.match(/Request date/g) || []).length > 2);
  assert.doesNotMatch(text, /SECRET|1234567890abcdef|https:|student@/);
  const empty = pdfText(await generateReportPdf(buildReport([], filters, now)));
  assert.match(empty, /Total consultations: 0/);
  assert.match(empty, /No consultations match/);
  await assert.rejects(generateReportPdf(report, 100), { statusCode: 413 });
});

test("HTTP report authorization, bounded projection, atomic metadata/audit and sanitized failures", async () => {
  const previousGroqKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  const restores = [],
    staged = [],
    committed = [],
    pipelines = [];
  const patch = (object, key, replacement) => {
    const before = object[key];
    object[key] = replacement;
    restores.push(() => (object[key] = before));
  };
  let rows = [row],
    failure = "",
    active = true,
    ended = 0,
    retry = false,
    revoked = false;
  const session = {
    async withTransaction(work) {
      staged.length = 0;
      try {
        if (retry) {
          await work();
          staged.length = 0;
        }
        await work();
        committed.push(...staged);
      } catch (error) {
        staged.length = 0;
        throw error;
      }
    },
    async endSession() {
      ended++;
    },
  };
  patch(mongoose, "startSession", async () => session);
  patch(User, "findById", (value) => {
    const user = {
      _id: value,
      id: String(value),
      role: String(value).startsWith("s")
        ? "student"
        : String(value).startsWith("f")
          ? "faculty"
          : "dean",
      accountStatus: active ? "Active" : "Inactive",
      registrationStatus: "Approved",
    };
    const query = chain(user);
    query.session = () => chain(revoked ? { ...user, role: "faculty" } : user);
    return query;
  });
  patch(Appointment, "aggregate", (pipeline) => {
    pipelines.push(pipeline);
    if (failure === "query") throw new Error("SECRET");
    return {
      option(options) {
        assert.equal(options.maxTimeMS, 10000);
        return Promise.resolve(rows);
      },
    };
  });
  patch(Appointment, "populate", async (values, options) => {
    assert.equal(options.select, "name firstName middleName lastName -_id");
    return values;
  });
  patch(Notification, "create", async (records, options) => {
    assert.equal(options.session, session);
    if (failure === "notification") throw new Error("SECRET");
    assert.equal(records[0].category, "Report");
    assert.equal(records[0].actionUrl, "/dean/reports");
    assert.doesNotMatch(JSON.stringify(records), /SECRET|filters|snapshot|prompt/);
    return records;
  });
  patch(ReportExport, "create", async (values, options) => {
    assert.equal(options.session, session);
    if (failure === "metadata") throw new Error("SECRET");
    staged.push({ type: "metadata", ...values[0] });
    return [{ _id: id, ...values[0] }];
  });
  patch(AuditLog, "create", async (values, options) => {
    assert.equal(options.session, session);
    if (failure === "audit") throw new Error("SECRET");
    staged.push({ type: "audit", ...values[0] });
    return values;
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let sequence = 0;
  const request = (body = filters, role = "dean", suffix = "") =>
    fetch(
      `http://127.0.0.1:${server.address().port}/api/dean/reports/pdf${suffix}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(role && {
            Authorization: `Bearer ${jwt.sign({ sub: `${role}${++sequence}` }, env.jwtSecret)}`,
          }),
          Connection: "close",
        },
        body: JSON.stringify(body),
      },
    );
  try {
    for (const role of [null, "student", "faculty"]) {
      const response = await request(filters, role);
      assert.equal(response.status, role ? 403 : 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    active = false;
    assert.equal((await request()).status, 403);
    active = true;
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-report-total"), "1");
    assert.equal(
      response.headers.get("content-disposition"),
      'attachment; filename="SOCConsult_Report_2026-10-01_2026-10-16.pdf"',
    );
    assert.match(
      pdfText(Buffer.from(await response.arrayBuffer())),
      /José Dela Cruz/,
    );
    const pipeline = pipelines[0];
    assert.equal(pipeline[2].$limit, 1001);
    assert.equal(pipeline.at(-1).$project._id, 0);
    assert.doesNotMatch(
      JSON.stringify(pipeline.at(-1)),
      /reason|subject|notes|document|email|meeting/,
    );
    assert.equal(committed.length, 2);
    assert.equal(committed[0].summary.total, 1);
    assert.equal(committed[1].action, "report_generated");
    assert.doesNotMatch(
      JSON.stringify(committed),
      /José|Ana|SECRET|student|faculty|records|bytes/,
    );
    for (const mode of ["metadata", "audit", "query", "notification"]) {
      failure = mode;
      const count = committed.length;
      const failed = await request();
      assert.equal(failed.status, 503);
      assert.doesNotMatch(await failed.text(), /SECRET/);
      assert.equal(committed.length, count);
    }
    failure = "";
    rows = Array(1001).fill(row);
    assert.equal((await request()).status, 413);
    rows = [];
    retry = true;
    const empty = await request();
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get("x-report-total"), "0");
    assert.equal(committed.length, 4);
    assert.equal(committed.at(-2).summary.total, 0);
    revoked = true;
    const count = committed.length;
    assert.equal((await request()).status, 403);
    assert.equal(committed.length, count);
    revoked = false;
    retry = false;
    rows = Array(1000).fill(row);
    assert.equal((await request()).status, 200);
    assert.equal(committed.at(-2).summary.total, 1000);
    assert.equal(
      (await request({ ...filters, attendanceOutcome: "Present" })).status,
      400,
    );
    assert.equal((await request(filters, "dean", "?total=1")).status, 400);
    for (const [body, status] of [
      ['{"SECRET":', 400],
      [JSON.stringify({ SECRET: "x".repeat(2 * 1024 * 1024) }), 413],
    ]) {
      const invalid = await fetch(
        `http://127.0.0.1:${server.address().port}/api/dean/reports/pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Connection: "close" },
          body,
        },
      );
      assert.equal(invalid.status, status);
      assert.equal(invalid.headers.get("cache-control"), "no-store");
      assert.doesNotMatch(await invalid.text(), /SECRET/);
    }
    assert.ok(ended >= 4);
  } finally {
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
    await new Promise((resolve) => server.close(resolve));
    restores.reverse().forEach((restore) => restore());
  }
});

test("report path never imports AI services and bundled font includes redistribution license", async () => {
  for (const path of [
    "controllers/deanReportController.js",
    "services/deanReportService.js",
    "services/deanReportPdfService.js",
  ]) {
    const source = await readFile(
      new URL(`../src/${path}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /import[^\n]*(?:[Aa]i|groq)|fetch\(|chat\.completions|generateSummary/,
    );
  }
  assert.match(
    await readFile(
      new URL("../src/assets/fonts/OFL.txt", import.meta.url),
      "utf8",
    ),
    /SIL OPEN FONT LICENSE/,
  );
});

test("ReportExport blocks application mutations and rejects extra private fields", async () => {
  const metadata = new ReportExport({
    dean: id,
    reportType: "soc_consultations_pdf",
    generatedAt: now,
    dateBasis: "createdAt",
    timezone: "Asia/Manila",
    filters,
    summary: buildReport([], filters, now).summary,
  });
  await metadata.validate();
  assert.throws(
    () => new ReportExport({ ...metadata.toObject(), bytes: "SECRET" }),
    /strict mode/,
  );
  for (const operation of [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ])
    await assert.rejects(ReportExport[operation]({}, {}), /immutable/);
  await assert.rejects(
    ReportExport.bulkWrite([{ deleteMany: { filter: {} } }]),
    /immutable/,
  );
  metadata.isNew = false;
  await assert.rejects(metadata.save(), /immutable/);
});
