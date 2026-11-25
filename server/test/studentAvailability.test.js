import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import StudentAvailability from "../src/models/StudentAvailability.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { deferred } from "./helpers/appointmentHarness.js";

test("Student availability is private, optional, validated, and owner-controlled", async () => {
  const ids = Object.fromEntries(
    ["studentA", "studentB", "faculty", "dean"].map((key) => [
      key,
      new mongoose.Types.ObjectId().toString(),
    ]),
  );
  const people = new Map([
    [ids.studentA, { id: ids.studentA, role: "student" }],
    [ids.studentB, { id: ids.studentB, role: "student" }],
    [ids.faculty, { id: ids.faculty, role: "faculty" }],
    [ids.dean, { id: ids.dean, role: "dean" }],
  ].map(([id, user]) => [id, { ...user, _id: id, accountStatus: "Active", registrationStatus: "Approved" }]));
  const records = [];
  const originals = [];
  const patch = (object, key, value) => {
    originals.push([object, key, object[key]]);
    object[key] = value;
  };
  const same = (left, right) => String(left) === String(right);
  const matches = (record, query) => Object.entries(query).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date) && !mongoose.isValidObjectId(value)) {
      if ("$ne" in value && same(record[key], value.$ne)) return false;
      if ("$lt" in value && !(record[key] < value.$lt)) return false;
      if ("$gt" in value && !(record[key] > value.$gt)) return false;
      return true;
    }
    return same(record[key], value);
  });
  const makeRecord = (values) => {
    const record = {
      _id: new mongoose.Types.ObjectId().toString(),
      id: "",
      ...values,
      async save() { return this; },
    };
    record.id = record._id;
    records.push(record);
    return record;
  };

  patch(User, "findById", async (id) => people.get(String(id)) || null);
  patch(User, "updateOne", async (query, changes, { session, timestamps }) => {
    assert.ok(session);
    assert.equal(timestamps, false);
    assert.deepEqual(changes, { $inc: { schedulingRevision: 1 } });
    return { matchedCount: Number(people.has(String(query._id))) };
  });
  patch(mongoose, "startSession", async () => ({
    withTransaction(work) { return work(); },
    async endSession() {},
  }));
  patch(StudentAvailability, "find", (query) => ({
    sort: async () => records.filter((item) => matches(item, query)).sort((a, b) => a.startAt - b.startAt),
  }));
  const find = (query) => records.find((item) => matches(item, query)) || null;
  const queryWithSession = (query) => ({ session: async (session) => { assert.ok(session); return find(query); } });
  patch(StudentAvailability, "exists", queryWithSession);
  patch(StudentAvailability, "findOne", queryWithSession);
  patch(StudentAvailability, "create", async (values, { session }) => {
    assert.ok(session);
    return values.map(makeRecord);
  });
  patch(StudentAvailability, "findOneAndUpdate", async (query, changes, { session }) => {
    assert.ok(session);
    const record = find(query);
    return record && Object.assign(record, changes.$set);
  });
  patch(StudentAvailability, "findOneAndDelete", async (query) => {
    const index = records.findIndex((item) => matches(item, query));
    return index < 0 ? null : records.splice(index, 1)[0];
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/student-availability`;
  const token = (id) => jwt.sign({ sub: id }, env.jwtSecret);
  const call = async (id, method = "GET", path = "", body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(id && { Authorization: `Bearer ${token(id)}` }),
        ...(body && { "Content-Type": "application/json" }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

  try {
    assert.equal((await call(null)).status, 401);
    assert.equal((await call(ids.faculty)).status, 403);
    assert.equal((await call(ids.dean)).status, 403);

    assert.equal((await call(ids.studentA, "POST", "", { startAt: future(-2), endAt: future(-1) })).status, 400);
    assert.equal((await call(ids.studentA, "POST", "", { startAt: future(3), endAt: future(2) })).status, 400);

    const first = await call(ids.studentA, "POST", "", {
      student: ids.studentB,
      studentId: ids.studentB,
      startAt: future(2),
      endAt: future(3),
    });
    assert.equal(first.status, 201);
    assert.equal(String(first.data.availability.student), ids.studentA);
    assert.equal(records[0].student, ids.studentA);

    assert.equal((await call(ids.studentA, "POST", "", { startAt: future(2.5), endAt: future(3.5) })).status, 409);
    assert.equal((await call(ids.studentA, "POST", "", { startAt: future(3), endAt: future(4) })).status, 201);
    const inactive = await call(ids.studentA, "POST", "", { startAt: future(2.5), endAt: future(3.5), isActive: false });
    assert.equal(inactive.status, 201);

    const other = makeRecord({ student: ids.studentB, startAt: new Date(future(5)), endAt: new Date(future(6)), isActive: true });
    const own = await call(ids.studentA);
    assert.equal(own.status, 200);
    assert.equal(own.data.availability.length, 3);
    assert.ok(own.data.availability.every((item) => same(item.student, ids.studentA)));
    assert.equal((await call(ids.studentA, "PUT", `/${other.id}`, { isActive: false })).status, 404);
    assert.equal((await call(ids.studentA, "DELETE", `/${other.id}`)).status, 404);

    assert.equal((await call(ids.studentA, "PUT", `/${inactive.data.availability._id}`, { isActive: true })).status, 409);
    assert.equal((await call(ids.studentA, "PUT", `/${first.data.availability._id}`, { isActive: false })).status, 200);
    assert.equal(records.find((item) => item.id === first.data.availability._id).isActive, false);
    assert.equal((await call(ids.studentA, "PUT", `/${inactive.data.availability._id}`, { isActive: true })).status, 409);

    const editable = records.find((item) => item.id === first.data.availability._id);
    editable.startAt = new Date(future(7));
    editable.endAt = new Date(future(8));
    assert.equal((await call(ids.studentA, "PUT", `/${editable.id}`, { isActive: true })).status, 200);
    assert.equal((await call(ids.studentA, "PUT", `/${editable.id}`, { startAt: future(9), endAt: future(10) })).status, 200);
    assert.equal(editable.student, ids.studentA);
    assert.equal((await call(ids.studentA, "PUT", `/${editable.id}`, { startAt: future(-2), endAt: future(-1) })).status, 400);
    assert.equal((await call(ids.studentA, "DELETE", `/${editable.id}`)).status, 200);
    assert.equal(records.some((item) => item.id === editable.id), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    originals.reverse().forEach(([object, key, value]) => { object[key] = value; });
  }
});

test("overlapping creates, updates and activations serialize per Student; delete wins before a queued update", async () => {
  const h = await appointmentHttp();
  const endpoint = "/student-availability";
  const period = (start, end) => ({ startAt: `2099-03-01T${start}:00+08:00`, endAt: `2099-03-01T${end}:00+08:00` });
  const post = (body, user = "student") => h.request(endpoint, user, "POST", body);
  const put = (id, body) => h.request(`${endpoint}/${id}`, "student", "PUT", body);
  const id = async (response) => (await response.json()).availability._id;
  const statuses = async (requests) => (await Promise.all(requests)).map(response => response.status).sort();
  try {
    const a = period("10:00", "11:00"), b = period("10:30", "11:30");
    assert.deepEqual(await statuses([post(a), post(b), post(b, "otherStudent")]), [201, 201, 409]);
    const first = await id(await post(period("12:00", "13:00")));
    const second = await id(await post(period("14:00", "15:00")));
    assert.deepEqual(await statuses([put(first, period("16:00", "17:00")), put(second, period("16:30", "17:30"))]), [200, 409]);
    const inactive = await Promise.all([post({ ...period("18:00", "19:00"), isActive: false }),
      post({ ...period("18:30", "19:30"), isActive: false })]);
    const inactiveIds = await Promise.all(inactive.map(id));
    assert.deepEqual(await statuses(inactiveIds.map(recordId => put(recordId, { isActive: true }))), [200, 409]);

    // Pause the delete after it acquires the Student revision. The update
    // reaches the transaction runner while deletion is still in progress.
    const remove = StudentAvailability.findOneAndDelete;
    const startSession = mongoose.startSession;
    const entered = deferred();
    const release = deferred();
    const queued = deferred();
    try {
      StudentAvailability.findOneAndDelete = async (...args) => {
        entered.resolve();
        await release.promise;
        return remove(...args);
      };
      const deleting = h.request(`${endpoint}/${first}`, "student", "DELETE");
      await entered.promise;
      mongoose.startSession = async () => {
        const session = await startSession();
        const withTransaction = session.withTransaction.bind(session);
        session.withTransaction = (...args) => {
          queued.resolve();
          return withTransaction(...args);
        };
        return session;
      };
      const updating = put(first, period("20:00", "21:00"));
      await queued.promise;
      release.resolve();
      assert.equal((await deleting).status, 200);
      assert.equal((await updating).status, 404);
    } finally {
      release.resolve();
      StudentAvailability.findOneAndDelete = remove;
      mongoose.startSession = startSession;
    }
    assert.equal(h.state.studentAvailability.some(row => row._id === first), false);
    assert.ok(h.lockCalls.includes(h.users.otherStudent.id));
    assert.ok(h.lockCalls.every(account => [h.users.student.id, h.users.otherStudent.id].includes(account)));
  } finally { await h.close(); }
});
