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
    action: { type: String, required: true, index: true },
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
    relatedEntityType: { type: String, trim: true, maxlength: 50 },
    relatedEntityId: mongoose.Schema.Types.ObjectId,
    changes: {
      before: { type: mongoose.Schema.Types.Mixed, default: undefined },
      after: { type: mongoose.Schema.Types.Mixed, default: undefined },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // Legacy target fields are retained so existing trustworthy records remain readable.
    targetType: String,
    targetId: mongoose.Schema.Types.ObjectId,
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ createdAt: -1 });
schema.index({ subjectUser: 1, createdAt: -1 });
schema.index({ subjectUsers: 1, createdAt: -1 });
schema.index({ subjectRole: 1, createdAt: -1 });
schema.index({ action: 1, createdAt: -1 });
schema.index({ category: 1, createdAt: -1 });
export default mongoose.model("AuditLog", schema);
