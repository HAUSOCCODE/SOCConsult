import mongoose from "mongoose";
import { REVIEW_ACTIONS } from "../config/attendanceReview.js";
import { ATTENDANCE_OUTCOMES } from "../config/attendance.js";
const reference = ref => ({ type: mongoose.Schema.Types.ObjectId, ref, immutable: true });
const schema = new mongoose.Schema({
  appointment: { ...reference("Appointment"), required: true },
  dean: { ...reference("User"), required: true },
  action: { type: String, enum: Object.keys(REVIEW_ACTIONS), required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true, select: false },
  reviewedAt: { type: Date, required: true, immutable: true },
  previousStatus: { type: String, enum: ["Attendance Review"], required: true, immutable: true },
  resultingStatus: { type: String, enum: ["Attendance Review", "Completed"], required: true, immutable: true },
  finalOutcome: { type: String, enum: [...ATTENDANCE_OUTCOMES, null], default: null, immutable: true },
  isFinal: { type: Boolean, required: true, immutable: true },
  appointmentVersion: { type: Number, min: 0, required: true, immutable: true },
  studentResponse: { ...reference("AttendanceResponse"), default: null },
  facultyResponse: { ...reference("AttendanceResponse"), default: null },
}, { versionKey: false });
schema.index({ appointment: 1 }, { unique: true, partialFilterExpression: { isFinal: true } });
schema.index({ appointment: 1, reviewedAt: 1, _id: 1 });
schema.pre("validate", function () {
  const outcome = REVIEW_ACTIONS[this.action];
  if (this.isFinal !== (outcome != null) || this.finalOutcome !== outcome ||
      this.resultingStatus !== (this.isFinal ? "Completed" : "Attendance Review"))
    this.invalidate("action", "Inconsistent review decision.");
});
const blocked = () => { throw new Error("Attendance reviews are immutable."); };
schema.pre("save", function () { if (!this.isNew) blocked(); });
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"]) schema.pre(operation, blocked);
schema.pre("deleteOne", { document: true, query: false }, blocked);
const AttendanceReview = mongoose.model("AttendanceReview", schema);
export default AttendanceReview;
export async function assertReviewIndex() {
  const indexes = await AttendanceReview.collection.indexes();
  if (!indexes.some(index => index.unique === true && !index.sparse &&
    JSON.stringify(index.key) === JSON.stringify({ appointment: 1 }) &&
    JSON.stringify(index.partialFilterExpression) === JSON.stringify({ isFinal: true })))
    throw Object.assign(new Error("Attendance review is temporarily unavailable."), { statusCode: 503 });
}
