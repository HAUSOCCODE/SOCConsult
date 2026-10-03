import mongoose from "mongoose";

const scheduleSnapshotSchema = new mongoose.Schema(
  {
    consultationDate: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    durationMinutes: { type: Number, required: true, min: 5, max: 240 },
    mode: {
      type: String,
      enum: ["Face-to-Face", "Online"],
      required: true,
    },
    location: { type: String, trim: true, maxlength: 150 },
    meetingPlatform: { type: String, trim: true, maxlength: 100 },
    meetingLink: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const scheduleHistorySchema = new mongoose.Schema(
  {
    previous: { type: scheduleSnapshotSchema, required: true },
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
          this.status !== "Rescheduled"
        );
      },
    },
    startAt: {
      type: Date,
      required: function () {
        return (
          this.bookingMethod !== "schedule_request" ||
          ["Approved", "Rescheduled", "Completed", "No Show"].includes(
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
          ["Approved", "Rescheduled", "Completed", "No Show"].includes(
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
    decisionLockAt: { type: Date, select: false },
    meetingPlatform: { type: String, trim: true, maxlength: 100 },
    meetingLink: { type: String, trim: true, maxlength: 500, select: false },
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
      enum: [
        "Pending",
        "Awaiting Faculty Schedule",
        "Approved",
        "Rejected",
        "Needs Reschedule",
        "Rescheduled",
        "Completed",
        "No Show",
        "Cancelled",
      ],
      default: "Pending",
      index: true,
    },
    responseNote: { type: String, trim: true, maxlength: 500 },
    rescheduleRequested: { type: Boolean, default: false },
    rescheduleRequestNote: { type: String, trim: true, maxlength: 500 },
    rescheduleRequestStatus: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
    },
    rescheduleRequestedAt: Date,
    rescheduleReviewedAt: Date,
    rescheduleReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rescheduleDecisionNote: { type: String, trim: true, maxlength: 500 },
    scheduleHistory: { type: [scheduleHistorySchema], default: [] },
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
      status: "Awaiting Faculty Schedule",
    },
  },
);
export default mongoose.model("Appointment", appointmentSchema);
