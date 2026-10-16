import { validateAudit, AUDIT_ACTIONS, safeMetadata, safeChanges } from "../services/auditPolicy.js";
import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    subjectUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    subjectRole: { type: String, enum: ["student", "faculty", "dean"] },
    subjectUsers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: undefined },
    actorUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorRole: {
      type: String,
      enum: ["student", "faculty", "dean", "system"],
      default: "system",
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true, enum: AUDIT_ACTIONS, index: true },
    category: {
      type: String,
      enum: [
        "Account",
        "Authentication",
        "Profile",
        "Consultation",
        "Appointment",
        "Documents",
        "Tasks",
      ],
      required: true,
      default: "Account",
    },
    description: { type: String, trim: true, maxlength: 500 },
    relatedEntityType: { type: String, enum: ["User", "Appointment", "Task", "SupportingDocument", "AccountImport", "ReportExport", "ReportNarrative", "AuditAttempt"], trim: true, maxlength: 50 },
    relatedEntityId: mongoose.Schema.Types.ObjectId,
    changes: {
      before: { type: mongoose.Schema.Types.Mixed, default: undefined, validate: { validator(value) { return JSON.stringify(value) === JSON.stringify(safeChanges(this.action, { before: value }).before); }, message: "Unsafe audit changes." } },
      after: { type: mongoose.Schema.Types.Mixed, default: undefined, validate: { validator(value) { return JSON.stringify(value) === JSON.stringify(safeChanges(this.action, { after: value }).after); }, message: "Unsafe audit changes." } },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined, validate: { validator(value) { return JSON.stringify(value) === JSON.stringify(safeMetadata(this.action, value)); }, message: "Unsafe audit metadata." } },
    // Legacy target fields are retained so existing trustworthy records remain readable.
    targetType: { type: String, enum: ["User", "Appointment", "Task", "SupportingDocument", "AccountImport", "ReportExport", "ReportNarrative", "AuditAttempt"] },
    targetId: mongoose.Schema.Types.ObjectId,
    details: { type: mongoose.Schema.Types.Mixed, default: {}, validate: value => value && !Array.isArray(value) && Object.keys(value).length === 0 },
  },
  { timestamps: true, strict: "throw" },
);
schema.index({ createdAt: -1 });
schema.index({ createdAt: -1, _id: -1 });
schema.pre("validate", function () { if (this.isNew) validateAudit(this); });
schema.pre("insertMany", function (next, docs, options) {
  try {
    // Lean insertion bypasses Mongoose validation and strict field checks.
    if (options?.lean) throw new Error("Unvalidated audit insertion is prohibited.");
    for (const value of docs) {
      const record = new this(value);
      validateAudit(record);
      const error = record.validateSync();
      if (error) throw new Error("Invalid audit record.");
      value.description = record.description;
    }
    next();
  } catch (error) { next(error); }
});
const blocked = () => { throw new Error("Audit records are immutable."); };
schema.pre("save", function () {
  if (!this.isNew) blocked();
  validateAudit(this);
  if (this.validateSync()) throw new Error("Invalid audit record.");
});
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"]) schema.pre(operation, blocked);
schema.pre("deleteOne", { document: true, query: false }, blocked);
schema.index({ subjectUser: 1, createdAt: -1 });
schema.index({ subjectUsers: 1, createdAt: -1 });
schema.index({ subjectRole: 1, createdAt: -1 });
schema.index({ action: 1, createdAt: -1 });
schema.index({ category: 1, createdAt: -1 });
export default mongoose.model("AuditLog", schema);
