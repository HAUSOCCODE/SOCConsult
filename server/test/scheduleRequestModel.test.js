import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import Appointment from "../src/models/Appointment.js";

const faculty = new mongoose.Types.ObjectId();
const student = new mongoose.Types.ObjectId();
const data = {
  faculty,
  student,
  subject: "Project consultation",
  reason: "Discuss project scope",
  yearLevel: "3rd Year",
  estimatedDurationMinutes: 30,
};

describe("schedule request model", () => {
  it("allows an awaiting request without a published slot or fake date", () => {
    const request = new Appointment({
      ...data,
      bookingMethod: "schedule_request",
      status: "Awaiting Faculty Schedule",
    });
    assert.equal(request.validateSync(), undefined);
    assert.equal(request.startAt, undefined);
    assert.equal(request.availability, undefined);
    assert.equal(request.consultationMode, undefined);
  });
  it("requires a date and time before a one-time request becomes approved", () => {
    const request = new Appointment({
      ...data,
      bookingMethod: "schedule_request",
      status: "Approved",
    });
    const error = request.validateSync();
    assert.ok(error.errors.startAt);
    assert.ok(error.errors.endAt);
  });
  it("continues requiring an availability slot for published booking", () => {
    const request = new Appointment({
      ...data,
      status: "Pending",
      startAt: new Date(Date.now() + 3600000),
      endAt: new Date(Date.now() + 7200000),
    });
    assert.ok(request.validateSync().errors.availability);
  });
});
