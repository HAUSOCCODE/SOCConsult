import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import cloudinary from "../src/config/cloudinary.js";
import { env } from "../src/config/env.js";
import { changePassword, updateProfile, me } from "../src/controllers/authController.js";

const chain = value => ({ select() { return this; }, session() { return this; }, then(resolve, reject) { return Promise.resolve(typeof value === "function" ? value() : value).then(resolve, reject); } });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function harness(role = "dean") {
  const h = { user: { _id: new mongoose.Types.ObjectId(), id: new mongoose.Types.ObjectId().toString(), role, accountStatus: "Active", firstName: "Ana", lastName: "Reyes", name: "Ana Reyes", username: "configured", email: "official@example.edu", institutionalId: "ID1", accountSource: "manual", password: await bcrypt.hash("OldPassword1", 4), passwordResetToken: "SECRET", createdBy: "PRIVATE", profilePicture: undefined }, audits: [], writes: 0, ended: 0 };
  h.user.id = String(h.user._id);
  const restores = [];
  h.patch = (obj, key, value) => { const old = obj[key]; obj[key] = value; restores.push(() => { obj[key] = old; }); };
  h.restore = () => restores.reverse().forEach(fn => fn());
  h.session = { async withTransaction(work, options) {
    assert.equal(options.readConcern.level, "snapshot"); assert.equal(options.writeConcern.w, "majority");
    const before = structuredClone(h.user), audits = h.audits.slice();
    try { await work(); if (h.uncertain) throw { hasErrorLabel: label => label === "UnknownTransactionCommitResult" }; }
    catch (error) { if (!h.uncertain) { h.user = before; h.audits = audits; } throw error; }
  }, async endSession() { h.ended++; } };
  h.patch(mongoose, "startSession", async () => h.session);
  h.patch(User, "findById", () => chain(() => ({ ...h.user })));
  h.patch(User, "updateOne", async (filter, update, options) => {
    assert.equal(options.session, h.session); assert.equal(filter.password, h.user.password);
    if (h.conflict) return { modifiedCount: 0 };
    Object.assign(h.user, update.$set); h.writes++; return { modifiedCount: 1 };
  });
  h.patch(User, "findByIdAndUpdate", (id, update) => chain(() => { h.writes++; Object.assign(h.user, update); return h.user; }));
  h.patch(User, "findOneAndUpdate", (filter, update) => chain(() => {
    if (h.avatarConflict) return null;
    h.writes++; Object.assign(h.user, update.$set || update);
    if (update.$unset) delete h.user.profilePicture;
    return h.user;
  }));
  h.patch(AuditLog, "create", async (events, options) => {
    if (Array.isArray(events)) { assert.equal(options.session, h.session); if (h.auditFailure) throw new Error("SECRET provider audit failure"); for (const event of events) assert.equal(new AuditLog(event).validateSync(), undefined); h.audits.push(...events); }
    return events;
  });
  return h;
}
const passwordBody = (extra = {}) => ({ currentPassword: "OldPassword1", newPassword: "NewPassword2", confirmNewPassword: "NewPassword2", ...extra });

test("transactional password changes hash at cost 12, timestamp, sanitized audit, and preserve other roles", async () => {
  for (const role of ["dean", "student", "faculty"]) {
    const h = await harness(role);
    try {
      const res = response(); await changePassword({ user: h.user, body: passwordBody() }, res);
      assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { message: "Password changed successfully." }); assert.equal(bcrypt.getRounds(h.user.password), 12);
      assert.ok(await bcrypt.compare("NewPassword2", h.user.password)); assert.ok(h.user.passwordChangedAt instanceof Date);
      assert.equal(h.audits.length, 1); assert.equal(h.audits[0].action, "password_changed");
      assert.equal(h.audits[0].subjectRole, role); assert.equal(h.ended, 1);
      assert.doesNotMatch(JSON.stringify([res.body, h.audits]), /OldPassword1|NewPassword2|\$2[aby]\$|SECRET/);
    } finally { h.restore(); }
  }
});

test("audit failure rolls back password and timestamp; conflicts and uncertain commits are safe", async () => {
  for (const mode of ["auditFailure", "conflict", "uncertain"]) {
    const h = await harness(); const before = h.user.password; h[mode] = true;
    try {
      const res = response(); await changePassword({ user: h.user, body: passwordBody() }, res);
      assert.equal(res.statusCode, 503); assert.equal(res.body.code, mode === "uncertain" ? "PASSWORD_CHANGE_UNCERTAIN" : "PASSWORD_CHANGE_UNAVAILABLE"); assert.equal(h.ended, 1);
      if (mode !== "uncertain") { assert.equal(h.user.password, before); assert.equal(h.user.passwordChangedAt, undefined); assert.equal(h.audits.length, 0); }
      assert.doesNotMatch(JSON.stringify(res.body), /SECRET|provider|audit failure|\$2[aby]\$/);
    } finally { h.restore(); }
  }
});

test("password credentials, confirmation, policy, reuse and input types are validated", async () => {
  const h = await harness();
  try {
    for (const extra of [{ currentPassword: "wrong" }, { currentPassword: {} }, { newPassword: "weak", confirmNewPassword: "weak" }, { newPassword: "lowercase1", confirmNewPassword: "lowercase1" }, { newPassword: "NoNumberHere", confirmNewPassword: "NoNumberHere" }, { newPassword: "Password 2", confirmNewPassword: "Password 2" }, { confirmNewPassword: "mismatch" }, { newPassword: "OldPassword1", confirmNewPassword: "OldPassword1" }, { role: "dean" }]) {
      const res = response(); await changePassword({ user: h.user, body: passwordBody(extra) }, res); assert.equal(res.statusCode, 400); assert.equal(res.body.code, extra.newPassword === "OldPassword1" ? "PASSWORD_SAME" : "PASSWORD_INPUT_INVALID");
    }
    assert.equal(h.writes, 0); assert.equal(h.audits.length, 0);
  } finally { h.restore(); }
});

test("Dean profile allowlist and safe projection protect all identity and internal fields", async () => {
  const h = await harness();
  try {
    for (const key of ["role", "username", "email", "institutionalId", "studentId", "employeeId", "position", "specialization", "program", "yearLevel", "accountSource", "accountStatus", "password", "passwordChangedAt", "$set", "unknown"]) {
      const res = response(); await updateProfile({ user: h.user, body: { office: "Office", [key]: "injected" } }, res); assert.equal(res.statusCode, 400, key);
    }
    for (const body of [{ office: {} }, { contactNumber: "x".repeat(101) }, { office: "bad\nvalue" }, []]) {
      const res = response(); await updateProfile({ user: h.user, body }, res); assert.equal(res.statusCode, 400);
    }
    assert.equal(h.writes, 0);
    const res = response(); await updateProfile({ user: h.user, body: { firstName: " Anna ", middleName: "Q.", lastName: "Reyes", office: " Room 1 ", contactNumber: "123" } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.user.name, "Anna Q. Reyes"); assert.equal(res.body.user.office, "Room 1");
    assert.equal(res.body.user.role, "dean"); assert.equal(res.body.user.username, "configured");
    const read = response(); await me({ user: h.user }, read);
    assert.doesNotMatch(JSON.stringify(read.body), /SECRET|PRIVATE|passwordReset|createdBy/);
    assert.equal(read.body.user.password, undefined);
  } finally { h.restore(); }
});

async function http(h, work) {
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const token = jwt.sign({ sub: h.user.id }, env.jwtSecret, { expiresIn: "8h" });
  const request = (path, method = "GET", body, auth = token) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { Connection: "close", ...(auth && { Authorization: `Bearer ${auth}` }), ...(!(body instanceof FormData) && { "Content-Type": "application/json" }) }, ...(body !== undefined && { body: body instanceof FormData || typeof body === "string" ? body : JSON.stringify(body) }) });
  try { await work(request, token); } finally { await new Promise(resolve => server.close(resolve)); }
}

test("HTTP no-store, authentication, inactive access, parser sanitization, alternate paths and limits", async () => {
  const h = await harness();
  try { await http(h, async request => {
    let res = await request("/auth/me", "GET", undefined, null); assert.equal(res.status, 401); assert.equal(res.headers.get("Cache-Control"), "no-store");
    res = await request("/AUTH/ME", "PUT", '{"password":"SECRET"'); assert.equal(res.status, 400); assert.equal(res.headers.get("Cache-Control"), "no-store"); assert.doesNotMatch(await res.text(), /SECRET/);
    h.user.accountStatus = "Inactive"; assert.equal((await request("/auth/me")).status, 403); h.user.accountStatus = "Active";
    res = await request("/auth/me", "PUT", '{"password":"SECRET"'); assert.equal(res.status, 400); assert.equal(res.headers.get("Cache-Control"), "no-store"); assert.doesNotMatch(await res.text(), /SECRET/);
    res = await request("/auth/me", "PUT", { role: "faculty" }); assert.equal(res.status, 400);
    assert.equal((await request("/dean/settings/password", "PUT", passwordBody())).status, 404);
    for (let i = 0; i < 5; i++) assert.equal((await request("/auth/change-password", "PUT", passwordBody({ currentPassword: "wrong" }))).status, 400);
    res = await request("/auth/change-password", "PUT", passwordBody()); assert.equal(res.status, 429); assert.ok(res.headers.get("Retry-After"));
    for (let i = 0; i < 19; i++) assert.equal((await request("/auth/me", "PUT", { office: "Office" })).status, 200);
    assert.equal((await request("/auth/me", "PUT", { office: "Office" })).status, 429);
  }); } finally { h.restore(); }
});

test("avatar signature, size, type, replacement, cleanup failure and rollback cleanup", async () => {
  const h = await harness(); const destroyed = [];
  h.patch(cloudinary.uploader, "upload_stream", (options, callback) => {
    assert.equal(options.resource_type, "image"); return { end() { if (h.uploadFailure) callback(new Error("SECRET provider")); else callback(null, { secure_url: "https://example.com/new.png", public_id: "new-private-id", resource_type: "image" }); } };
  });
  h.patch(cloudinary.uploader, "destroy", async id => { destroyed.push(id); throw new Error("SECRET cleanup provider"); });
  const photo = (bytes, type = "image/png", name = "avatar.png") => { const form = new FormData(); form.append("photo", new Blob([bytes], { type }), name); return form; };
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0]);
  try { await http(h, async request => {
    for (const form of [photo("invalid"), photo(png, "image/svg+xml", "a.svg"), photo(new Uint8Array(4 * 1024 * 1024 + 1))]) {
      const res = await request("/auth/me/profile-picture", "PATCH", form); assert.equal(res.status, 400); assert.equal(res.headers.get("Cache-Control"), "no-store");
    }
    h.user.profilePicture = { url: "https://example.com/old.png", publicId: "old-private-id" };
    let res = await request("/auth/me/profile-picture", "PATCH", photo(png)); assert.equal(res.status, 200);
    const body = await res.json(); assert.equal(body.user.profilePicture, "https://example.com/new.png"); assert.doesNotMatch(JSON.stringify(body), /private-id|SECRET|publicId/); assert.ok(destroyed.includes("old-private-id"));
    h.avatarConflict = true; res = await request("/auth/me/profile-picture", "PATCH", photo(png)); assert.equal(res.status, 503); assert.ok(destroyed.includes("new-private-id")); assert.doesNotMatch(await res.text(), /SECRET|provider/);
    h.avatarConflict = false; h.uploadFailure = true; res = await request("/auth/me/profile-picture", "PATCH", photo(png)); assert.equal(res.status, 503); assert.doesNotMatch(await res.text(), /SECRET|provider/);
    h.uploadFailure = false;
    const injected = photo(png); injected.append("role", "faculty");
    res = await request("/auth/me/profile-picture", "PATCH", injected); assert.equal(res.status, 400);
    res = await request("/auth/me/profile-picture", "DELETE"); assert.equal(res.status, 200); assert.equal((await res.json()).user.profilePicture, undefined);
    for (let i = 0; i < 2; i++) assert.equal((await request("/auth/me/profile-picture", "PATCH", new FormData())).status, 400);
    assert.equal((await request("/auth/me/profile-picture", "DELETE")).status, 429);
  }); } finally { h.restore(); }
});

test("parallel password submissions are blocked and issued JWT still authenticates after change", async () => {
  const h = await harness(); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; }); const wait = new Promise(resolve => { release = resolve; });
  const original = User.updateOne;
  h.patch(User, "updateOne", async (...args) => { entered(); await wait; return original(...args); });
  try { await http(h, async request => {
    const first = request("/auth/change-password", "PUT", passwordBody()); await ready;
    assert.equal((await request("/auth/change-password", "PUT", passwordBody())).status, 409);
    release(); assert.equal((await first).status, 200); assert.equal(h.audits.length, 1);
    assert.equal((await request("/auth/me")).status, 200);
  }); } finally { release(); h.restore(); }
});

test("Student and Faculty profile payloads remain compatible and reject sensitive extras", async () => {
  for (const role of ["student", "faculty"]) {
    const h = await harness(role);
    try {
      const body = role === "student"
        ? { contactNumber: "123" }
        : { firstName: "Ana", middleName: "", lastName: "Reyes", contactNumber: "123", office: "Room 2", specialization: "Networks", position: "Professor" };
      const res = response(); await updateProfile({ user: h.user, body }, res);
      assert.equal(res.statusCode, 200); assert.equal(res.body.user.role, role);
      assert.equal(res.body.user.contactNumber, "123");
      if (role === "faculty") assert.equal(res.body.user.position, "Professor");
      const rejected = response(); await updateProfile({ user: h.user, body: { ...body, email: "other@example.edu" } }, rejected);
      assert.equal(rejected.statusCode, 400);
    } finally { h.restore(); }
  }
});

test("legacy current password whitespace is preserved while new passwords follow approved policy", async () => {
  const h = await harness();
  h.user.password = await bcrypt.hash(" old password ", 4);
  try {
    const res = response(); await changePassword({ user: h.user, body: passwordBody({ currentPassword: " old password " }) }, res);
    assert.equal(res.statusCode, 200); assert.ok(await bcrypt.compare("NewPassword2", h.user.password));
    assert.doesNotMatch(JSON.stringify(h.audits), /old password|NewPassword2|\$2[aby]\$/);
  } finally { h.restore(); }
});

test("concurrent avatar upload/remove and profile submissions are rejected while in flight", async () => {
  const h = await harness();
  let release, entered;
  let ready = new Promise(resolve => { entered = resolve; });
  let wait = new Promise(resolve => { release = resolve; });
  h.patch(cloudinary.uploader, "upload_stream", (_options, callback) => ({ end() { entered(); wait.then(() => callback(null, { secure_url: "https://example.com/a.png", public_id: "asset", resource_type: "image" })); } }));
  h.patch(cloudinary.uploader, "destroy", async () => {});
  try { await http(h, async request => {
    const form = new FormData(); form.append("photo", new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: "image/png" }), "a.png");
    const upload = request("/auth/me/profile-picture", "PATCH", form); await ready;
    assert.equal((await request("/auth/me/profile-picture", "DELETE")).status, 409);
    release(); assert.equal((await upload).status, 200);
    ready = new Promise(resolve => { entered = resolve; }); wait = new Promise(resolve => { release = resolve; });
    const original = User.findByIdAndUpdate;
    h.patch(User, "findByIdAndUpdate", (...args) => chain(async () => { entered(); await wait; return await original(...args); }));
    const profile = request("/auth/me", "PUT", { office: "Room 1" }); await ready;
    assert.equal((await request("/auth/me", "PUT", { office: "Room 2" })).status, 409);
    release(); assert.equal((await profile).status, 200); assert.equal(h.user.office, "Room 1");
  }); } finally { release(); h.restore(); }
});
