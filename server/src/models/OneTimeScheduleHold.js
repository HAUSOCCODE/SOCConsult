import mongoose from "mongoose";

const schema = new mongoose.Schema({
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appointment",
    required: true,
  },
  faculty: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  minute: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
});
schema.index({ faculty: 1, minute: 1 }, { unique: true });
schema.index({ student: 1, minute: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model("OneTimeScheduleHold", schema);
