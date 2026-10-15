import mongoose from "mongoose";
import { ATTENDANCE_OUTCOMES } from "../config/attendance.js";
const schema = new mongoose.Schema({
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, immutable: true },
  participant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  participantRole: { type: String, enum: ["student", "faculty"], required: true, immutable: true },
  outcome: { type: String, enum: ATTENDANCE_OUTCOMES, required: true, immutable: true },
  reason: { type: String, maxlength: 500, immutable: true, select: false },
  submittedAt: { type: Date, required: true, immutable: true },
  policyVersion: { type: String, required: true, immutable: true },
}, { versionKey: false });
schema.index({ appointment: 1, participant: 1 }, { unique: true });
schema.index({ appointment: 1, participantRole: 1 }, { unique: true });
const blocked = () => { throw new Error("Attendance responses are immutable."); };
schema.pre("save", function () { if (!this.isNew) blocked(); });
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"]) schema.pre(operation, blocked);
schema.pre("deleteOne", { document: true, query: false }, blocked);
export default mongoose.model("AttendanceResponse", schema);
// Fail closed; deployment creates indexes separately, never from a request.
export async function assertAttendanceIndexes() {
  const indexes = await mongoose.model("AttendanceResponse").collection.indexes();
  for (const field of ["participant", "participantRole"]) {
    if (!indexes.some(index => index.unique === true && !index.partialFilterExpression && !index.sparse &&
      JSON.stringify(index.key) === JSON.stringify({ appointment: 1, [field]: 1 })))
      throw Object.assign(new Error("Attendance is temporarily unavailable."), { statusCode: 503 });
  }
}
