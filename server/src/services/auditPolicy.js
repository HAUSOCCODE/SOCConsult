import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../config/appointmentStatus.js";
const member = values => value => typeof value === "string" && values.includes(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000;
const ref = value => typeof value === "string" && /^(?:[a-f\d]{24}|[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12})$/i.test(value);
const date = value => (value instanceof Date || typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) && Number.isFinite(+new Date(value));
const role = member(["student", "faculty", "dean"]);
const status = member([...APPOINTMENT_STATUSES, ...LEGACY_APPOINTMENT_STATUSES, "Created", "Active", "Inactive"]);
const rules = {};
const add = (actions, fields = {}) => actions.split(" ").forEach(action => rules[action] = fields);
add("login logout login_failed student_registered faculty_registered registration_approved registration_rejected password_changed", { role });
add("account_activated account_deactivated", { role, previousStatus: status, newStatus: status, previousRegistrationStatus: member(["Pending", "Rejected", "Approved", "Not recorded"]), newRegistrationStatus: member(["Approved"]) });
add("dean_password_reset admin_password_reset", { role, context: member(["dean_user_management"]) });
add("account_created_manually", { role, accountSource: member(["manual"]) });
add("accounts_imported", { importId: ref, totalRows: count, successfulRows: count, failedRows: count, studentCount: count, facultyCount: count, importedAt: date, status: member(["completed"]) });
add("accounts_csv_validated", { totalRows: count, validRows: count, invalidRows: count, duplicateRows: count, outcome: member(["valid", "invalid", "rejected"]), code: member(["VALIDATED", "VALIDATION_ERRORS", "CSV_REJECTED"]) });
add("report_generated", { reportType: member(["soc_consultations_pdf"]), total: count, generatedAt: date });
add("report_narrative_generated report_narrative_reviewed", { timestamp: date });
add("ai_generation_started", { attemptId: ref });
add("ai_generation_attempt", { attemptId: ref, outcome: member(["success", "failed", "uncertain"]), stage: member(["provider", "persistence"]), code: member(["GENERATED", "PROVIDER_FAILED", "PROVIDER_UNCERTAIN", "PERSISTENCE_FAILED", "COMMIT_UNCERTAIN"]) });
add("attendance_review_resolved attendance_review_retained", { reviewId: ref, action: member(["confirm_completed", "confirm_student_no_show", "confirm_faculty_no_show", "leave_under_review"]) });
const transitions = "request confirm reject propose accept_proposal reject_proposal cancel expire".split(" ");
const attendance = "attendance_open attendance_finalize attendance_review attendance_response_submitted".split(" ");
add([...transitions.map(value => "appointment_" + value), ...attendance].join(" "), { source: member([...transitions, ...attendance]) });
add("profile_updated", { fieldNames: value => Array.isArray(value) && value.length <= 20 && value.every(member(["firstName", "middleName", "lastName", "name", "email", "yearLevel", "program", "position", "specialization", "profilePicture"])) });
add("profile_picture_updated profile_picture_removed task_assigned task_completed supporting_document_uploaded supporting_document_removed");
add("consultation_record_created consultation_record_updated");
add("appointment_created published_schedule_selected schedule_requested schedule_request_cancelled schedule_request_rejected schedule_request_approved appointment_approved appointment_rejected appointment_completed appointment_no_show appointment_cancelled appointment_reschedule_requested appointment_reschedule_approved appointment_reschedule_rejected appointment_reschedule_required appointment_rescheduled consultation_location_updated online_meeting_details_updated", { role, status, previousStatus: status, newStatus: status, documentCount: count });
export const AUDIT_ACTIONS = Object.freeze(Object.keys(rules));
// Project only approved paths even before action-specific serialization.
const metadataKeys = [...new Set(Object.values(rules).flatMap(fields => Object.keys(fields)))];
export const AUDIT_PROJECTION = ["action", "category", "actorUser", "actorRole", "actor", "relatedEntityType", "relatedEntityId", "targetType", "targetId", "createdAt",
  "changes.before.status", "changes.after.status", "changes.after.finalOutcome", ...metadataKeys.flatMap(key => ["metadata." + key, "details." + key])].join(" ");
export function safeMetadata(action, value) {
  const fields = rules[action] || {};
  return Object.fromEntries(Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {}).filter(([key, item]) => Object.hasOwn(fields, key) && fields[key](item)));
}
export function safeChanges(action, value) {
  const clean = part => Object.fromEntries(Object.entries(part || {}).filter(([key, item]) => /^(appointment_|attendance_|account_)/.test(action) && (key === "status" ? status(item) : key === "finalOutcome" && (item === null || member(["Completed", "Student No-show", "Faculty No-show"])(item)))));
  return { before: clean(value?.before), after: clean(value?.after) };
}
export const auditTitle = action => AUDIT_ACTIONS.includes(action) ? action.replaceAll("_", " ") : "Historical activity";
export function validateAudit(doc) {
  doc.description = auditTitle(doc.action);
  if (!["system"].includes(doc.actorRole) && !doc.actorUser && !doc.actor) throw new Error("Audit actor required.");
  if (doc.action !== "login_failed" && (!(doc.relatedEntityId || doc.targetId) || !(doc.relatedEntityType || doc.targetType))) throw new Error("Audit target required.");
  if (!AUDIT_ACTIONS.includes(doc.action)) throw new Error("Unsupported audit action.");
  if (doc.metadata && JSON.stringify(doc.metadata) !== JSON.stringify(safeMetadata(doc.action, doc.metadata))) throw new Error("Unsafe audit metadata.");
  if (doc.details && Object.keys(doc.details).length) throw new Error("Unsafe legacy audit details.");
  for (const part of ["before", "after"]) if (doc.changes?.[part] && JSON.stringify(doc.changes[part]) !== JSON.stringify(safeChanges(doc.action, doc.changes)[part])) throw new Error("Unsafe audit changes.");
}
