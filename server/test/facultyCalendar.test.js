import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import Appointment from "../src/models/Appointment.js";
import { facultyCalendarInternals } from "../src/routes/facultyRoutes.js";

describe("Faculty consultation calendar", () => {
  it("builds exact Asia/Manila boundaries and exposes only calendar-safe fields", () => {
    assert.equal(
      facultyCalendarInternals
        .calendarDateAtManilaMidnight("2026-09-14")
        .toISOString(),
      "2026-09-13T16:00:00.000Z",
    );
    assert.equal(
      facultyCalendarInternals.calendarDateAtManilaMidnight("2026-02-31"),
      null,
    );
    assert.deepEqual(facultyCalendarInternals.CALENDAR_STATUSES, [
      "Confirmed",
      "Awaiting Attendance Update",
      "Attendance Review",
      "Completed",
    ]);
    const event = facultyCalendarInternals.calendarEvent({
      _id: "appointment-a",
      subject: "Capstone guidance",
      student: {
        _id: "student-a",
        name: "Student A",
        email: "private@example.com",
        password: "private",
      },
      startAt: new Date("2026-09-13T16:30:00.000Z"),
      endAt: new Date("2026-09-13T17:00:00.000Z"),
      estimatedDurationMinutes: 30,
      status: "Confirmed",
      consultationMode: "Online",
      meetingPlatform: "Google Meet",
      meetingLink: "https://meet.example.test/calendar",
      reason: "Project review",
    });
    assert.equal(event.student.name, "Student A");
    assert.equal(event.start.toISOString(), "2026-09-13T16:30:00.000Z");
    assert.equal("email" in event.student, false);
    assert.equal(JSON.stringify(event).includes("private@example.com"), false);
    assert.equal(JSON.stringify(event).includes("password"), false);
  });

  it("authenticates Faculty users and binds every query to the caller", async () => {
    const facultyA = new mongoose.Types.ObjectId().toString();
    const facultyB = new mongoose.Types.ObjectId().toString();
    const originalFindById = User.findById;
    const originalFind = Appointment.find;
    const queries = [];
    User.findById = async (id) => ({
      _id: String(id),
      id: String(id),
      name: String(id) === facultyA ? "Faculty A" : "Faculty B",
      role: "faculty",
      accountStatus: "Active",
      registrationStatus: "Approved",
    });
    Appointment.find = (query) => {
      queries.push(query);
      const isUpcoming = !("$lt" in query.startAt);
      const records = isUpcoming
        ? []
        : [
            {
              _id: "appointment-a",
              subject: "Capstone guidance",
              student: { _id: "student-a", name: "Student A" },
              startAt: new Date("2026-09-14T01:00:00.000Z"),
              endAt: new Date("2026-09-14T01:30:00.000Z"),
              estimatedDurationMinutes: 30,
              status: "Confirmed",
              consultationMode: "Online",
              meetingPlatform: "Google Meet",
            },
          ];
      const chain = {
        select: () => chain,
        populate: () => chain,
        sort: () => chain,
        limit: () => chain,
        lean: async () => records,
      };
      return chain;
    };

    const server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/faculty/calendar`;
    const call = async (
      facultyId,
      query = "start=2026-09-01&end=2026-09-30",
    ) => {
      const response = await fetch(`${base}?${query}`, {
        headers: {
          Authorization: `Bearer ${jwt.sign({ sub: facultyId }, env.jwtSecret)}`,
        },
      });
      return { status: response.status, data: await response.json() };
    };
    try {
      const response = await call(facultyA);
      assert.equal(response.status, 200);
      assert.equal(response.data.timezone, "Asia/Manila");
      assert.equal(response.data.events.length, 1);
      assert.equal(response.data.events[0].student.name, "Student A");
      assert.equal(
        queries.every((query) => String(query.faculty) === facultyA),
        true,
      );
      assert.deepEqual(queries[0].status.$in, [
        "Confirmed",
        "Awaiting Attendance Update",
        "Attendance Review",
        "Completed",
      ]);
      assert.equal(
        (await call(facultyA, "start=bad&end=2026-09-30")).status,
        400,
      );

      queries.length = 0;
      assert.equal((await call(facultyB)).status, 200);
      assert.equal(
        queries.every((query) => String(query.faculty) === facultyB),
        true,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      User.findById = originalFindById;
      Appointment.find = originalFind;
    }
  });
});
