import Appointment from "../models/Appointment.js";
import mongoose from "mongoose";
export const verifiedCompletedFilter = { status: "Completed", "attendance.finalOutcome": "Completed", "attendance.finalizationSource": "participant_agreement" };
export function attendanceClassification(row) {
  if (row.status === "Attendance Review") return "attendanceReview";
  if (row.status !== "Completed") return "other";
  if (row.attendance?.finalizationSource !== "participant_agreement") return "historicalUnverifiedCompleted";
  return { Completed: "verifiedCompleted", "Student No-show": "studentNoShow", "Faculty No-show": "facultyNoShow" }[row.attendance.finalOutcome] || "historicalUnverifiedCompleted";
}
export async function attendanceCounts(filter = {}) {
  const match = { ...filter };
  // Aggregation pipelines do not receive Mongoose query casting.
  for (const field of ["student", "faculty"]) if (typeof match[field] === "string" && mongoose.isValidObjectId(match[field])) match[field] = new mongoose.Types.ObjectId(match[field]);
  const rows = await Appointment.aggregate([{ $match: match }, { $group: {
    _id: { status: "$status", outcome: "$attendance.finalOutcome", source: "$attendance.finalizationSource" }, count: { $sum: 1 },
  } }]);
  const counts = { verifiedCompleted: 0, studentNoShow: 0, facultyNoShow: 0, historicalUnverifiedCompleted: 0, attendanceReview: 0 };
  for (const row of rows) {
    const key = attendanceClassification({ status: row._id?.status, attendance: { finalOutcome: row._id?.outcome, finalizationSource: row._id?.source } });
    if (key in counts) counts[key] += row.count;
  }
  return counts;
}
