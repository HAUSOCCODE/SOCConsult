import mongoose from "mongoose";

export const filtersSchema = new mongoose.Schema({ start: { type: String, required: true }, end: { type: String, required: true }, facultyId: String, status: String, attendanceOutcome: String, mode: String }, { _id: false, strict: "throw" });
const countMap = { type: Map, of: { type: Number, min: 0, max: 1000, validate: Number.isInteger }, required: true };
export const snapshotSchema = new mongoose.Schema({ dateRange: { type: new mongoose.Schema({ start: { type: String, required: true }, end: { type: String, required: true } }, { _id: false, strict: "throw" }), required: true }, totalConsultations: { type: Number, required: true, min: 0, max: 1000, validate: Number.isInteger }, statusCounts: countMap, attendanceOutcomeCounts: countMap, consultationModeCounts: countMap }, { _id: false, strict: "throw" });
export function appendOnly(schema) {
  const blocked = () => { throw new Error("Narrative records are immutable."); };
  schema.pre("save", function () { if (!this.isNew) blocked(); });
  for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"]) schema.pre(operation, blocked);
  schema.pre("deleteOne", { document: true, query: false }, blocked);
}
