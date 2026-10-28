import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import AttendanceResponse from "../models/AttendanceResponse.js";
import { ATTENDANCE_POLICY, RESPONSE_WINDOW_MS } from "../config/attendance.js";

// Read-only, authoritative response absence; cached response flags are not eligibility.
export async function countRequiredAttendance(participant, role, now) {
  const participantId = new mongoose.Types.ObjectId(participant);
  const rows = await Appointment.aggregate([
    { $match: { [role]: participantId, status: { $in: ["Confirmed", "Awaiting Attendance Update"] },
      "attendance.policyVersion": ATTENDANCE_POLICY, startAt: { $type: "date" }, endAt: { $type: "date", $lte: now },
      "attendance.responseDeadlineAt": { $gt: now },
      $expr: { $and: [{ $gt: ["$endAt", "$startAt"] },
        { $eq: ["$attendance.attendanceOpensAt", "$endAt"] },
        { $eq: ["$attendance.responseDeadlineAt", { $add: ["$endAt", RESPONSE_WINDOW_MS] }] }] } } },
    { $lookup: { from: AttendanceResponse.collection.name, let: { appointmentId: "$_id" }, pipeline: [
      { $match: { participant: participantId, participantRole: role, $expr: { $eq: ["$appointment", "$$appointmentId"] } } },
      { $project: { _id: 1 } }, { $limit: 1 },
    ], as: "ownResponse" } },
    { $match: { "ownResponse.0": { $exists: false } } }, { $count: "count" },
  ]).option({ maxTimeMS: 10000 });
  return rows[0]?.count ?? 0;
}
