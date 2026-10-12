import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import { auditControllerInternals } from "../src/controllers/auditController.js";
import AuditLog from "../src/models/AuditLog.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import {
  logActivity,
  recordAuditEvent,
} from "../src/services/activityService.js";

const restorations = [];
const patch = (object, method, replacement) => {
  restorations.push(() => (object[method] = object[method]));
  const original = object[method];
  object[method] = replacement;
  restorations[restorations.length - 1] = () => (object[method] = original);
};
afterEach(() => {
  while (restorations.length) restorations.pop()();
});

describe("Dean audit logs", () => {
  it("defines the required subject, role, action, and category indexes", () => {
    const indexes = AuditLog.schema
      .indexes()
      .map(([fields]) => JSON.stringify(fields));
    assert.ok(
      indexes.includes(JSON.stringify({ subjectUser: 1, createdAt: -1 })),
    );
    assert.ok(
      indexes.includes(JSON.stringify({ subjectRole: 1, createdAt: -1 })),
    );
    assert.ok(indexes.includes(JSON.stringify({ action: 1, createdAt: -1 })));
    assert.ok(indexes.includes(JSON.stringify({ category: 1, createdAt: -1 })));
  });

  it("uses Manila date boundaries and never serializes private metadata", () => {
    const { parseDate, publicLog } = auditControllerInternals;
    assert.equal(
      parseDate("2026-09-25").toISOString(),
      "2026-09-24T16:00:00.000Z",
    );
    const output = publicLog({
      _id: new mongoose.Types.ObjectId(),
      action: "login",
      category: "Authentication",
      description: "Successful sign-in",
      actorRole: "student",
      createdAt: new Date(),
      metadata: { ipAddress: "127.0.0.1", token: "secret" },
      details: { password: "secret" },
    });
    const serialized = JSON.stringify(output).toLowerCase();
    assert.doesNotMatch(
      serialized,
      /ipaddress|password|token|127\.0\.0\.1|secret/,
    );
  });

  it("allow-lists stored metadata and changes", async () => {
    const subjectId = new mongoose.Types.ObjectId();
    const created = [];
    patch(User, "findById", async () => ({
      _id: subjectId,
      id: String(subjectId),
      role: "student",
    }));
    patch(AuditLog, "create", async (record) => {
      created.push(record);
      return record;
    });
    await recordAuditEvent({
      subjectUser: subjectId,
      actorUser: subjectId,
      action: "profile_updated",
      category: "Profile",
      description: "Profile information updated",
      changes: {
        before: { status: "Old", password: "hidden" },
        after: { status: "New", token: "hidden" },
      },
      metadata: {
        fieldNames: ["yearLevel"],
        ipAddress: "127.0.0.1",
        meetingLink: "https://private.example",
      },
    });
    assert.equal(created.length, 1);
    const serialized = JSON.stringify(created[0]).toLowerCase();
    assert.match(serialized, /yearlevel/);
    assert.doesNotMatch(
      serialized,
      /password|token|ipaddress|meetinglink|private\.example/,
    );
  });

  it("records appointment activity for both the student and faculty", async () => {
    const studentId = new mongoose.Types.ObjectId();
    const facultyId = new mongoose.Types.ObjectId();
    const appointmentId = new mongoose.Types.ObjectId();
    const created = [];
    patch(Appointment, "findOne", async () => ({
      student: studentId,
      faculty: facultyId,
    }));
    patch(User, "findById", async (id) => ({
      _id: id,
      id: String(id),
      role: String(id) === String(studentId) ? "student" : "faculty",
    }));
    patch(AuditLog, "create", async (record) => {
      created.push(record);
      return record;
    });
    await logActivity(
      "appointment_approved",
      facultyId,
      "Appointment",
      appointmentId,
      { previousStatus: "Pending", newStatus: "Approved" },
    );
    assert.deepEqual(
      new Set(created.map((item) => item.subjectRole)),
      new Set(["student", "faculty"]),
    );
    assert.equal(created[0].changes.before.status, "Pending");
    assert.equal(created[0].changes.after.status, "Approved");
  });

  it("rejects unauthenticated and non-dean access before audit data is queried", async () => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      let response = await fetch(`${base}/api/dean/audit-users?role=student`);
      assert.equal(response.status, 401);
      const studentId = new mongoose.Types.ObjectId();
      patch(User, "findById", async () => ({
        id: String(studentId),
        _id: studentId,
        role: "student",
        accountStatus: "Active",
        registrationStatus: "Approved",
      }));
      response = await fetch(`${base}/api/dean/audit-users?role=student`, {
        headers: {
          Authorization: `Bearer ${jwt.sign({ sub: String(studentId) }, env.jwtSecret)}`,
        },
      });
      assert.equal(response.status, 403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
