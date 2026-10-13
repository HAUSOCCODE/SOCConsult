import bcrypt from "bcryptjs";
import { login } from "../src/controllers/authController.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import Appointment from "../src/models/Appointment.js";
import { authenticate } from "../src/middleware/auth.js";
import {
  listManagedUsers,
  readManagedUser,
  changeManagedUserStatus,
  parseUserQuery,
  resetManagedUserPassword,
  resolveResetInstitutionalId,
} from "../src/services/userManagementService.js";

const id = () => new mongoose.Types.ObjectId().toString();
const actor = id();
const account = (extra = {}) => ({
  _id: id(),
  name: "Juan Santos",
  email: "juan@student.hau.edu.ph",
  role: "student",
  institutionalId: "000123",
  accountSource: "csv",
  accountStatus: "Active",
  registrationStatus: "Approved",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  password: "SECRET_HASH",
  token: "SECRET_TOKEN",
  passwordResetToken: "SECRET_RESET",
  contactNumber: "PRIVATE_CONTACT",
  ...extra,
});
function matches(user, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((part) => matches(user, part));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("$in" in value) return value.$in.includes(user[key]);
      if ("$exists" in value) return Object.hasOwn(user, key) === value.$exists;
      if ("$regex" in value)
        return new RegExp(value.$regex, value.$options).test(user[key] || "");
    }
    return value instanceof Date
      ? user[key]?.getTime() === value.getTime()
      : String(user[key]) === String(value);
  });
}
function harness(initial = [account()]) {
  const restores = [];
  const patch = (object, key, value) => {
    const old = object[key];
    object[key] = value;
    restores.push(() => {
      object[key] = old;
    });
  };
  const h = {
    users: structuredClone(initial),
    audits: [],
    reads: [],
    writes: [],
    role: "dean",
    ended: 0,
    deletions: 0,
  };
  const session = {
    async withTransaction(work, options) {
      // Model the driver's retry/serialization of contending transactions without a DB.
      let release;
      if (h.serializeTransactions) {
        const previous = h.transactionTail || Promise.resolve();
        h.transactionTail = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
      }
      assert.equal(options.readConcern.level, "snapshot");
      assert.equal(options.writeConcern.w, "majority");
      const before = structuredClone({ users: h.users, audits: h.audits });
      try {
        if (h.unsupported) throw new Error("private topology detail");
        await work();
        if (h.retry) {
          h.users = structuredClone(before.users);
          h.audits = structuredClone(before.audits);
          await work();
        }
        if (h.uncertain)
          throw {
            hasErrorLabel: (label) =>
              label === "UnknownTransactionCommitResult",
          };
      } catch (error) {
        if (!h.uncertain) {
          h.users = before.users;
          h.audits = before.audits;
        }
        throw error;
      } finally {
        release?.();
      }
    },
    async endSession() {
      h.ended++;
    },
  };
  patch(mongoose, "startSession", async () => {
    if (h.sessionFailure) throw new Error("private connection detail");
    return session;
  });
  const chain = (filter, one = false) => {
    const query = {
      select(value) {
        h.reads.push({ filter, projection: value });
        return this;
      },
      session(value) {
        assert.equal(value, session);
        return this;
      },
      sort(value) {
        this.order = value;
        return this;
      },
      skip(value) {
        this.offset = value;
        return this;
      },
      limit(value) {
        this.size = value;
        return this;
      },
      async lean() {
        if (h.readFailure) throw new Error("private read detail");
        let rows = h.users.filter((user) => matches(user, filter));
        if (one) return rows[0] ? structuredClone(rows[0]) : null;
        h.listOptions = {
          order: this.order,
          offset: this.offset,
          size: this.size,
        };
        rows.sort(
          (a, b) =>
            b.createdAt - a.createdAt ||
            String(b._id).localeCompare(String(a._id)),
        );
        return structuredClone(
          rows.slice(this.offset, this.offset + this.size),
        );
      },
    };
    return query;
  };
  patch(User, "countDocuments", async (filter) => {
    h.countFilter = filter;
    return h.users.filter((user) => matches(user, filter)).length;
  });
  patch(User, "find", (filter) => chain(filter));
  patch(User, "findOne", (filter) => chain(filter, true));
  patch(User, "findById", async (reference) =>
    String(reference) === actor
      ? {
          id: actor,
          _id: actor,
          role: h.role,
          accountStatus: "Active",
          registrationStatus: "Approved",
        }
      : h.users.find((user) => String(user._id) === String(reference)),
  );
  patch(User, "findOneAndUpdate", (filter, update, options) => ({
    select() {
      return this;
    },
    async lean() {
      assert.equal(options.session, session);
      assert.equal(options.runValidators, true);
      assert.equal(options.timestamps, false);
      assert.deepEqual(Object.keys(update), ["$set"]);
      h.writes.push({ filter, update });
      if (h.writeFailure) throw new Error("private write detail");
      if (h.race) return null;
      const user = h.users.find((entry) => matches(entry, filter));
      if (!user) return null;
      Object.assign(user, update.$set);
      return structuredClone(user);
    },
  }));
  patch(AuditLog, "create", async (records, options) => {
    assert.equal(options.session, session);
    if (h.auditFailure) throw new Error("private audit detail");
    for (const record of records)
      assert.equal(new AuditLog(record).validateSync(), undefined);
    h.audits.push(...records);
    return records;
  });
  for (const model of [User, Appointment])
    for (const key of [
      "deleteOne",
      "deleteMany",
      "findOneAndDelete",
      "findByIdAndDelete",
    ])
      patch(model, key, () => {
        h.deletions++;
        throw new Error("Deletion forbidden");
      });
  h.patch = patch;
  h.restore = () => restores.reverse().forEach((restore) => restore());
  return h;
}
const version = (user) => JSON.stringify(user.updatedAt ? user.updatedAt.toISOString() : "null");
const reset = (user, body = {}, expected = version(user)) => resetManagedUserPassword(String(user._id), body, actor, expected);
const safeReset = (value) => assert.doesNotMatch(JSON.stringify(value), /000123|institutionalId|studentId|employeeId|SECRET|PRIVATE|\$2[aby]\$|token/i);

test("reset eligibility, legacy fallbacks, exact credentials, timestamps and metadata preservation", async () => {
  for (const role of ["student", "faculty"]) for (const status of ["Active", "Inactive"]) for (const legacy of [false, true]) {
    const original = account({ role, accountStatus: status, approvedBy: actor, approvalMethod: "dean" });
    if (legacy) { delete original.institutionalId; delete original.registrationStatus; original[role === "student" ? "studentId" : "employeeId"] = "000123"; }
    const other = account(); const h = harness([original, other]);
    try {
      const result = await reset(original); assert.equal(result.statusCode, 200); safeReset(result.body); safeReset(h.audits);
      const updated = h.users[0]; assert.notEqual(updated.password, "000123");
      assert.equal(await bcrypt.compare("000123", updated.password), true); assert.equal(await bcrypt.compare("123", updated.password), false);
      assert.equal(bcrypt.getRounds(updated.password), 12); assert.ok(updated.passwordResetAt instanceof Date);
      assert.equal(updated.passwordChangedAt.getTime(), updated.passwordResetAt.getTime());
      const { password, passwordResetAt, passwordChangedAt, updatedAt, ...rest } = updated;
      const { password: oldPassword, updatedAt: oldUpdated, ...expected } = original;
      assert.deepEqual(rest, expected); assert.deepEqual(h.users[1], other);
      assert.equal(h.audits.length, 1); assert.equal(String(h.audits[0].actorUser), actor);
      assert.equal(String(h.audits[0].subjectUser), String(original._id)); assert.equal(h.audits[0].subjectRole, role);
      assert.equal((await reset(original)).statusCode, 409);
    } finally { h.restore(); }
  }
});
test("canonical validation and role-specific fallback preserve exact characters and byte limits", () => {
  for (const value of ["000123", "Ab-012", "x".repeat(72), "\u00e9".repeat(36)])
    assert.equal(resolveResetInstitutionalId({ role: "student", institutionalId: value }), value);
  for (const value of ["", " ", " 001", "001 ", "a\n", "a\u0000", 123, null, {}, "x".repeat(73), "\u00e9".repeat(37)])
    assert.equal(resolveResetInstitutionalId({ role: "student", institutionalId: value, studentId: "valid" }), null);
  assert.equal(resolveResetInstitutionalId({ role: "student", employeeId: "wrong" }), null);
  assert.equal(resolveResetInstitutionalId({ role: "faculty", studentId: "wrong" }), null);
});
test("ineligible accounts, malformed requests, missing versions and invalid canonical IDs cannot write", async () => {
  for (const extra of [{role:"dean"},{role:"admin"},{role:"program_chair"},{role:"custom"},
    {registrationStatus:"Pending"},{registrationStatus:"Rejected"},{registrationStatus:"unknown"},{registrationStatus:null},
    {accountStatus:"unknown"},{institutionalId:"",studentId:"000123"},{institutionalId:"x".repeat(73)}]) {
    const original=account(extra), h=harness([original]);
    try { assert.notEqual((await reset(original)).statusCode,200); assert.equal(h.writes.length,0); assert.equal(h.audits.length,0); } finally { h.restore(); }
  }
  const original=account(),h=harness([original]);
  try {
    for (const body of [null,[],"",{password:"secret"},{institutionalId:"fake"},{role:"faculty"},{status:"Active"}])
      assert.equal((await reset(original,body)).statusCode,400);
    for (const v of ["*",'"bad"',version(account({updatedAt:new Date(0)}))])
      assert.notEqual((await reset(original,{},v)).statusCode,200);
    assert.equal((await resetManagedUserPassword(actor,{},actor,version(original))).statusCode,403);
    assert.equal((await resetManagedUserPassword("bad",{},actor,version(original))).statusCode,400);
    assert.equal((await resetManagedUserPassword(String(original._id),{},actor,undefined)).statusCode,428);
    assert.equal(h.writes.length,0);
  } finally {h.restore();}
});
test("audit/write failure, unsupported transactions, retry, concurrency and uncertain commit are safe", async () => {
  for (const flag of ["auditFailure","writeFailure","unsupported","race","retry","uncertain","sessionFailure"]) {
    const original=account(),h=harness([original]); h[flag]=true;
    try {
      const result=await reset(original); safeReset(result.body);
      if(flag === "retry") {assert.equal(result.statusCode,200);assert.equal(h.audits.length,1);}
      else if(flag === "uncertain") {assert.equal(result.body.code,"PASSWORD_RESET_UNCERTAIN");assert.equal(h.audits.length,1);}
      else {assert.notEqual(result.statusCode,200);assert.deepEqual(h.users[0],original);assert.equal(h.audits.length,0);}
    } finally {h.restore();}
  }
  const original=account(),h=harness([original]); h.serializeTransactions=true;
  try { const results=await Promise.all([reset(original),reset(original)]);assert.deepEqual(results.map(r=>r.statusCode),[200,409]);assert.equal(h.audits.length,1); } finally {h.restore();}
});
test("POST route authenticates and authorizes, requires version, and removes custom PUT", async () => {
  const original=account(),h=harness([original]); env.jwtSecret="isolated-reset-test";
  const server=app.listen(0,"127.0.0.1"); await new Promise(r=>server.once("listening",r));
  const url=`http://127.0.0.1:${server.address().port}/api/dean/users/${original._id}/reset-password`;
  const token=jwt.sign({sub:actor},env.jwtSecret);
  try {
    assert.equal((await fetch(url,{method:"POST"})).status,401);
    for(const role of ["student","faculty"]) {h.role=role;assert.equal((await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${token}`}})).status,403);}
    h.role="dean";
    assert.equal((await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${token}`}})).status,428);
    const response=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${token}`,"If-Match":version(original)}});
    assert.equal(response.status,200); safeReset(await response.json()); assert.equal(response.headers.get("cache-control"),"no-store");
    assert.equal((await fetch(url,{method:"PUT",headers:{Authorization:`Bearer ${token}`}})).status,404);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));h.restore();}
});
test("new login uses reset credential, old password fails, other users and issued sessions remain valid", async () => {
  const original=account({password:await bcrypt.hash("OldPassword1",4)}),other=account({password:await bcrypt.hash("OtherPassword1",4)}),h=harness([original,other]);
  const issuedToken=jwt.sign({sub:String(original._id)},env.jwtSecret,{expiresIn:"8h"});
  try {
    await reset(original);
    h.patch(User,"findOne",()=>({select(){return Promise.resolve({...h.users[0],id:String(original._id)});}}));
    h.patch(User,"findById",async()=>({...h.users[0],id:String(original._id)}));
    h.patch(AuditLog,"create",async()=>({}));
    const attempt=async(password)=>{const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await login({params:{role:"student"},body:{identifier:original.email,password}},res);return res;};
    assert.equal((await attempt("000123")).statusCode,200);assert.equal((await attempt("OldPassword1")).statusCode,401);
    assert.equal(await bcrypt.compare("OtherPassword1",h.users[1].password),true);
    const token=issuedToken;let called=false;
    await authenticate({headers:{authorization:`Bearer ${token}`}}, {status(){return this;},json(){}},()=>{called=true;});assert.equal(called,true);
    h.users[0].accountStatus="Inactive";assert.equal((await attempt("000123")).statusCode,403);called=false;
    await authenticate({headers:{authorization:`Bearer ${token}`}}, {status(){return this;},json(){}},()=>{called=true;});assert.equal(called,false);
  }finally{h.restore();}
});
test("malformed reset bodies are sanitized and never logged", async () => {
 const original=account(),h=harness([original]),logs=[];
 for(const method of ["log","warn","error"])h.patch(console,method,(...args)=>logs.push(args));
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 try {
 const url=`http://127.0.0.1:${server.address().port}/api/dean/users/${original._id}/reset-password`;
 for(const body of ['{"password":"PRIVATE_PASSWORD_HASH"',JSON.stringify({password:"PRIVATE_PASSWORD_HASH"})]) {
 const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${jwt.sign({sub:actor},env.jwtSecret)}`,"If-Match":version(original)},body});
 assert.equal(res.status,400);assert.doesNotMatch(JSON.stringify(await res.json()),/PRIVATE/);
 }
 const plain=await fetch(url,{method:"POST",headers:{"Content-Type":"text/plain",Authorization:`Bearer ${jwt.sign({sub:actor},env.jwtSecret)}`,"If-Match":version(original)},body:"PRIVATE_PASSWORD_HASH"});
 assert.equal(plain.status,400);
 assert.deepEqual(logs,[]);assert.equal(h.writes.length,0);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));h.restore();}
});
