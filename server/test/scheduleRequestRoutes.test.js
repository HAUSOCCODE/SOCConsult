import assert from "node:assert/strict";
import { it } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import Appointment from "../src/models/Appointment.js";
import OneTimeScheduleHold from "../src/models/OneTimeScheduleHold.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";

for (const providerRole of ["faculty", "dean"]) it(`runs the ${providerRole} schedule request decision flow through HTTP with an isolated in-memory model harness`, async () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const otherStudentId = new mongoose.Types.ObjectId().toString();
  const facultyId = new mongoose.Types.ObjectId().toString();
  const otherFacultyId = new mongoose.Types.ObjectId().toString();
  const people = new Map(
    [
      [studentId, { id: studentId, name: "Student A", role: "student" }],
      [
        otherStudentId,
        { id: otherStudentId, name: "Student B", role: "student" },
      ],
      [facultyId, { id: facultyId, name: "Faculty A", role: providerRole }],
      [
        otherFacultyId,
        { id: otherFacultyId, name: "Faculty B", role: "faculty" },
      ],
    ].map(([id, person]) => [
      id,
      {
        ...person,
        _id: id,
        accountStatus: "Active",
        registrationStatus: "Approved",
      },
    ]),
  );
  const records = [];
  const holds = [];
  const notifications = [];
  const originals = new Map();
  const patch = (object, method, replacement) => {
    originals.set(`${object.modelName}:${method}`, [
      object,
      method,
      object[method],
    ]);
    object[method] = replacement;
  };
  const same = (a, b) => String(a) === String(b);
  const matches = (record, query) =>
    Object.entries(query).every(([key, value]) => {
      if (key === "$or") return value.some((item) => matches(record, item));
      if (
        value &&
        typeof value === "object" &&
        !(value instanceof Date) &&
        !mongoose.isValidObjectId(value)
      ) {
        if ("$ne" in value) return !same(record[key], value.$ne);
        if ("$in" in value)
          return value.$in.some((item) => same(record[key], item));
        if ("$lt" in value) return record[key] < value.$lt;
        if ("$gt" in value) return record[key] > value.$gt;
      }
      return same(record[key], value);
    });
  patch(User, "findById", async (id) => people.get(String(id)) || null);
  patch(User, "exists", async (query) => {
    const person = people.get(String(query._id));
    return person && matches(person, query) ? { _id: query._id } : null;
  });
  patch(Appointment, "init", async () => Appointment);
  patch(
    Appointment,
    "exists",
    async (query) => records.find((item) => matches(item, query)) || null,
  );
  patch(Appointment, "create", async (data) => {
    const record = new Appointment(data);
    const validation = record.validateSync();
    if (validation) throw validation;
    records.push(record);
    return record;
  });
  patch(
    Appointment,
    "findOne",
    async (query) => records.find((item) => matches(item, query)) || null,
  );
  patch(Appointment, "findOneAndUpdate", async (query, update) => {
    const record = records.find((item) => matches(item, query));
    if (!record) return null;
    for (const [key, value] of Object.entries(update.$set || {}))
      record.set(key, value);
    for (const key of Object.keys(update.$unset || {}))
      record.set(key, undefined);
    return record;
  });
  patch(Appointment, "find", (query) => {
    const found = records.filter((item) => matches(item, query));
    const chain = {
      select: () => chain,
      populate: () => chain,
      sort: () => chain,
      lean: async () =>
        found.map((item) => ({
          ...item.toObject(),
          student: people.get(String(item.student)),
        })),
    };
    return chain;
  });
  patch(OneTimeScheduleHold, "init", async () => OneTimeScheduleHold);
  patch(OneTimeScheduleHold, "insertMany", async (items) => {
    for (const item of items) {
      if (
        holds.some(
          (hold) =>
            hold.minute === item.minute &&
            (same(hold.faculty, item.faculty) ||
              same(hold.student, item.student)),
        )
      )
        throw Object.assign(new Error("duplicate hold"), { code: 11000 });
      holds.push(item);
    }
    return items;
  });
  patch(OneTimeScheduleHold, "deleteMany", async (query) => {
    for (let i = holds.length - 1; i >= 0; i -= 1)
      if (same(holds[i].appointment, query.appointment)) holds.splice(i, 1);
  });
  patch(Notification, "create", async (item) => {
    notifications.push(item);
    return item;
  });
  patch(AuditLog, "create", async (item) => item);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = (id) => jwt.sign({ sub: id }, env.jwtSecret);
  const call = async (path, roleId, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token(roleId)}`,
        ...(!(body instanceof FormData) && body
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const submit = (id, faculty = facultyId) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      facultyId: faculty,
      subject: "Project scope",
      reason: "Discuss the project",
      yearLevel: "3rd Year",
      estimatedDurationMinutes: "30",
    }))
      form.append(key, value);
    return call("/schedule-requests", id, "POST", form);
  };
  try {
    const first = await submit(studentId);
    assert.equal(first.status, 201);
    assert.equal(first.data.appointment.status, "Pending");
    assert.equal(first.data.appointment.startAt, undefined);
    assert.equal(first.data.appointment.availability, undefined);
    assert.equal(
      notifications.some(
        (item) =>
          same(item.recipient, facultyId) &&
          item.title === "Student Requested a Schedule",
      ),
      true,
    );
    const id = first.data.appointment._id;
    assert.equal(
      (await call("/schedule-requests/mine", facultyId)).data.requests.length,
      1,
    );
    assert.equal(
      (await call("/schedule-requests/mine", otherFacultyId)).data.requests
        .length,
      0,
    );
    assert.equal((await submit(studentId)).status, 409);
    const instant = new Date(
      Math.ceil((Date.now() + 86400000) / 60000) * 60000,
    );
    const startAt = `${new Date(instant.getTime() + 8 * 3600000).toISOString().slice(0, 19)}+08:00`;
    const schedule = {
      startAt,
      durationMinutes: 30,
      mode: "Face-to-Face",
      location: "Room 1",
    };
    assert.equal(
      (
        await call(
          `/schedule-requests/${id}/approve`,
          otherFacultyId,
          "PUT",
          schedule,
        )
      ).status,
      409,
    );
    assert.equal(
      (await call(`/schedule-requests/${id}/reject`, otherFacultyId, "PUT", {}))
        .status,
      409,
    );
    assert.equal(
      (
        await call(`/schedule-requests/${id}/approve`, facultyId, "PUT", {
          ...schedule,
          startAt: "2020-01-01T09:00:00+08:00",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(`/schedule-requests/${id}/approve`, facultyId, "PUT", {
          ...schedule,
          durationMinutes: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(`/schedule-requests/${id}/approve`, facultyId, "PUT", {
          ...schedule,
          location: "",
        })
      ).status,
      400,
    );
    const approved = await call(
      `/schedule-requests/${id}/approve`,
      facultyId,
      "PUT",
      {
        startAt,
        durationMinutes: 30,
        mode: "Online",
        meetingPlatform: "Google Meet",
        meetingLink: "https://meet.example.test/room",
      },
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.data.appointment.status, "Confirmed");
    assert.equal(approved.data.appointment.startAt, instant.toISOString());
    assert.equal(records.length, 1);
    assert.equal(holds.length, 30);
    assert.equal(
      notifications.some(
        (item) =>
          same(item.recipient, studentId) &&
          item.title === "Consultation Confirmed",
      ),
      true,
    );
    assert.equal(
      (
        await call(`/schedule-requests/${id}/approve`, facultyId, "PUT", {
          startAt,
          durationMinutes: 30,
          mode: "Online",
          meetingPlatform: "Google Meet",
        })
      ).status,
      409,
    );
    assert.equal(
      (await call(`/schedule-requests/${id}/cancel`, studentId, "PUT")).status,
      409,
    );
    const conflict = await submit(otherStudentId);
    assert.equal(conflict.status, 201);
    assert.equal(
      (
        await call(
          `/schedule-requests/${conflict.data.appointment._id}/approve`,
          facultyId,
          "PUT",
          {
            startAt,
            durationMinutes: 30,
            mode: "Face-to-Face",
            location: "Room 1",
          },
        )
      ).status,
      409,
    );
    const second = await submit(studentId);
    assert.equal(second.status, 201);
    assert.equal(
      (
        await call(
          `/schedule-requests/${second.data.appointment._id}/reject`,
          facultyId,
          "PUT",
          { note: "Unavailable" },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          `/schedule-requests/${second.data.appointment._id}/reject`,
          facultyId,
          "PUT",
          {},
        )
      ).status,
      409,
    );
    assert.equal(
      notifications.some(
        (item) =>
          same(item.recipient, studentId) &&
          item.title === "Schedule Request Rejected",
      ),
      true,
    );
    const third = await submit(studentId);
    assert.equal(third.status, 201);
    assert.equal(
      (
        await call(
          `/schedule-requests/${third.data.appointment._id}/cancel`,
          otherStudentId,
          "PUT",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          `/schedule-requests/${third.data.appointment._id}/cancel`,
          studentId,
          "PUT",
        )
      ).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [, [object, method, original]] of originals)
      object[method] = original;
  }
});
