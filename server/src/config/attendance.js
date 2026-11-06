export const ATTENDANCE_POLICY = "CORE-03-v1";
export const INITIATOR_ATTENDANCE_POLICY = "CORE-04-v2";
export const RESPONSE_WINDOW_MS = 48 * 60 * 60 * 1000;
export const ATTENDANCE_OUTCOMES = Object.freeze(["Completed", "Student No-show", "Faculty No-show"]);
export const REVIEW_REASONS = Object.freeze(["student_response_missing", "faculty_response_missing", "both_responses_missing", "responses_conflict", "initiator_report_disputed"]);
export function attendanceEnrollment(endAt, { initiatedByRole } = {}) {
  const initiatorRole = ["student", "faculty"].includes(initiatedByRole) ? initiatedByRole : undefined;
  return { policyVersion: initiatorRole ? INITIATOR_ATTENDANCE_POLICY : ATTENDANCE_POLICY,
    initiatorRole, attendanceOpensAt: new Date(endAt),
    responseDeadlineAt: new Date(new Date(endAt).getTime() + RESPONSE_WINDOW_MS),
    studentResponded: false, facultyResponded: false, finalOutcome: null, missingRoles: [] };
}
