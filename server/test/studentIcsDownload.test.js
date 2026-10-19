import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import {
  consultationIcsFilename,
  escapeIcsText,
  generateConsultationIcs,
  toIcsUtcTimestamp,
} from "../src/services/icsService.js";

const tokenFor = (id) => jwt.sign({ sub: id }, env.jwtSecret);
const listen = () =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });

describe("Student iCalendar download", () => {
  it("generates one escaped CRLF VEVENT from exact stored instants", () => {
    const appointment = {
      _id: "appointment-stable-id",
      faculty: { name: "Dr. Back\\Slash, Semicolon; Name\nSecond line" },
      subject: "Web, Development; Lab\\Review\nPart 2",
      consultationMode: "Face-to-Face",
      location: "Room 3, Main; Wing\\A\nFloor 2",
      startAt: new Date("2026-12-15T02:00:00.000Z"),
      endAt: new Date("2026-12-15T03:00:00.000Z"),
      reservationToken: "never-export-this",
      meetingLink: "https://private.example.test",
      proposedMeetingLink: "https://proposal.example.test",
      facultyNotes: "private faculty note",
      StudentAvailability: { private: true },
    };
    const calendar = generateConsultationIcs(
      appointment,
      new Date("2026-12-01T00:00:00.000Z"),
    );
    const unfolded = calendar.replace(/\r\n /g, "");
    assert.match(unfolded, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    assert.match(unfolded, /BEGIN:VEVENT\r\n/);
    assert.match(unfolded, /UID:appointment-stable-id@socconsult\r\n/);
    assert.match(unfolded, /DTSTAMP:20261201T000000Z\r\n/);
    assert.match(unfolded, /DTSTART:20261215T020000Z\r\n/);
    assert.match(unfolded, /DTEND:20261215T030000Z\r\n/);
    assert.match(
      unfolded,
      /SUMMARY:SOCConsult Consultation — Web\\, Development\\; Lab\\\\Review\\nPart 2\r\n/,
    );
    assert.match(unfolded, /LOCATION:Room 3\\, Main\\; Wing\\\\A\\nFloor 2\r\n/);
    assert.match(unfolded, /STATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n$/);
    assert.equal(/(?<!\r)\n/.test(calendar), false);
    for (const privateValue of [
      "never-export-this",
      "private.example.test",
      "proposal.example.test",
      "private faculty note",
      "StudentAvailability",
    ])
      assert.equal(calendar.includes(privateValue), false);
  });

  it("formats UTC timestamps and Manila filename dates deterministically", () => {
    assert.equal(
      toIcsUtcTimestamp("2026-12-15T02:00:00.000Z"),
      "20261215T020000Z",
    );
    assert.equal(
      toIcsUtcTimestamp("2026-12-14T16:30:00.000Z"),
      "20261214T163000Z",
    );
    assert.equal(
      consultationIcsFilename("2026-12-14T16:30:00.000Z"),
      "SOCConsult-Consultation-2026-12-15.ics",
    );
    assert.equal(escapeIcsText("a\\b,c;d\r\ne"), "a\\\\b\\,c\\;d\\ne");
  });

  it("serves only the owning Student's currently Confirmed consultation", async () => {
    const studentA = new mongoose.Types.ObjectId().toString();
    const studentB = new mongoose.Types.ObjectId().toString();
    const facultyUser = new mongoose.Types.ObjectId().toString();
    const appointmentId = new mongoose.Types.ObjectId().toString();
    const originalFindById = User.findById;
    const originalFindOne = Appointment.findOne;
    const queries = [];
    let storedStatus = "Confirmed";
    User.findById = async (id) => ({
      _id: String(id),
      id: String(id),
      name: "Test User",
      role: String(id) === facultyUser ? "faculty" : "student",
      accountStatus: "Active",
      registrationStatus: "Approved",
    });
    Appointment.findOne = (query) => {
      queries.push(query);
      const record =
        String(query._id) === appointmentId &&
        String(query.student) === studentA &&
        query.status === "Confirmed" &&
        storedStatus === query.status
          ? {
              _id: appointmentId,
              status: storedStatus,
              faculty: { _id: facultyUser, name: "Dean Provider" },
              subject: "Web Development",
              startAt: new Date("2026-12-14T16:30:00.000Z"),
              endAt: new Date("2026-12-14T17:30:00.000Z"),
              consultationMode: "Online",
              meetingPlatform: "Microsoft Teams",
              meetingLink: "https://private.example.test/join",
              reservationToken: "private-reservation",
            }
          : null;
      const chain = {
        select: () => chain,
        populate: () => chain,
        maxTimeMS: () => chain,
        lean: async () => record,
      };
      return chain;
    };
    const server = await listen();
    const url = `http://127.0.0.1:${server.address().port}/api/appointments/${appointmentId}/calendar.ics`;
    const request = (id, target = url) =>
      fetch(target, {
        headers: id ? { Authorization: `Bearer ${tokenFor(id)}` } : {},
      });
    try {
      assert.equal((await request()).status, 401);
      assert.equal((await request(facultyUser)).status, 404);
      assert.equal((await request(studentB)).status, 404);
      const response = await request(studentA);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^text\/calendar/i);
      assert.equal(
        response.headers.get("content-disposition"),
        'attachment; filename="SOCConsult-Consultation-2026-12-15.ics"',
      );
      const body = (await response.text()).replace(/\r\n /g, "");
      assert.match(body, /BEGIN:VCALENDAR/);
      assert.match(body, /BEGIN:VEVENT/);
      assert.match(body, /DTSTART:20261214T163000Z/);
      assert.match(body, /DTEND:20261214T173000Z/);
      assert.match(body, /Provider: Dean Provider/);
      assert.match(body, /LOCATION:Microsoft Teams/);
      assert.equal(body.includes("meetingLink"), false);
      assert.equal(body.includes("private.example.test"), true);
      assert.equal(body.includes("private-reservation"), false);
      assert.equal(
        queries.every((query) => query.status === "Confirmed"),
        true,
      );
      assert.equal(
        queries.some((query) => String(query.student) === studentB),
        true,
      );
      for (const status of [
        "Pending",
        "Reschedule Proposed",
        "Rejected",
        "Cancelled",
        "Expired",
        "Awaiting Attendance Update",
        "Attendance Review",
        "Completed",
      ]) {
        storedStatus = status;
        assert.equal((await request(studentA)).status, 404, status);
      }
      const invalid = await request(
        studentA,
        `http://127.0.0.1:${server.address().port}/api/appointments/not-an-id/calendar.ics`,
      );
      assert.equal(invalid.status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      User.findById = originalFindById;
      Appointment.findOne = originalFindOne;
    }
  });

});
