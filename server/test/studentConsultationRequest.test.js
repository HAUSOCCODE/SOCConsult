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

test("selected-slot requests validate authoritative data and reserve atomically", async () => {
  const restores = [];
  const ids = Object.fromEntries(
    ["studentA", "studentB", "faculty", "slot"].map((key) => [
      key,
      new mongoose.Types.ObjectId().toString(),
    ]),
  );
  const users = new Map([
    [ids.studentA, { role: "student", name: "Student A", yearLevel: "3rd Year" }],
    [ids.studentB, { role: "student", name: "Student B", yearLevel: "2nd Year" }],
    [ids.faculty, { role: "faculty", name: "Faculty", registrationStatus: "Approved" }],
  ].map(([id, user]) => [id, { id, _id: id, accountStatus: "Active", ...user }]));
  const slot = {
    id: ids.slot,
    _id: ids.slot,
    faculty: ids.faculty,
    startAt: new Date(Date.now() + 3_600_000),
    endAt: new Date(Date.now() + 7_200_000),
    isActive: true,
    mode: "Online",
    meetingPlatform: "Microsoft Teams",
    meetingLink: "https://example.invalid/private",
  };
  let reservationToken;
  let failCreation = false;
  const appointments = [];
  const notifications = [];

  patch(User, "findById", async (id) => users.get(String(id)) || null, restores);
  patch(User, "exists", async (query) => {
    const provider = users.get(String(query._id));
    return provider?.role === "faculty" && provider.registrationStatus === "Approved"
      ? { _id: provider.id }
      : null;
  }, restores);
  patch(Availability, "findOne", async (query) =>
    String(query._id) === ids.slot && !reservationToken ? slot : null,
  restores);
  patch(Availability, "findOneAndUpdate", async (query, update) => {
    if (String(query._id) !== ids.slot || reservationToken) return null;
    reservationToken = update.$set.reservationToken;
    return slot;
  }, restores);
  patch(Availability, "updateOne", async (query) => {
    if (query.reservationToken === reservationToken) reservationToken = undefined;
    return { modifiedCount: 1 };
  }, restores);
  patch(Appointment, "exists", async (query) =>
    appointments.some((item) =>
      (query.availability && String(item.availability) === String(query.availability)) ||
      (query.student && String(item.student) === String(query.student) &&
        item.startAt < query.startAt.$lt && item.endAt > query.endAt.$gt) ||
      (query.faculty && String(item.faculty) === String(query.faculty) &&
        item.startAt < query.startAt.$lt && item.endAt > query.endAt.$gt),
    ) || null,
  restores);
  patch(Appointment, "create", async (data) => {
    if (failCreation) throw new Error("simulated persistence failure");
    const appointment = {
      ...data,
      id: new mongoose.Types.ObjectId().toString(),
      _id: new mongoose.Types.ObjectId(),
      save: async () => appointment,
    };
    appointments.push(appointment);
    return appointment;
  }, restores);
  patch(Appointment, "findOne", (query) =>
    chain(appointments.find((item) => String(item.id) === String(query._id)) || null),
  restores);
  patch(Appointment, "deleteOne", async (query) => {
    const index = appointments.findIndex((item) => String(item.id) === String(query._id));
    if (index >= 0) appointments.splice(index, 1);
    return { deletedCount: index >= 0 ? 1 : 0 };
  }, restores);
  patch(Notification, "create", async (data) => {
    notifications.push(data);
    return data;
  }, restores);
  patch(AuditLog, "create", async (data) => data, restores);

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/api/appointments`;
  const token = (id) => jwt.sign({ sub: id }, env.jwtSecret);
  const submit = (student, body = {}) =>
    fetch(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token(student)}`,
        "Content-Type": "application/json",
        Connection: "close",
      },
      body: JSON.stringify({
        availabilityId: ids.slot,
        subject: "  Web Development  ",
        reason: "  Review the final project  ",
        student: ids.studentB,
        faculty: ids.studentB,
        startAt: new Date(0),
        endAt: new Date(1),
        status: "Approved",
        yearLevel: "5th Year",
        ...body,
      }),
    });

  try {
    let response = await submit(ids.studentA, { subject: " " });
    assert.equal(response.status, 400);
    response = await submit(ids.studentA, { subject: "x".repeat(151) });
    assert.equal(response.status, 400);
    response = await submit(ids.studentA, { reason: " " });
    assert.equal(response.status, 400);
    response = await submit(ids.studentA, { reason: "x".repeat(1001) });
    assert.equal(response.status, 400);
    assert.equal(appointments.length, 0);

    failCreation = true;
    response = await submit(ids.studentA);
    assert.equal(response.status, 500);
    assert.equal(reservationToken, undefined, "failed creation releases its own claim");
    assert.equal(appointments.length, 0);
    failCreation = false;

    const [first, second] = await Promise.all([
      submit(ids.studentA),
      submit(ids.studentB, { subject: "Databases", reason: "Schema review" }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);
    assert.equal(appointments.length, 1);
    const created = appointments[0];
    assert.equal(created.status, "Pending");
    assert.ok([ids.studentA, ids.studentB].includes(String(created.student)));
    assert.equal(String(created.faculty), ids.faculty);
    assert.equal(String(created.availability), ids.slot);
    assert.equal(created.startAt, slot.startAt);
    assert.equal(created.endAt, slot.endAt);
    assert.equal(created.subject, first.status === 201 ? "Web Development" : "Databases");
    assert.equal(created.reason, first.status === 201 ? "Review the final project" : "Schema review");
    assert.equal(created.yearLevel, first.status === 201 ? "3rd Year" : "2nd Year");
    assert.equal(created.consultationMode, "Online");
    assert.equal(created.meetingPlatform, "Microsoft Teams");
    assert.equal(created.location, "Microsoft Teams");
    assert.equal("meetingLink" in created, false);
    assert.equal(
      notifications.filter((item) =>
        String(item.recipient) === ids.faculty && item.title === "New Consultation Request",
      ).length,
      1,
    );

    response = await submit(ids.studentA);
    assert.equal(response.status, 409);
    assert.equal(appointments.length, 1);
    assert.equal(notifications.filter((item) => item.title === "New Consultation Request").length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restores.reverse().forEach((restore) => restore());
  }
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
