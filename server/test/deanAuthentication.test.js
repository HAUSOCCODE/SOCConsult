import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import { login, changePassword } from "../src/controllers/authController.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const chain = (value) => ({ select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test("Dean credentials, equivalent failures, and safe authentication audit", async () => {
  const originals = { findOne: User.findOne, findById: User.findById, create: AuditLog.create };
  const id = new mongoose.Types.ObjectId();
  const password = " legacy password ";
  let account = { _id: id, id: String(id), role: "dean", accountStatus: "Active", username: "management", password: await bcrypt.hash(password, 4) };
  const events = [];
  User.findOne = (query) => { assert.deepEqual(query, { username: "management" }); return chain(account); };
  User.findById = () => chain(account);
  AuditLog.create = async (event) => { assert.equal(new AuditLog(event).validateSync(), undefined); events.push(event); return event; };
  const attempt = async (body) => { const res = response(); await login({ params: { role: "dean" }, body }, res); return res; };
  try {
    const valid = { username: " Management ", password, role: "student" };
    const success = await attempt(valid);
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.user.id, String(id));
    assert.equal(success.body.user.role, "dean");
    assert.equal("password" in success.body.user, false);
    assert.equal(jwt.verify(success.body.token, env.jwtSecret).sub, String(id));
    assert.equal(events.at(-1).action, "login");
    assert.equal(events.at(-1).actorRole, "dean");
    const reject = async (body) => {
      const result = await attempt(body);
      assert.equal(result.statusCode, 401);
      assert.deepEqual(result.body, { message: "Invalid credentials." });
      const event = events.at(-1);
      assert.equal(event.action, "login_failed");
      assert.equal(event.actorRole, "system");
      assert.deepEqual(event.metadata, { role: "dean" });
      assert.doesNotMatch(JSON.stringify(event), /management|legacy password|password|token|authorization/i);
      return event;
    };
    assert.equal(String((await reject({ ...valid, password: "wrong" })).subjectUser), String(id));
    await reject({ ...valid, password: password.trim() });
    account.accountStatus = "Inactive";
    await reject(valid);
    account.accountStatus = "Active";
    for (const role of ["student", "faculty"]) { account.role = role; await reject(valid); }
    account.role = "dean";
    for (const body of [undefined, {}, { username: null, password }, { username: [], password }, { username: {}, password }, { username: 1, password }, { username: "management", password: {} }, { username: "management", password: [] }, { username: "management", password: 1 }, { username: "management", password: null }, { username: "", password }, { username: "management", password: "" }]) {
      assert.equal((await reject(body)).subjectUser, undefined);
    }
    account = null;
    assert.equal((await reject(valid)).subjectUser, undefined);
  } finally { User.findOne = originals.findOne; User.findById = originals.findById; AuditLog.create = originals.create; }
});

test("Dean password change preserves safe existing audit behavior", async () => {
  const originalFind = User.findById, originalCreate = AuditLog.create;
  const id = new mongoose.Types.ObjectId();
  const events = [];
  let saved = false;
  const user = { _id: id, id: String(id), role: "dean", password: await bcrypt.hash(" old password ", 4), async save() { saved = true; } };
  User.findById = () => chain(user);
  AuditLog.create = async (event) => { events.push(event); return event; };
  try {
    const res = response();
    await changePassword({ user, body: { currentPassword: " old password ", newPassword: "NewPassword1", confirmNewPassword: "NewPassword1" } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(saved);
    assert.ok(await bcrypt.compare("NewPassword1", user.password));
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "password_changed");
    assert.deepEqual(events[0].metadata, { role: "dean" });
    assert.doesNotMatch(JSON.stringify(events[0]), /old password|NewPassword1|\$2[aby]\$/);
  } finally { User.findById = originalFind; AuditLog.create = originalCreate; }
});

test("HTTP logout authentication, audit and existing Dean login limiter", async () => {
  const originalFind = User.findById, originalOne = User.findOne, originalCreate = AuditLog.create;
  const id = new mongoose.Types.ObjectId();
  const user = { _id: id, id: String(id), role: "dean", accountStatus: "Active" };
  const events = [];
  let queries = 0;
  User.findById = () => chain(user);
  User.findOne = () => { queries++; return chain(null); };
  AuditLog.create = async (event) => { events.push(event); return event; };
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const request = (path, body, token) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Connection: "close", ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body || {}) });
  try {
    assert.equal((await request("/logout")).status, 401);
    const token = jwt.sign({ sub: String(id) }, env.jwtSecret);
    assert.equal((await request("/logout", {}, token)).status, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "logout");
    assert.deepEqual(events[0].metadata, { role: "dean" });
    assert.ok(!JSON.stringify(events[0]).includes(token));
    assert.equal((await request("/register/dean")).status, 404);
    // Registration and login share the existing 50-request budget.
    for (let i = 0; i < 49; i++) assert.equal((await request("/login/dean", { username: "unknown", password: "wrong" })).status, 401);
    assert.equal(queries, 49);
    for (const username of ["unknown", "management"]) {
      const limited = await request("/login/dean", { username, password: "wrong" });
      assert.equal(limited.status, 429);
      assert.deepEqual(await limited.json(), { message: "Too many authentication attempts. Please try again later." });
      assert.ok(Number(limited.headers.get("Retry-After")) > 0);
    }
    assert.equal(queries, 49);
  } finally { await new Promise(resolve => server.close(resolve)); User.findById = originalFind; User.findOne = originalOne; AuditLog.create = originalCreate; }
});

test("workspace source contracts preserve one session and wait for hydration", async () => {
  const source = async (path) => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
  const [context, routes, guard, dean, faculty, form, layout] = await Promise.all(["context/AuthContext.jsx", "App.jsx", "components/ProtectedRoute.jsx", "layouts/DeanLayout.jsx", "layouts/FacultyLayout.jsx", "components/auth/AuthPageContent.jsx", "components/RoleLayout.jsx"].map(source));
  assert.match(routes, /ProtectedRoute role=\{\["faculty", "dean"\]\}/);
  assert.match(dean, /path: "\/faculty\/dashboard"/);
  assert.match(faculty, /user\?\.role === "dean"/);
  assert.match(faculty, /path: "\/dean\/dashboard"/);
  assert.doesNotMatch(dean + faculty, /sessionStorage|login\(|logout\(/);
  assert.ok(guard.indexOf("if (loading)") < guard.indexOf("if (!user)"));
  assert.match(context, /api\("\/auth\/me"\)/);
  assert.match(context, /sessionStorage.getItem\("consultio_token"\)/);
  assert.match(context, /finally \{[\s\S]*sessionStorage.removeItem\("consultio_token"\)/);
  assert.match(context, /setTimeout\(\(\) => controller.abort\(\), 5000\)/);
  assert.match(layout, /await logout\(\);\s*navigate/);
  assert.match(form, /password: mode === "login" \? e.target.value :/);
  assert.match(form, /minLength=\{mode === "register" \? 8 : undefined\}/);
});

test("client logout clears its session after success, server failure, or timeout", async () => {
  const context = await readFile(new URL("../../client/src/context/AuthContext.jsx", import.meta.url), "utf8");
  // Exercise the actual non-JSX logout function without adding a client framework.
  const body = context.slice(context.indexOf("  const logout = async () => {") + "  const logout = async () => {".length, context.indexOf("  const updateUser"));
  const functionBody = body.slice(0, body.lastIndexOf("  };"));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const mode of ["success", "failure", "timeout"]) {
    const storage = new Map([["consultio_token", "session-token"], ["consultio_user", "dean"]]);
    let currentUser = "dean";
    let called = false;
    const api = async (path, options) => {
      called = true;
      assert.equal(path, "/auth/logout");
      assert.equal(options.method, "POST");
      assert.equal(storage.get("consultio_token"), "session-token");
      if (mode === "failure") throw new Error("Server unavailable");
      if (mode === "timeout") await new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }));
    };
    const run = new AsyncFunction("api", "sessionStorage", "setUser", "AbortController", "setTimeout", "clearTimeout", functionBody);
    await run(api, { removeItem: key => storage.delete(key) }, value => { currentUser = value; }, AbortController, (callback, delay) => { assert.equal(delay, 5000); return setTimeout(callback, 5); }, clearTimeout);
    assert.ok(called);
    assert.equal(storage.size, 0);
    assert.equal(currentUser, null);
  }
});
