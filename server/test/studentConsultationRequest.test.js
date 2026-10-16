import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, addSlot } from "./helpers/appointmentHarness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import AuditLog from "../src/models/AuditLog.js";
import Availability from "../src/models/Availability.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";

const patch = (object, key, replacement, restores) => {
  restores.push(() => {
    object[key] = object[`__stu07_${key}`];
    delete object[`__stu07_${key}`];
  });
  object[`__stu07_${key}`] = object[key];
  object[key] = replacement;
};

const chain = (value) => {
  const query = {
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  for (const method of ["select", "lean"]) query[method] = () => query;
  return query;
};

const startServer = () =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });

test("selected-slot booking validates authoritative data, rolls back and prevents duplicate reservation", async () => {
  const h = await appointmentHttp();
  try {
    const record = fixture({ student: h.users.student.id, faculty: h.users.dean.id }); addSlot(h, { ...record, reservationToken: undefined });
    const body = { availabilityId: record.availability, subject: " Project ", reason: " Review scope ", status: "Approved", student: h.users.otherStudent.id, startAt: new Date(0) };
    for (const invalid of [{ subject: " " }, { reason: " " }, { subject: "x".repeat(151) }, { reason: "x".repeat(1001) }])
      assert.equal((await h.request('/appointments', "student", "POST", { ...body, ...invalid })).status, 400);
    h.fail("audits");
    assert.equal((await h.request('/appointments', "student", "POST", body)).status, 500);
    assert.equal(h.state.appointments.length, 0); assert.equal(h.state.slots[0].reservationToken, undefined);
    h.fail(undefined);
    const response = await h.request('/appointments', "student", "POST", body); assert.equal(response.status, 201);
    const result = (await response.json()).appointment;
    assert.equal(result.student, h.users.student.id); assert.equal(result.faculty, h.users.dean.id);
    assert.equal(result.status, "Pending"); assert.equal(result.yearLevel, "3rd Year");
    assert.equal(result.startAt, record.startAt.toISOString()); assert.equal(result.subject, "Project");
    assert.equal(result.reservationToken, undefined); assert.equal(result.statusHistory.length, 1);
    assert.equal((await h.request('/appointments', "otherStudent", "POST", body)).status, 409);
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 1);
  } finally { await h.close(); }
});

test("supporting-document middleware enforces count, file, total, and type limits", async () => {
  const restores = [];
  const studentId = new mongoose.Types.ObjectId().toString();
  patch(User, "findById", async () => ({
    id: studentId,
    _id: studentId,
    role: "student",
    name: "Student",
    accountStatus: "Active",
  }), restores);
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/api/appointments`;
  const request = async (files) => {
    const form = new FormData();
    form.append("availabilityId", new mongoose.Types.ObjectId().toString());
    form.append("subject", "Testing");
    form.append("reason", "Upload validation");
    files.forEach(({ size, name, type }) =>
      form.append("documents", new Blob([Buffer.alloc(size)], { type }), name),
    );
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt.sign({ sub: studentId }, env.jwtSecret)}`,
        Connection: "close",
      },
      body: form,
    });
  };
  try {
    assert.equal((await request([{ size: 1, name: "run.exe", type: "application/octet-stream" }])).status, 400);
    assert.equal((await request(Array.from({ length: 6 }, (_, index) => ({ size: 1, name: `${index}.txt`, type: "text/plain" })))).status, 400);
    assert.equal((await request([{ size: 10 * 1024 * 1024 + 1, name: "large.pdf", type: "application/pdf" }])).status, 400);
    assert.equal((await request(Array.from({ length: 3 }, (_, index) => ({ size: 9 * 1024 * 1024, name: `${index}.pdf`, type: "application/pdf" })))).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restores.reverse().forEach((restore) => restore());
  }
});
