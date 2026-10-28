import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import { studentCalendarInternals } from "../src/routes/calendarRoutes.js";

const tokenFor = (id) => jwt.sign({ sub: id }, env.jwtSecret);

const listen = () =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });

describe("Student consultation calendar", () => {
  it("uses the documented status policy and safe event shape", () => {
    assert.deepEqual(studentCalendarInternals.STUDENT_CALENDAR_STATUSES, [
      "Reschedule Proposed",
      "Confirmed",
      "Awaiting Attendance Update",
      "Attendance Review",
      "Completed",
    ]);
    const event = studentCalendarInternals.studentCalendarEvent({
      _id: "appointment-a",
      subject: "Web Development",
      reason: "Review the final project",
      faculty: {
        _id: "faculty-a",
        name: "Faculty A",
        email: "private@example.test",
        password: "secret",
      },
      startAt: new Date("2026-10-19T16:30:00.000Z"),
      endAt: new Date("2026-10-19T17:30:00.000Z"),
      consultationMode: "Online",
      meetingPlatform: "Microsoft Teams",
      meetingLink: "https://private.example.test",
      proposedMeetingLink: "https://proposed.example.test",
      reservationToken: "private-token",
      scheduleHistory: [{
        previous: { startAt: new Date("2026-10-19T16:30:00.000Z") },
        next: { startAt: new Date("2026-10-20T16:30:00.000Z") },
        reason: "Faculty conflict",
        initiatedByRole: "Faculty",
        initiatedBy: "private-faculty-id",
        respondedBy: "private-student-id",
      }],
      status: "Reschedule Proposed",
    });
    assert.equal(event.start.toISOString(), "2026-10-19T16:30:00.000Z");
    assert.equal(event.facultyName, "Faculty A");
    assert.equal(event.subject, "Web Development");
    assert.equal(event.meetingPlatform, "Microsoft Teams");
    const serialized = JSON.stringify(event);
    for (const privateValue of [
      "meetingLink",
      "proposedMeetingLink",
      "reservationToken",
      "private@example.test",
      "secret",
      "StudentAvailability",
      "private-faculty-id",
      "private-student-id",
    ])
      assert.equal(serialized.includes(privateValue), false);
  });

  it("parses inclusive Manila calendar dates independently of machine timezone", () => {
    assert.equal(
      studentCalendarInternals.manilaMidnight("2026-10-20").toISOString(),
      "2026-10-19T16:00:00.000Z",
    );
    assert.equal(studentCalendarInternals.manilaMidnight("2026-02-30"), null);
    assert.equal(studentCalendarInternals.manilaMidnight("10/20/2026"), null);
    assert.equal(studentCalendarInternals.MAX_RANGE_DAYS, 93);
  });

  it("requires Student authentication and scopes one overlap query to the caller", async () => {
    const studentA = new mongoose.Types.ObjectId().toString();
    const studentB = new mongoose.Types.ObjectId().toString();
    const facultyUser = new mongoose.Types.ObjectId().toString();
    const originalFindById = User.findById;
    const originalFind = Appointment.find;
    const queries = [];
    User.findById = async (id) => ({
      _id: String(id),
      id: String(id),
      name: "Test User",
      role: String(id) === facultyUser ? "faculty" : "student",
      accountStatus: "Active",
      registrationStatus: "Approved",
    });
    Appointment.find = (query) => {
      queries.push(query);
      const records = String(query.student) === studentA
        ? [
            {
              _id: "appointment-a",
              faculty: { _id: "faculty-a", name: "Faculty A" },
              subject: "Algorithms",
              reason: "Complexity review",
              startAt: new Date("2026-10-19T16:30:00.000Z"),
              endAt: new Date("2026-10-19T17:00:00.000Z"),
              consultationMode: "Face-to-Face",
              location: "Room 301",
              status: "Confirmed",
            },
          ]
        : [];
      const chain = {
        select: () => chain,
        populate: () => chain,
        sort: () => chain,
        lean: async () => records,
      };
      return chain;
    };
    const server = await listen();
    const base = `http://127.0.0.1:${server.address().port}/api/calendar/student`;
    const call = async (id) => {
      const response = await fetch(`${base}?start=2026-10-20&end=2026-10-20`, {
        headers: id ? { Authorization: `Bearer ${tokenFor(id)}` } : {},
      });
      return { status: response.status, data: await response.json() };
    };
    try {
      assert.equal((await call()).status, 401);
      assert.equal((await call(facultyUser)).status, 403);
      const own = await call(studentA);
      assert.equal(own.status, 200);
      assert.equal(own.data.timezone, "Asia/Manila");
      assert.equal(own.data.events.length, 1);
      assert.equal(own.data.events[0].facultyName, "Faculty A");
      assert.equal(own.data.events[0].location, "Room 301");
      const other = await call(studentB);
      assert.equal(other.status, 200);
      assert.equal(other.data.events.length, 0);
      assert.equal(queries.length, 2);
      assert.equal(String(queries[0].student), studentA);
      assert.equal(String(queries[1].student), studentB);
      assert.deepEqual(queries[0].status.$in, studentCalendarInternals.STUDENT_CALENDAR_STATUSES);
      assert.equal(queries[0].startAt.$lt.toISOString(), "2026-10-20T16:00:00.000Z");
      assert.equal(queries[0].endAt.$gt.toISOString(), "2026-10-19T16:00:00.000Z");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      User.findById = originalFindById;
      Appointment.find = originalFind;
    }
  });

  it("rejects malformed, reversed, and excessive ranges while allowing 93 days", async () => {
    const student = new mongoose.Types.ObjectId().toString();
    const originalFindById = User.findById;
    const originalFind = Appointment.find;
    User.findById = async (id) => ({
      _id: String(id), id: String(id), name: "Student", role: "student", accountStatus: "Active",
    });
    let queryCount = 0;
    Appointment.find = () => {
      queryCount += 1;
      const chain = { select: () => chain, populate: () => chain, sort: () => chain, lean: async () => [] };
      return chain;
    };
    const server = await listen();
    const base = `http://127.0.0.1:${server.address().port}/api/calendar/student`;
    const call = async (query) => {
      const response = await fetch(`${base}?${query}`, {
        headers: { Authorization: `Bearer ${tokenFor(student)}` },
      });
      return { status: response.status, data: await response.json() };
    };
    try {
      assert.equal((await call("start=bad&end=2026-10-20")).status, 400);
      assert.equal((await call("start=2026-10-21&end=2026-10-20")).status, 400);
      const excessive = await call("start=2026-01-01&end=2026-04-04");
      assert.equal(excessive.status, 400);
      assert.match(excessive.data.message, /93 days/);
      assert.equal((await call("start=2026-01-01&end=2026-04-03")).status, 200);
      assert.equal(queryCount, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      User.findById = originalFindById;
      Appointment.find = originalFind;
    }
  });
});
