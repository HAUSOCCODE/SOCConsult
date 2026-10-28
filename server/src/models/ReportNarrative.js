import mongoose from "mongoose";
import { appendOnly, filtersSchema, snapshotSchema } from "./reportNarrativeSchemas.js";
const schema = new mongoose.Schema({
  dean: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  generatedAt: { type: Date, required: true },
  filters: { type: filtersSchema, required: true },
  snapshot: { type: snapshotSchema, required: true },
  narrative: { type: String, required: true, maxlength: 3000 },
  reviewState: { type: String, enum: ["unreviewed"], default: "unreviewed", required: true },
  version: { type: Number, enum: [1], default: 1, required: true },
  promptVersion: { type: String, enum: ["dea14-v1"], default: "dea14-v1", required: true },
  dateBasis: { type: String, enum: ["createdAt"], default: "createdAt", required: true },
  timezone: { type: String, enum: ["Asia/Manila"], default: "Asia/Manila", required: true },
}, { strict: "throw", versionKey: false });
schema.index({ dean: 1, generatedAt: -1 });
appendOnly(schema);
export default mongoose.model("ReportNarrative", schema);
