import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyStudentAppointments,
  isAppointmentPast,
  isStudentCurrentAppointment,
  isStudentHistoryAppointment,
} from "../src/services/appointmentClassificationService.js";
import { readFile } from "node:fs/promises";

const now = new Date("2026-08-17T06:00:00.000Z"); // 2:00 PM in Asia/Manila
const appointment = (id, status, startAt, endAt) => ({
  _id: id,
  status,
  startAt: new Date(startAt),
  endAt: new Date(endAt),
});

describe("Student appointment timestamp classification", () => {
  it("keeps future-today, currently happening, and tomorrow appointments current", () => {
    const futureToday = appointment(
      "future-today",
      "Pending",
      "2026-08-17T06:30:00.000Z",
      "2026-08-17T07:00:00.000Z",
    );
    const happening = appointment(
      "happening",
      "Confirmed",
      "2026-08-17T05:30:00.000Z",
      "2026-08-17T06:30:00.000Z",
    );
    const tomorrow = appointment(
      "tomorrow",
      "Reschedule Proposed",
      "2026-08-18T05:00:00.000Z",
      "2026-08-18T05:30:00.000Z",
    );
    for (const item of [futureToday, happening, tomorrow]) {
      assert.equal(isStudentCurrentAppointment(item, now), true);
      assert.equal(isStudentHistoryAppointment(item, now), false);
    }
  });

  it("uses the exact end boundary and classifies yesterday as history", () => {
    const justFinished = appointment(
      "boundary",
      "Confirmed",
      "2026-08-17T05:30:00.000Z",
      "2026-08-17T06:00:00.000Z",
    );
    const yesterday = appointment(
      "yesterday",
      "Pending",
      "2026-08-16T05:00:00.000Z",
      "2026-08-16T05:30:00.000Z",
    );
    assert.equal(isAppointmentPast(justFinished, now), true);
    assert.equal(isStudentHistoryAppointment(justFinished, now), false);
    assert.equal(isStudentHistoryAppointment(yesterday, now), false);
  });

  it("moves every past status to history without rewriting the status", () => {
    const statuses = [
      "Pending",
      "Confirmed",
      "Reschedule Proposed",
      "Awaiting Attendance Update",
      "Attendance Review",
      "Completed",
      "Cancelled",
      "Rejected",
      "Expired",
    ];
    const records = statuses.map((status, index) =>
      appointment(
        String(index),
        status,
        `2026-08-${String(10 + index).padStart(2, "0")}T05:00:00.000Z`,
        `2026-08-${String(10 + index).padStart(2, "0")}T05:30:00.000Z`,
      ),
    );
    const result = classifyStudentAppointments(records, now);
    assert.equal(result.current.length, 5);
    assert.equal(result.history.length, 4);
    assert.deepEqual(
      new Set([...result.current, ...result.history].map((item) => item.status)),
      new Set(statuses),
    );
    assert.equal(
      records.find((item) => item.status === "Confirmed").status,
      "Confirmed",
    );
  });

  it("puts future terminal records in history and sorts both views correctly", () => {
    const records = [
      appointment(
        "later",
        "Pending",
        "2026-08-18T07:00:00.000Z",
        "2026-08-18T07:30:00.000Z",
      ),
      appointment(
        "nearer",
        "Confirmed",
        "2026-08-17T07:00:00.000Z",
        "2026-08-17T07:30:00.000Z",
      ),
      appointment(
        "cancelled",
        "Cancelled",
        "2026-08-19T07:00:00.000Z",
        "2026-08-19T07:30:00.000Z",
      ),
      appointment(
        "older",
        "Expired",
        "2026-08-15T07:00:00.000Z",
        "2026-08-15T07:30:00.000Z",
      ),
    ];
    const result = classifyStudentAppointments(records, now);
    assert.deepEqual(
      result.current.map((item) => item._id),
      ["nearer", "later"],
    );
    assert.deepEqual(
      result.history.map((item) => item._id),
      ["cancelled", "older"],
    );
    assert.equal(Math.ceil(result.current.length / 6), 1);
  });

  it("keeps an unscheduled request current without inventing a date, then archives a rejection", () => {
    const request = {
      _id: "schedule-request",
      status: "Pending",
      startAt: null,
      endAt: null,
    };
    assert.equal(isAppointmentPast(request, now), false);
    assert.deepEqual(classifyStudentAppointments([request], now).current, [
      request,
    ]);
    request.status = "Rejected";
    assert.deepEqual(classifyStudentAppointments([request], now).history, [
      request,
    ]);
  });

  it("keeps ownership in the authenticated route and performs no expiry deletion", async () => {
    const route = await readFile(
      new URL("../src/routes/appointmentRoutes.js", import.meta.url),
      "utf8",
    );
    const classifier = await readFile(
      new URL(
        "../src/services/appointmentClassificationService.js",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(route, /\{ student: req\.user\.id \}/);
    assert.match(route, /classifyStudentAppointments/);
    assert.doesNotMatch(classifier, /delete|update|save\s*\(|Completed\s*[=:]/);
  });
});
