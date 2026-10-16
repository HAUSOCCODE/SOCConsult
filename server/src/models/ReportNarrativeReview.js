import mongoose from "mongoose";
import { appendOnly } from "./reportNarrativeSchemas.js";
const schema = new mongoose.Schema({
  summary: { type: mongoose.Schema.Types.ObjectId, ref: "ReportNarrative", required: true, unique: true },
  dean: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reviewedAt: { type: Date, required: true },
  reviewState: { type: String, enum: ["reviewed"], default: "reviewed", required: true },
  expectedVersion: { type: Number, enum: [1], required: true },
  version: { type: Number, enum: [2], default: 2, required: true },
}, { strict: "throw", versionKey: false });
appendOnly(schema);
export default mongoose.model("ReportNarrativeReview", schema);
