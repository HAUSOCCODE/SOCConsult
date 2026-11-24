import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import AttendanceResponse from "../models/AttendanceResponse.js";
import { ATTENDANCE_POLICY, INITIATOR_ATTENDANCE_POLICY, RESPONSE_WINDOW_MS,
  initiatorReportingRole } from "../config/attendance.js";

// Read-only, authoritative response absence; cached response flags are not eligibility.
export async function countRequiredAttendance(participant, role, now) {
  const participantId = new mongoose.Types.ObjectId(participant);
  const rows = await Appointment.aggregate([
    { $match: { [role]: participantId, status: { $in: ["Confirmed", "Awaiting Attendance Update"] },
      "attendance.policyVersion": { $in: [ATTENDANCE_POLICY, INITIATOR_ATTENDANCE_POLICY] },
      startAt: { $type: "date" }, endAt: { $type: "date", $lte: now },
      "attendance.responseDeadlineAt": { $gt: now },
      $expr: { $and: [{ $gt: ["$endAt", "$startAt"] },
        { $eq: ["$attendance.attendanceOpensAt", "$endAt"] },
        { $eq: ["$attendance.responseDeadlineAt", { $add: ["$endAt", RESPONSE_WINDOW_MS] }] }] } } },
    { $lookup: { from: AttendanceResponse.collection.name, let: { appointmentId: "$_id" }, pipeline: [
      { $match: { $expr: { $eq: ["$appointment", "$$appointmentId"] } } },
      { $project: { _id: 0, participantRole: 1 } },
    ], as: "responses" } },
    { $project: { _id: 0, initiatedByRole: 1, attendance: 1, responses: 1 } },
  ]).option({ maxTimeMS: 10000 });
  // The date/status match bounds candidates to the active 48-hour window. The
  // appointment-prefixed response index supports this lookup (at most two roles),
  // without fetching private response content or issuing a query per appointment.
  return rows.reduce((count, row) => {
    const initiatorRole = initiatorReportingRole(row, { hasResponses: row.responses.length > 0 });
    const required = initiatorRole
      ? role === initiatorRole && row.responses.length === 0
      : !row.responses.some(response => response.participantRole === role);
    return count + Number(required);
  }, 0);
}
