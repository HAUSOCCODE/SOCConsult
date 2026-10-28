import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    dean: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required() { return this.reportType === "soc_consultations_pdf"; },
      immutable: true,
    },
    requestingUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required() { return this.reportType === "faculty_consultation_report"; }, immutable: true },
    requestingRole: { type: String, enum: ["faculty", "dean"], required() { return this.reportType === "faculty_consultation_report"; }, immutable: true },
    reportType: {
      type: String,
      enum: ["soc_consultations_pdf", "faculty_consultation_report"],
      required: true,
      immutable: true,
    },
    generatedAt: { type: Date, required: true, immutable: true },
    dateBasis: {
      type: String,
      enum: ["createdAt", "startAt"],
      required: true,
      immutable: true,
    },
    timezone: {
      type: String,
      enum: ["Asia/Manila"],
      required: true,
      immutable: true,
    },
    filters: {
      type: new mongoose.Schema(
        {
          start: String,
          end: String,
          startDate: String,
          endDate: String,
          facultyId: String,
          status: String,
          attendanceOutcome: String,
          mode: String,
        },
        { _id: false, strict: "throw" },
      ),
      required: true,
      immutable: true,
    },
    summary: {
      type: new mongoose.Schema(
        {
          total: { type: Number, min: 0, max: 1000, required: true },
          status: { type: Map, of: Number },
          attendance: { type: Map, of: Number },
          mode: { type: Map, of: Number },
        },
        { _id: false, strict: "throw" },
      ),
      required: true,
      immutable: true,
    },
  },
  { versionKey: false, strict: "throw" },
);
schema.index({ dean: 1, generatedAt: -1 });
schema.index({ requestingUser: 1, generatedAt: -1 });
const blocked = () => {
  throw new Error("Report exports are immutable.");
};
schema.pre("save", function () {
  if (!this.isNew) blocked();
});
for (const operation of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "bulkWrite",
])
  schema.pre(operation, blocked);
schema.pre("deleteOne", { document: true, query: false }, blocked);
export default mongoose.model("ReportExport", schema);
