import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
    },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
    },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["student", "faculty", "admin"],
      required: true,
      index: true,
    },
    studentId: { type: String, trim: true },
    employeeId: { type: String, trim: true },
    program: { type: String, trim: true },
    position: { type: String, trim: true, maxlength: 100 },
    // Legacy Faculty data may still contain department. New Faculty flows use position.
    department: { type: String, trim: true },
    yearLevel: { type: String, trim: true },
    office: { type: String, trim: true },
    specialization: { type: String, trim: true },
    contactNumber: { type: String, trim: true },
    profilePicture: {
      type: mongoose.Schema.Types.Mixed,
      select: false,
    },
    registrationStatus: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
      index: true,
    },
    accountStatus: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Inactive",
      index: true,
    },
    emailVerified: { type: Boolean, default: undefined },
    emailVerifiedAt: Date,
    approvalMethod: {
      type: String,
      enum: ["admin", "email_verification", "system"],
      default: null,
    },
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectedAt: Date,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    passwordChangedAt: Date,
    // Kept temporarily for safe migration of records created by the initial version.
    isActive: Boolean,
    isApproved: Boolean,
  },
  { timestamps: true },
);

export default mongoose.model("User", userSchema);
