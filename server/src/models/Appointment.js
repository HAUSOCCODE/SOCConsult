import mongoose from "mongoose";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../config/appointmentStatus.js";

const scheduleSnapshotSchema = new mongoose.Schema(
  {
    consultationDate: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    durationMinutes: { type: Number, required: true, min: 5, max: 1440 },
    mode: {
      type: String,
      enum: ["Face-to-Face", "Online"],
      required: true,
    },
    location: { type: String, trim: true, maxlength: 150 },
    meetingPlatform: { type: String, trim: true, maxlength: 100 },
  },
  { _id: false },
);

const scheduleHistorySchema = new mongoose.Schema(
  {
    previous: { type: scheduleSnapshotSchema, required: function () { return !this.previousScheduleUnavailable; } },
    previousScheduleUnavailable: Boolean,
    next: { type: scheduleSnapshotSchema, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    initiatedByRole: {
      type: String,
      enum: ["Faculty", "Student"],
      required: true,
    },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdAt: { type: Date, default: Date.now, required: true },
    response: {
      type: String,
      enum: ["Accepted", "Rejected", "Cancelled"],
    },
    respondedAt: Date,
    respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true },
);

const statusHistorySchema = new mongoose.Schema(
  {
    previousStatus: {
      type: String,
      required: true,
    },
    newStatus: {
      type: String,
      required: true,
    },
    reason: { type: String, trim: true, maxlength: 500 },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () { return this.actorType !== "system"; },
    },
    changedByRole: {
      type: String,
      enum: ["Student", "Faculty", "Dean", "System"],
      required: true,
    },
    changedAt: { type: Date, default: Date.now, required: true },
    actorType: { type: String, enum: ["user", "system"], default: "user" },
    source: { type: String, trim: true, maxlength: 100 },
    migrationVersion: { type: String, maxlength: 100 },
  },
  { _id: true },
);

const appointmentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    availability: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Availability",
      required: function () {
        return (
          this.bookingMethod !== "schedule_request" &&
          this.currentScheduleSource !== "faculty_assigned" &&
          this.status !== "Confirmed"
        );
      },
    },
    startAt: {
      type: Date,
      required: function () {
        return (
          this.bookingMethod !== "schedule_request" ||
          ["Confirmed", "Completed", "Awaiting Attendance Update", "Attendance Review"].includes(
            this.status,
          )
        );
      },
      index: true,
    },
    endAt: {
      type: Date,
      required: function () {
        return (
          this.bookingMethod !== "schedule_request" ||
          ["Confirmed", "Completed", "Awaiting Attendance Update", "Attendance Review"].includes(
            this.status,
          )
        );
      },
      index: true,
    },
    bookingMethod: {
      type: String,
      enum: ["published_slot", "schedule_request"],
      default: "published_slot",
      index: true,
    },
    decisionLock: { type: Boolean, default: false, select: false },
    currentScheduleSource: { type: String, enum: ["published_slot", "faculty_assigned"] },
    decisionLockAt: { type: Date, select: false },
    reservationToken: { type: String, select: false },
    meetingPlatform: { type: String, trim: true, maxlength: 100 },
    meetingLink: { type: String, trim: true, maxlength: 500, select: false },
    proposedAvailability: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Availability",
    },
    proposedStartAt: Date,
    proposedEndAt: Date,
    proposedConsultationMode: {
      type: String,
      enum: ["Face-to-Face", "Online"],
    },
    proposedLocation: { type: String, trim: true, maxlength: 150 },
    proposedMeetingPlatform: { type: String, trim: true, maxlength: 100 },
    proposedMeetingLink: {
      type: String,
      trim: true,
      maxlength: 500,
      select: false,
    },
    proposalNote: { type: String, trim: true, maxlength: 500 },
    proposedAt: Date,
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    estimatedDurationMinutes: { type: Number, min: 5, max: 1440 },
    subject: { type: String, required: true, trim: true, maxlength: 150 },
    yearLevel: {
      type: String,
      enum: ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"],
    },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    notes: { type: String, trim: true, maxlength: 1000 },
    consultationMode: {
      type: String,
      enum: ["Face-to-Face", "Online"],
      default: function () {
        return this.bookingMethod === "schedule_request" ? undefined : "Online";
      },
    },
    location: { type: String, trim: true, maxlength: 150 },
    supportingDocument: {
      name: { type: String, trim: true, maxlength: 200 },
      mimeType: { type: String, trim: true, maxlength: 100 },
      size: { type: Number, min: 0 },
      data: { type: String, select: false },
    },
    // Legacy entries can be ObjectIds. New uploads are embedded Cloudinary metadata.
    supportingDocuments: [mongoose.Schema.Types.Mixed],
    status: {
      type: String,
      // Legacy values remain readable/saveable during rollout, never transition destinations.
      enum: [...APPOINTMENT_STATUSES, ...LEGACY_APPOINTMENT_STATUSES],
      default: "Pending",
      index: true,
    },
    attendance: { type: new mongoose.Schema({
      policyVersion: String, attendanceOpensAt: Date, responseDeadlineAt: Date,
      studentResponded: Boolean, facultyResponded: Boolean,
      finalOutcome: { type: String, enum: ["Completed", "Student No-show", "Faculty No-show", null], default: null },
      finalizedAt: Date, finalizationSource: { type: String, enum: ["participant_agreement", "dean_review"] },
      reviewReason: { type: String, enum: ["student_response_missing", "faculty_response_missing", "both_responses_missing", "responses_conflict"] },
      missingRoles: [{ type: String, enum: ["student", "faculty"] }], reviewStartedAt: Date,
    }, { _id: false }), select: false, default: undefined },
    responseNote: { type: String, trim: true, maxlength: 500 },
    statusMigration: {
      version: String,
      originalStatus: String,
      migratedAt: Date,
    },
    expirationReason: { type: String, maxlength: 100 },
    scheduleHistory: { type: [scheduleHistorySchema], default: [] },
    statusHistory: { type: [statusHistorySchema], default: [] },
    cancellationReason: { type: String, trim: true, maxlength: 500 },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelledByRole: {
      type: String,
      enum: ["Student", "Faculty", "Dean"],
    },
    cancelledAt: Date,
  },
  { timestamps: true },
);

appointmentSchema.index({ faculty: 1, startAt: 1, status: 1 });
appointmentSchema.index({ faculty: 1, availability: 1, status: 1 });
appointmentSchema.index({ student: 1, startAt: 1, status: 1 });
appointmentSchema.index(
  { student: 1, faculty: 1 },
  {
    unique: true,
    partialFilterExpression: {
      bookingMethod: "schedule_request",
      status: "Pending",
    },
  },
);
appointmentSchema.index({ status: 1, "attendance.policyVersion": 1, endAt: 1 });
appointmentSchema.index({ status: 1, "attendance.responseDeadlineAt": 1 });
appointmentSchema.index({ status: 1, "attendance.reviewStartedAt": -1, _id: -1 });
export default mongoose.model("Appointment", appointmentSchema);
