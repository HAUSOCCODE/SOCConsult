import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import { login } from "../src/controllers/authController.js";
import { env } from "../src/config/env.js";

const chain = value => ({ select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const response = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });

test("Student failures share one private contract; legacy successes retain exact passwords and JWT policy", async () => {
  const originals = [User.findOne, AuditLog.create, bcrypt.compare, User.findById];
  const password = " Exact legacy password1 ";
  const id = String(new mongoose.Types.ObjectId());
  const base = { id, _id: id, role: "student", accountStatus: "Active", email: "student@student.hau.edu.ph", password: await bcrypt.hash(password, 4) };
  let account = null, compares = [], audits = [];
  User.findOne = filter => { assert.deepEqual(filter, { email: base.email }); return chain(account); };
  User.findById = () => chain(account);
  AuditLog.create = async event => { audits.push(event); };
  bcrypt.compare = async (input, hash) => { compares.push({ input, rounds: bcrypt.getRounds(hash) }); return originals[2](input, hash); };
  const attempt = async (input = password) => { const res = response(); await login({ params: { role: "student" }, body: { identifier: " STUDENT@STUDENT.HAU.EDU.PH ", password: input } }, res); return res; };
  const denied = async input => {
    const result = await attempt(input);
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.body, { message: "Invalid email or password." });
    assert.doesNotMatch(JSON.stringify(result.body), /student@|Exact|registrationStatus|accountStatus|token|password.*1/);
    assert.equal(audits.length, 0, "failed attempts never create successful login events");
  };
  try {
    await denied(); assert.equal(compares.at(-1).rounds, 12, "missing user uses a valid cost-12 hash");
    assert.equal(compares.at(-1).input, password);
    account = { ...base }; await denied("wrong"); await denied(password.trim());
    for (const fields of [{ role: "faculty" }, { role: "dean" }, { accountStatus: "Inactive" }, { accountStatus: "Unknown" },
      { accountStatus: undefined }, { registrationStatus: "Pending" }, { registrationStatus: "Rejected" }, { registrationStatus: "Unknown" }]) {
      account = { ...base, ...fields }; await denied();
    }
    for (const registrationStatus of ["Approved", null, undefined]) {
      account = { ...base, ...(registrationStatus !== undefined && { registrationStatus }) };
      const before = { ...account };
      const success = await attempt(); assert.equal(success.statusCode, 200);
      const payload = jwt.verify(success.body.token, env.jwtSecret);
      assert.equal(payload.sub, id); assert.equal(payload.exp - payload.iat, 8 * 3600);
      assert.deepEqual(Object.keys(payload).sort(), ["authRevision", "exp", "iat", "sub"]);
      assert.equal(payload.authRevision, 0);
      assert.equal(success.body.user.password, undefined); assert.equal(success.body.user.registrationStatus, undefined);
      assert.deepEqual(account, before, "login never normalizes legacy accounts");
    }
  } finally { [User.findOne, AuditLog.create, bcrypt.compare, User.findById] = originals; }
});

test("Student HTTP failures, parser and database errors are sanitized, no-store, and rate limited", async () => {
  const original = User.findOne, originalError = console.error;
  const logs = []; console.error = (...args) => logs.push(args);
  User.findOne = () => chain(null);
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const request = body => fetch(`http://127.0.0.1:${server.address().port}/api/auth/login/student`, {
    method: "POST", headers: { "Content-Type": "application/json", Connection: "close" }, body,
  });
  try {
    let res = await request(JSON.stringify({ identifier: "PRIVATE_IDENTIFIER", password: "PRIVATE_PASSWORD" }));
    assert.equal(res.status, 401); assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { message: "Invalid email or password." });
    res = await request('{"password":"PRIVATE_PASSWORD"'); assert.equal(res.status, 400); assert.doesNotMatch(await res.text(), /PRIVATE/);
    User.findOne = () => { throw new Error("PRIVATE_DATABASE_IDENTIFIER"); };
    res = await request('{"identifier":"PRIVATE_IDENTIFIER","password":"PRIVATE_PASSWORD"}');
    assert.equal(res.status, 503); assert.deepEqual(await res.json(), { code: "AUTH_UNAVAILABLE", message: "Authentication temporarily unavailable." });
    assert.deepEqual(logs, []);
    for (let i = 0; i < 48; i++) assert.equal((await request("{}")).status, 401);
    res = await request("{}"); assert.equal(res.status, 429);
    assert.match((await res.json()).message, /Too many authentication attempts/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); User.findOne = original; console.error = originalError; }
});
