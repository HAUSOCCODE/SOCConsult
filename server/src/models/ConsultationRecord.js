import mongoose from "mongoose";

export const CONSULTATION_NOTES_LIMIT = 3000;
export const CONSULTATION_RECOMMENDATIONS_LIMIT = 3000;

const schema = new mongoose.Schema({
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, unique: true, immutable: true },
  facultyAuthor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  notes: { type: String, trim: true, maxlength: CONSULTATION_NOTES_LIMIT, default: "" },
  recommendations: { type: String, trim: true, maxlength: CONSULTATION_RECOMMENDATIONS_LIMIT, default: "" },
}, { timestamps: true });

schema.pre("validate", function () {
  if (!this.notes?.trim() && !this.recommendations?.trim()) this.invalidate("notes", "At least one consultation-record field is required.");
});

export default mongoose.model("ConsultationRecord", schema);
