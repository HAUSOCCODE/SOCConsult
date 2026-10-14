import mongoose from "mongoose";

const studentAvailabilitySchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

studentAvailabilitySchema.index({ student: 1, startAt: 1 });
studentAvailabilitySchema.index({ student: 1, isActive: 1 });

export default mongoose.model(
  "StudentAvailability",
  studentAvailabilitySchema,
);
