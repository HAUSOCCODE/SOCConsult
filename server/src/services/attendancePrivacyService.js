import { initiatorReportingRole } from "../config/attendance.js";

export function participation(appointment, actor) {
  if (actor.management || actor.deanManagementAccess) return null;
  const id = String(actor.id || actor._id || "");
  if (actor.role === "student" && String(appointment.student?._id || appointment.student) === id) return "student";
  if (["faculty", "dean"].includes(actor.role) && String(appointment.faculty?._id || appointment.faculty) === id) return "faculty";
  return null;
}
export function monitoringAttendance(row) {
  const a = row.attendance;
  if (!a?.policyVersion) return { verification: "not_verified", finalOutcome: null };
  const initiatorRole = initiatorReportingRole(row);
  return { verification: initiatorRole ? "initiator_report" : "two_party_workflow", policyVersion: a.policyVersion,
    initiatorRole,
    attendanceOpensAt: a.attendanceOpensAt, responseDeadlineAt: a.responseDeadlineAt,
    finalOutcome: a.finalOutcome ?? null, finalizedAt: a.finalizedAt ?? null,
    finalizationSource: a.finalizationSource ?? null, reviewReason: a.reviewReason ?? null,
    missingRoles: a.missingRoles || [], reviewStartedAt: a.reviewStartedAt ?? null };
}
export function participantAttendance(row, responses, role, now = new Date()) {
  const own = responses.find(r => r.participantRole === role), a = row.attendance;
  const enrolled = Boolean(a?.policyVersion);
  const initiatorRole = initiatorReportingRole(row, { hasResponses: responses.length > 0 });
  const initiatorWorkflow = Boolean(initiatorRole);
  const recorded = initiatorWorkflow ? responses[0] : null;
  return { enrolled, status: row.status, attendanceOpensAt: a?.attendanceOpensAt ?? null,
    policyVersion: a?.policyVersion ?? null,
    workflow: initiatorWorkflow ? "initiator_report" : "two_party",
    initiatorRole,
    responseDeadlineAt: a?.responseDeadlineAt ?? null,
    eligible: enrolled && !recorded && (!initiatorWorkflow || role === initiatorRole) &&
      ["Confirmed", "Awaiting Attendance Update"].includes(row.status) &&
      now >= new Date(row.endAt) && now < new Date(a.responseDeadlineAt),
    ownResponse: own ? { outcome: own.outcome, reason: own.reason || "", submittedAt: own.submittedAt } : null,
    recordedOutcome: recorded ? { outcome: recorded.outcome, reason: recorded.reason || "",
      submittedAt: recorded.submittedAt, reportedByRole: recorded.participantRole,
      proof: recorded.proof?.mimeType ? { name: recorded.proof.originalName, mimeType: recorded.proof.mimeType,
        size: recorded.proof.size, available: true } : null } : null,
    waiting: Boolean(!initiatorWorkflow && own && responses.length < 2 && ["Confirmed", "Awaiting Attendance Update"].includes(row.status)),
    outcomes: own && responses.length === 2 ? Object.fromEntries(responses.map(r => [r.participantRole, r.outcome])) : undefined,
    finalOutcome: a?.finalOutcome ?? null };
}
