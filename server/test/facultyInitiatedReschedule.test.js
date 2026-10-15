import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import mongoose from "mongoose";
import Appointment from "../src/models/Appointment.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import {
  facultyAppointmentInternals,
  rescheduleFacultyAppointment,
} from "../src/controllers/facultyAppointmentController.js";

const { parseManilaDateTime, validateInput } = facultyAppointmentInternals;
const ids = {
  appointment: new mongoose.Types.ObjectId(),
  faculty: new mongoose.Types.ObjectId(),
  student: new mongoose.Types.ObjectId(),
};
const requestBody = (overrides = {}) => ({
  consultationDate: "2099-01-02",
  startTime: "14:00",
  duration: 30,
  mode: "Online",
  meetingPlatform: "Google Meet",
  meetingLink: "https://meet.google.com/example",
  location: "",
  reason: "Faculty emergency requiring a schedule adjustment.",
  ...overrides,
});
const appointmentRecord = (overrides = {}) => ({
  _id: ids.appointment,
  id: String(ids.appointment),
  faculty: { _id: ids.faculty, name: "Faculty Member" },
  student: { _id: ids.student, name: "Student Name" },
  subject: "Capstone consultation",
  status: "Confirmed",
  startAt: new Date("2099-01-01T02:00:00.000Z"),
  endAt: new Date("2099-01-01T02:30:00.000Z"),
  estimatedDurationMinutes: 30,
  consultationMode: "Online",
  meetingPlatform: "Google Meet",
  meetingLink: "https://meet.google.com/old",
  location: "",
  ...overrides,
});
const chain = (value) => {
  const query = {
    select: () => query,
    populate: () => query,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return query;
};
const response = () => {
  const result = { statusCode: 200, body: null };
  result.status = (code) => {
    result.statusCode = code;
    return result;
  };
  result.json = (body) => {
    result.body = body;
    return result;
  };
  return result;
};
const patch = (target, key, replacement, restores) => {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
};

test("parses faculty schedules in Asia/Manila and validates required fields", () => {
  assert.equal(
    parseManilaDateTime("2026-09-30", "14:00").toISOString(),
    "2026-09-30T06:00:00.000Z",
  );
  assert.equal(parseManilaDateTime("2026-02-30", "14:00"), null);
  const now = new Date("2026-09-27T00:00:00.000Z");
  assert.equal(validateInput(requestBody(), now).error, undefined);
  assert.match(
    validateInput(requestBody({ consultationDate: "2020-01-01" }), now).error,
    /future/i,
  );
  assert.match(
    validateInput(requestBody({ duration: 0 }), now).error,
    /duration/i,
  );
  assert.match(
    validateInput(requestBody({ reason: " " }), now).error,
    /reason/i,
  );
  assert.match(
    validateInput(
      requestBody({ mode: "Face-to-Face", location: "", meetingPlatform: "" }),
      now,
    ).error,
    /location/i,
  );
  assert.match(
    validateInput(requestBody({ meetingLink: "javascript:alert(1)" }), now)
      .error,
    /HTTP/i,
  );
});

test("appointment schema preserves faculty reschedule history", () => {
  const history = Appointment.schema.path("scheduleHistory");
  assert.ok(history);
  assert.ok(history.schema.path("previous.startAt"));
  assert.ok(history.schema.path("next.endAt"));
  assert.ok(history.schema.path("reason"));
  assert.ok(history.schema.path("initiatedByRole"));
  assert.ok(history.schema.path("initiatedBy"));
});

for (const providerRole of ["faculty", "dean"]) test(`${providerRole} proposal atomically preserves the current schedule and stores a separate proposal`, async () => {
  const restores = [];
  const current = appointmentRecord();
  const updated = appointmentRecord({
    status: "Reschedule Proposed",
    startAt: new Date("2099-01-02T06:00:00.000Z"),
    endAt: new Date("2099-01-02T06:30:00.000Z"),
  });
  let update;
  const notifications = [];
  const audits = [];
  patch(Appointment, "findOne", () => chain(current), restores);
  patch(Appointment, "exists", async () => null, restores);
  patch(
    Appointment,
    "findOneAndUpdate",
    (_filter, payload) => {
      update = payload;
      return chain(updated);
    },
    restores,
  );
  patch(
    Notification,
    "create",
    async (records) => notifications.push(...records),
    restores,
  );
  patch(
    AuditLog,
    "create",
    async (records) => audits.push(...records),
    restores,
  );
  patch(
    mongoose,
    "startSession",
    async () => ({
      withTransaction: async (work) => work(),
      endSession: async () => {},
    }),
    restores,
  );
  try {
    const req = {
      params: { appointmentId: String(ids.appointment) },
      body: requestBody(),
      user: {
        id: String(ids.faculty),
        name: "Faculty Member",
        role: providerRole,
      },
    };
    const res = response();
    await rescheduleFacultyAppointment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(update.$set.status, "Reschedule Proposed");
    assert.equal(update.$set.proposedStartAt.toISOString(), "2099-01-02T06:00:00.000Z");
    assert.equal(update.$set.proposedEndAt.toISOString(), "2099-01-02T06:30:00.000Z");
    assert.equal(update.$set.proposedConsultationMode, "Online");
    assert.equal(update.$set.proposalNote, requestBody().reason);
    assert.equal(update.$set.startAt, undefined);
    assert.equal(update.$set.endAt, undefined);
    assert.equal(update.$push, undefined);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].title, "Consultation Reschedule Proposed");
    assert.match(notifications[0].message, /proposed/i);
    assert.match(notifications[0].message, /Capstone consultation/i);
    assert.equal(notifications[0].actionUrl, "/student/consultations");
    assert.equal(audits.length, 2);
    assert.equal(audits[0].action, "appointment_rescheduled");
    assert.equal(audits[0].actorRole, providerRole);
    assert.equal(audits[1].subjectRole, providerRole);
    assert.equal(audits[0].metadata.initiatedBy, "Faculty");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("ownership, terminal status, started, identical, and schedule conflicts are rejected", async (t) => {
  const cases = [
    {
      name: "another faculty member",
      record: null,
      status: 404,
      match: /not found/i,
    },
    {
      name: "completed appointment",
      record: appointmentRecord({ status: "Completed" }),
      status: 409,
      match: /confirmed/i,
    },
    {
      name: "cancelled appointment",
      record: appointmentRecord({ status: "Cancelled" }),
      status: 409,
      match: /confirmed/i,
    },
    {
      name: "already-started appointment",
      record: appointmentRecord({
        startAt: new Date("2020-01-01"),
        endAt: new Date("2020-01-01T00:30:00Z"),
      }),
      status: 409,
      match: /started or passed/i,
    },
    {
      name: "identical duplicate submission",
      record: appointmentRecord({
        startAt: new Date("2099-01-02T06:00:00Z"),
        endAt: new Date("2099-01-02T06:30:00Z"),
        meetingLink: "https://meet.google.com/example",
      }),
      status: 409,
      match: /must differ/i,
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const restores = [];
      patch(Appointment, "findOne", () => chain(item.record), restores);
      try {
        const res = response();
        await rescheduleFacultyAppointment(
          {
            params: { appointmentId: String(ids.appointment) },
            body: requestBody(),
            user: { id: String(ids.faculty) },
          },
          res,
        );
        assert.equal(res.statusCode, item.status);
        assert.match(res.body.message, item.match);
      } finally {
        restores.reverse().forEach((restore) => restore());
      }
    });
  }

  for (const [name, conflictCall, message] of [
    ["faculty conflict", 1, /faculty appointment/i],
    ["student conflict", 2, /student already/i],
  ]) {
    await t.test(name, async () => {
      const restores = [];
      let calls = 0;
      patch(Appointment, "findOne", () => chain(appointmentRecord()), restores);
      patch(
        Appointment,
        "exists",
        async () => (++calls === conflictCall ? {} : null),
        restores,
      );
      try {
        const res = response();
        await rescheduleFacultyAppointment(
          {
            params: { appointmentId: String(ids.appointment) },
            body: requestBody(),
            user: { id: String(ids.faculty) },
          },
          res,
        );
        assert.equal(res.statusCode, 409);
        assert.match(res.body.message, message);
      } finally {
        restores.reverse().forEach((restore) => restore());
      }
    });
  }
});

test("faculty endpoint is role-protected and only the canonical Student proposal response route remains", () => {
  const facultyRoutes = fs.readFileSync(
    new URL("../src/routes/facultyRoutes.js", import.meta.url),
    "utf8",
  );
  const appointmentRoutes = fs.readFileSync(
    new URL("../src/routes/appointmentRoutes.js", import.meta.url),
    "utf8",
  );
  assert.match(
    facultyRoutes,
    /router\.use\(authenticate, authorize\("faculty", "dean"\)\)/,
  );
  assert.match(facultyRoutes, /\/appointments\/:appointmentId\/reschedule/);
  assert.match(appointmentRoutes, /"\/:id\/reschedule-response"/);
  assert.doesNotMatch(appointmentRoutes, /"\/:id\/request-reschedule"/);
  assert.doesNotMatch(appointmentRoutes, /router\.put\("\/:id\/reschedule"/);
});
