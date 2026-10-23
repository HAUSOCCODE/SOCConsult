import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const token = id => jwt.sign({ sub: id }, env.jwtSecret);

test("Dean reporting narrative endpoints deny Student and Faculty roles", async () => {
  const identities = {
    student: new mongoose.Types.ObjectId().toString(),
    faculty: new mongoose.Types.ObjectId().toString(),
    dean: new mongoose.Types.ObjectId().toString(),
  };
  const original = User.findById;
  User.findById = async id => {
    const role = Object.entries(identities).find(([, value]) => value === String(id))?.[0];
    return role ? { _id: String(id), id: String(id), role, accountStatus: "Active", registrationStatus: "Approved" } : null;
  };
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/dean/reports/ai-summaries?invalid=1`;
  try {
    for (const role of ["student", "faculty"]) {
      const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token(identities[role])}`, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(response.status, 403, role);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const dean = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token(identities.dean)}`, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(dean.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    User.findById = original;
  }
});

test("AI remains isolated to Dean reporting and absent from personal Faculty reports", async () => {
  const [deanRoutes, facultyRoutes, facultyService, facultyPdf, narrative] = await Promise.all([
    source("routes/deanRoutes.js"),
    source("routes/facultyRoutes.js"),
    source("services/facultyReportService.js"),
    source("services/facultyReportPdfService.js"),
    source("services/reportNarrativeService.js"),
  ]);
  assert.match(deanRoutes, /router\.use\(authenticate, authorize\("dean"\)\)/);
  assert.match(deanRoutes, /\/reports\/ai-summaries/);
  assert.doesNotMatch(facultyRoutes, /ai-summaries|narrative|Groq/i);
  assert.doesNotMatch(facultyService + facultyPdf, /reportNarrative|Groq|generateNarrative|ai-summaries/i);
  assert.match(narrative, /actor\?\.role !== "dean"/);
  assert.match(narrative, /human-reviewed|reviewed by the Dean/i);
});
