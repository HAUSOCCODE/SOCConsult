import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import { login } from "../src/controllers/authController.js";
import { env } from "../src/config/env.js";
import { publicNotification } from "../src/services/notificationService.js";
import { provisionedUser } from "../src/services/accountProvisioningService.js";

const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
const chain = value => ({ select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test("removed registration APIs return 404 without database reads or account creation", async () => {
  const originals = [User.findOne, User.findById, User.create];
  let calls = 0;
  User.findOne = User.findById = User.create = () => { calls++; throw new Error("Unexpected account access"); };
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    for (const role of ["student", "faculty", "dean", "admin", "program-chair"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register/${role}`, {
          method, headers: { "Content-Type": "application/json", Connection: "close" },
          body: JSON.stringify({ role: "dean", firstName: "Test", lastName: "Person" }), redirect: "manual",
        });
        assert.equal(res.status, 404);
        assert.equal(res.headers.get("location"), null);
      }
    }
    for (const path of ["/api/admin/users", "/api/ai/chat", "/api/chat"]) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", redirect: "manual", headers: { Connection: "close" } });
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("location"), null);
    }
    assert.equal(calls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); [User.findOne, User.findById, User.create] = originals; }
});

test("provisioned and legacy accounts use identical login and session eligibility without writes", async () => {
  const originals = [User.findOne, User.findById, User.updateOne, AuditLog.create];
  let current, writes = 0;
  User.findOne = () => chain(current);
  User.findById = () => chain(current);
  User.updateOne = () => { writes++; throw new Error("Eligibility must not update accounts"); };
  AuditLog.create = async records => records;
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const password = "Initial-id-1";
  const hash = await bcrypt.hash(password, 4);
  const originalHash = bcrypt.hash;
  bcrypt.hash = async () => hash;
  try {
    for (const role of ["student", "faculty"]) {
      for (const accountSource of ["csv", "manual", "self_registration"]) {
        const provisioned = accountSource !== "self_registration" ? (await provisionedUser({ valid: true, role,
          first_name: "Test", middle_name: "E.", last_name: "Person", institutional_id: password,
          official_email: `test@${role === "student" ? env.studentDomain : env.facultyDomain}`,
        }, { source: accountSource })).toObject() : { role, password: hash, accountSource };
        for (const registrationStatus of ["Approved", undefined, null, "Pending", "Rejected", "unknown"]) {
          for (const accountStatus of ["Active", "Inactive"]) {
            current = { ...provisioned, id: "507f1f77bcf86cd799439011", name: "Test Person", position: "Program Chair", registrationStatus, accountStatus };
            const before = JSON.stringify(current);
            const allowed = accountStatus === "Active" && (registrationStatus == null || registrationStatus === "Approved");
            const result = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
            await login({ params: { role }, body: { identifier: "test@example.test", password } }, result);
            assert.equal(result.statusCode, allowed ? 200 : 403, `${role}/${accountSource}/${registrationStatus}/${accountStatus}`);
            const session = await fetch(`${base}/me`, { headers: { Connection: "close", Authorization: `Bearer ${jwt.sign({ sub: current.id }, env.jwtSecret)}` } });
            assert.equal(session.status, allowed ? 200 : 403);
            if (allowed) {
              const body = await session.json();
              assert.equal(body.user.position, "Program Chair");
              assert.equal(body.user.registrationStatus, undefined);
            }
            assert.equal(JSON.stringify(current), before);
          }
        }
      }
    }
    current = { id: "507f1f77bcf86cd799439011", role: "dean", accountStatus: "Active", registrationStatus: "Approved" };
    const removedReport = await fetch(`http://127.0.0.1:${server.address().port}/api/dean/reports/user-registrations`, { headers: { Connection: "close", Authorization: `Bearer ${jwt.sign({ sub: current.id }, env.jwtSecret)}` } });
    assert.equal(removedReport.status, 404);
    assert.equal(writes, 0);
  } finally { await new Promise(resolve => server.close(resolve)); [User.findOne, User.findById, User.updateOne, AuditLog.create] = originals; bcrypt.hash = originalHash; }
});

test("historical Admin notification destinations normalize on read only and fail closed", () => {
  for (const [old, category, destination] of [
    ["registrations", "Management", "users"], ["users", "Management", "users"],
    ["appointments", "Consultation", "consultations"], ["consultation-overview", "Consultation", "consultations"],
    ["reports", "Report", "reports"], ["import", "Management", "import"],
    ["attendance-review", "Attendance", "attendance-review"],
  ]) {
    const row = { actionUrl: `/admin/${old}`, category, title: "Historical notice" };
    assert.equal(publicNotification(row, { role: "dean" }).actionUrl, `/dean/${destination}`);
    assert.equal(row.actionUrl, `/admin/${old}`);
    for (const role of ["student", "faculty"]) assert.equal(publicNotification(row, { role }).actionUrl, undefined);
    for (const suffix of ["?redirect=https://evil.test", "#fragment", "/../users", "%2fusers"]) {
      assert.equal(publicNotification({ ...row, actionUrl: row.actionUrl + suffix }, { role: "dean" }).actionUrl, undefined);
    }
  }
});

test("active source excludes removed features with explicit compatibility exceptions", () => {
  const client = new URL("../../client/src/", import.meta.url);
  function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(new URL(`${entry.name}/`, dir)) : /\.(jsx?|mjs)$/.test(entry.name) ? [new URL(entry.name, dir)] : []); }
  for (const file of files(client)) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\/admin\b|\/auth\/register|FacultyRegister|mode === "register"|pendingRegistrations|Program Chair/, file.pathname);
    assert.doesNotMatch(text, /(?:role|authorize)\s*[:=(][^\n]*["'](?:admin|program.?chair)["']/i, file.pathname);
  }
  assert.doesNotMatch(source("../src/controllers/authController.js"), /export async function register|self_registration|awaiting.*approval/i);
  assert.doesNotMatch(source("../src/routes/authRoutes.js"), /register/);
  assert.doesNotMatch(source("../src/config/database.js"), /updateMany|registrationStatus|isApproved/);
  const backend = new URL("../src/", import.meta.url);
  const exceptions = new Set([
    "services/deanAccountMigrationService.js", "services/notificationService.js",
    "controllers/auditController.js", "services/auditPolicy.js", "services/activityService.js",
    "config/env.js", // Deployment fallbacks and historical audit interpretation.
  ]);
  for (const file of files(backend)) {
    const relative = file.href.slice(backend.href.length);
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /authorize\([^)]*["'](?:admin|program.?chair)["']/i, relative);
    if (!exceptions.has(relative)) assert.doesNotMatch(text, /\/admin\b|["']admin["']/, relative);
    assert.doesNotMatch(text, /(?:router|app)\.(?:use|get|post|put|patch|delete)\([^\n]*["'](?:\/api)?\/(?:ai|chat)(?:[\/"'])/i, relative);
  }
  assert.doesNotMatch(source("../src/routes/deanRoutes.js"), /user-registrations|router\.(post|put|patch|delete)\("\/appointments/);
  const routes = source("../../client/src/App.jsx");
  assert.match(routes, /path="appointments" element=\{<ConsultationMonitoringRedirect/);
  assert.match(routes, /path="consultation-overview" element=\{<ConsultationMonitoringRedirect/);
  assert.match(source("../src/services/reportNarrativeAdapter.js"), /chat\.completions\.create/);
  // Explicit retained compatibility: status readers and migration/audit tooling.
  assert.match(source("../src/config/appointmentStatus.js"), /LEGACY_APPOINTMENT_STATUSES/);
  assert.match(source("../src/services/deanAccountMigrationService.js"), /"admin"/);
  assert.match(source("../src/controllers/auditController.js"), /role === "admin"/);
});
