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
  return { verification: "two_party_workflow", policyVersion: a.policyVersion,
    attendanceOpensAt: a.attendanceOpensAt, responseDeadlineAt: a.responseDeadlineAt,
    finalOutcome: a.finalOutcome ?? null, finalizedAt: a.finalizedAt ?? null,
    finalizationSource: a.finalizationSource ?? null, reviewReason: a.reviewReason ?? null,
    missingRoles: a.missingRoles || [], reviewStartedAt: a.reviewStartedAt ?? null };
}
export function participantAttendance(row, responses, role, now = new Date()) {
  const own = responses.find(r => r.participantRole === role), a = row.attendance;
  const enrolled = Boolean(a?.policyVersion);
  return { enrolled, status: row.status, attendanceOpensAt: a?.attendanceOpensAt ?? null,
    policyVersion: a?.policyVersion ?? null,
    responseDeadlineAt: a?.responseDeadlineAt ?? null,
    eligible: enrolled && !own && ["Confirmed", "Awaiting Attendance Update"].includes(row.status) &&
      now >= new Date(row.endAt) && now < new Date(a.responseDeadlineAt),
    ownResponse: own ? { outcome: own.outcome, reason: own.reason || "", submittedAt: own.submittedAt } : null,
    waiting: Boolean(own && responses.length < 2 && ["Confirmed", "Awaiting Attendance Update"].includes(row.status)),
    outcomes: own && responses.length === 2 ? Object.fromEntries(responses.map(r => [r.participantRole, r.outcome])) : undefined,
    finalOutcome: a?.finalOutcome ?? null };
}
