import mongoose from "mongoose";

const errorSchema = new mongoose.Schema(
  { field: String, code: String, message: String },
  { _id: false },
);
const rowSchema = new mongoose.Schema(
  {
    rowNumber: Number,
    endLineNumber: Number,
    dataRowNumber: Number,
    institutional_id: String,
    first_name: String,
    middle_name: String,
    last_name: String,
    official_email: String,
    role: String,
    fullName: String,
    valid: Boolean,
    errors: [errorSchema],
  },
  { _id: false, suppressReservedKeysWarning: true },
);
const schema = new mongoose.Schema({
  previewId: { type: String, required: true, unique: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  rows: [rowSchema],
  summary: {
    totalRows: Number,
    validRows: Number,
    invalidRows: Number,
    duplicateRows: Number,
  },
  schemaVersion: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model("AccountImport", schema);
