import mongoose from "mongoose";

const availabilitySchema = new mongoose.Schema(
  {
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    location: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "Online consultation",
    },
    mode: {
      type: String,
      enum: ["Face-to-Face", "Online"],
      default: "Online",
    },
    meetingPlatform: { type: String, trim: true, maxlength: 100 },
    meetingLink: {
      type: String,
      trim: true,
      maxlength: 500,
      select: false,
    },
    isActive: { type: Boolean, default: true, index: true },
    reservationToken: { type: String, select: false, index: true },
    expirationNotified: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

availabilitySchema.index({ faculty: 1, startAt: 1, endAt: 1 });
availabilitySchema.index({ endAt: 1, expirationNotified: 1 });
export default mongoose.model("Availability", availabilitySchema);
