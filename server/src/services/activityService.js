import { safeMetadata, safeChanges } from "./auditPolicy.js";
import AuditLog from "../models/AuditLog.js";

// Strict report audit: caller must commit this together with append-only metadata.
export async function recordReportExportAudit({ actor, report, summary, session }) {
  await AuditLog.create([{ subjectUser: actor, subjectRole: "dean", actorUser: actor, actorRole: "dean", actor,
    action: "report_generated", category: "Consultation", description: "School of Computing PDF report generated",
    relatedEntityType: "ReportExport", relatedEntityId: report._id,
    metadata: { reportType: "soc_consultations_pdf", total: summary.total, generatedAt: report.generatedAt },
  }], { session });
}
export async function recordFacultyReportExportAudit({ actor, role, report, summary, session }) {
  await AuditLog.create([{ subjectUser: actor, subjectRole: role, actorUser: actor, actorRole: role, actor,
    action: "report_generated", category: "Consultation", description: "Personal Faculty consultation PDF report generated",
    relatedEntityType: "ReportExport", relatedEntityId: report._id,
    metadata: { reportType: "faculty_consultation_report", total: summary.total, generatedAt: report.generatedAt },
  }], { session });
}
import Appointment from "../models/Appointment.js";
import Notification from "../models/Notification.js";
import Task from "../models/Task.js";
import User from "../models/User.js";

const ACTIONS = {
  student_registered: ["Registration submitted", "Account"],
  faculty_registered: ["Registration submitted", "Account"],
  registration_approved: ["Account approved", "Account"],
  registration_rejected: ["Registration rejected", "Account"],
  account_activated: ["Account activated", "Account"],
  account_deactivated: ["Account deactivated", "Account"],
  admin_password_reset: ["Password reset by administrator", "Account"],
  dean_password_reset: ["Password reset by dean", "Account"],
  password_changed: ["Password changed", "Account"],
  login: ["Successful sign-in", "Authentication"],
  logout: ["Signed out", "Authentication"],
  profile_updated: ["Profile information updated", "Profile"],
  profile_picture_updated: ["Profile picture updated", "Profile"],
  profile_picture_removed: ["Profile picture removed", "Profile"],
  appointment_created: ["Consultation request submitted", "Consultation"],
  published_schedule_selected: ["Published schedule selected", "Appointment"],
  schedule_requested: ["Direct schedule request submitted", "Consultation"],
  schedule_request_cancelled: ["Schedule request cancelled", "Appointment"],
  schedule_request_rejected: ["Appointment rejected", "Appointment"],
  schedule_request_approved: [
    "Faculty assigned a consultation schedule",
    "Appointment",
  ],
  appointment_approved: ["Appointment approved", "Appointment"],
  appointment_rejected: ["Appointment rejected", "Appointment"],
  appointment_completed: ["Consultation marked completed", "Consultation"],
  appointment_no_show: ["Consultation marked No Show", "Consultation"],
  appointment_cancelled: ["Appointment cancelled", "Appointment"],
  appointment_reschedule_requested: ["Reschedule requested", "Appointment"],
  appointment_reschedule_approved: ["Reschedule approved", "Appointment"],
  appointment_reschedule_rejected: ["Reschedule rejected", "Appointment"],
  appointment_reschedule_required: [
    "Faculty requested a new schedule",
    "Appointment",
  ],
  appointment_rescheduled: ["Consultation rescheduled", "Appointment"],
  supporting_document_uploaded: ["Supporting document uploaded", "Documents"],
  supporting_document_removed: ["Supporting document removed", "Documents"],
  consultation_location_updated: [
    "Consultation location added or changed",
    "Appointment",
  ],
  online_meeting_details_updated: [
    "Online meeting details added or changed",
    "Appointment",
  ],
  task_assigned: ["Follow-up task assigned", "Tasks"],
  task_completed: ["Follow-up task marked completed", "Tasks"],
};

const subjectsFor = async (targetType, targetId, actorUser) => {
  if (targetType === "User") return [String(targetId)];
  if (targetType === "Appointment") {
    const record = await Appointment.findOne({ _id: targetId });
    return [record?.student, record?.faculty].filter(Boolean).map(String);
  }
  if (targetType === "Task") {
    const record = await Task.findOne({ _id: targetId });
    return [record?.student, record?.faculty].filter(Boolean).map(String);
  }
  return actorUser ? [String(actorUser)] : [];
};

export async function recordAuditEvent({
  subjectUser,
  subjectUsers,
  actorUser,
  actorRole,
  action,
  category,
  description,
  relatedEntityType,
  relatedEntityId,
  changes,
  metadata,
}) {
  try {
    const ids = [
      ...new Set(
        [subjectUser, ...(subjectUsers || [])].filter(Boolean).map(String),
      ),
    ];
    // The schema permits subjectless system events. Keep this exception narrow.
    const subjectlessFailure = !ids.length && action === "login_failed" &&
      category === "Authentication" && actorRole === "system" && !actorUser;
    if (!ids.length && !subjectlessFailure) return;
    const records = await Promise.all(ids.map((id) => User.findById(id)));
    const subjects = records.filter((user) =>
      ["student", "faculty", "dean"].includes(user?.role),
    );
    const actor =
      actorUser && !actorRole
        ? records.find(
            (user) => String(user?._id || user?.id) === String(actorUser),
          ) || (await User.findById(actorUser))
        : null;
    const filteredChanges = {
      before: safeChanges(action, changes).before,
      after: safeChanges(action, changes).after,
    };
    const filteredMetadata = safeMetadata(action, metadata);
    await Promise.all(
      (subjectlessFailure ? [null] : subjects.slice(0, 1)).map((subject) =>
        AuditLog.create({
          subjectUser: subject?._id,
          subjectRole: subject?.role,
          subjectUsers: subjects.map(user => user._id),
          actorUser: actorUser || undefined,
          actorRole: actorRole || actor?.role || "system",
          actor: actorUser || undefined,
          action,
          category,
          description: ACTIONS[action]?.[0] || "Activity recorded.",
          relatedEntityType: relatedEntityType || undefined,
          relatedEntityId: relatedEntityId || undefined,
          changes: filteredChanges,
          metadata: filteredMetadata,
          targetType: relatedEntityType,
          targetId: relatedEntityId,
          details: {},
        }),
      ),
    );
  } catch (error) {
    console.error("[Audit] Unable to record activity.");
  }
}

export async function logActivity(
  action,
  actor,
  targetType,
  targetId,
  details = {},
) {
  const [title, category] = ACTIONS[action] || [
    action.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()),
    "Account",
  ];
  try {
    const subjectUsers = await subjectsFor(targetType, targetId, actor);
    await recordAuditEvent({
      subjectUsers,
      actorUser: actor,
      action,
      category,
      description: title,
      relatedEntityType: targetType,
      relatedEntityId: targetId,
      changes:
        details.previousStatus || details.newStatus
          ? {
              before: { status: details.previousStatus },
              after: { status: details.newStatus },
            }
          : undefined,
      metadata: details,
    });
  } catch (error) {
    console.error(
      "[Audit] Unable to resolve activity subjects.",
    );
  }
}
export const notify = (recipient, type, title, message, relatedEntityId) =>
  Notification.create({
    recipient,
    category: type === "registration" ? "Management" : "Consultation",
    type,
    title,
    message,
    relatedEntityId,
  }).catch(() => { console.warn("[Notification] Delivery failed."); return false; });

// Status and audit must commit together. Free-text reasons never enter the audit log.
export async function recordUserStatusAudit({ user, actor, previousStatus, session }) {
  await AuditLog.create([{
    subjectUser: user._id, subjectRole: user.role, actorUser: actor, actorRole: "dean", actor,
    action: user.accountStatus === "Active" ? "account_activated" : "account_deactivated",
    category: "Account", description: user.accountStatus === "Active" ? "Account activated" : "Account deactivated",
    relatedEntityType: "User", relatedEntityId: user._id,
    changes: { before: { status: previousStatus }, after: { status: user.accountStatus } },
    metadata: { role: user.role, previousStatus, newStatus: user.accountStatus },
  }], { session });
}

// Strict provisioning audit: failure must abort the enclosing transaction.
export async function recordManualAccountAudit({ user, actor, session }) {
  await AuditLog.create([{
    subjectUser: user._id, subjectRole: user.role,
    actorUser: actor, actorRole: "dean", actor,
    action: "account_created_manually", category: "Account",
    description: "User account created manually",
    relatedEntityType: "User", relatedEntityId: user._id,
    metadata: { role: user.role, accountSource: "manual" },
  }], { session });
}

// Strict, transaction-aware batch audit. Never pass row data or generic metadata here.
export async function recordAccountImportAudit({ batch, actor, session }) {
  await AuditLog.create([{
    subjectUser: actor,
    subjectRole: "dean",
    actorUser: actor,
    actorRole: "dean",
    actor,
    action: "accounts_imported",
    category: "Account",
    description: "CSV account batch completed",
    relatedEntityType: "AccountImport",
    relatedEntityId: batch._id,
    metadata: {
      importId: batch.previewId,
      totalRows: batch.summary.totalRows,
      successfulRows: batch.successfulRows,
      failedRows: batch.failedRows,
      studentCount: batch.studentCount,
      facultyCount: batch.facultyCount,
      importedAt: batch.importedAt.toISOString(),
      status: batch.status,
    },
  }], { session });
}

// Security-sensitive audit failures must abort the enclosing transaction.
export async function recordPasswordResetAudit({ user, actor, timestamp, session }) {
  await AuditLog.create([{
    subjectUser: user._id, subjectRole: user.role, actorUser: actor, actorRole: "dean", actor,
    action: "dean_password_reset", category: "Account", description: "Password reset by dean",
    relatedEntityType: "User", relatedEntityId: user._id,
    metadata: { role: user.role, context: "dean_user_management" }, createdAt: timestamp,
  }], { session });
}

export async function recordAuthenticationAudit(user, action) {
  await AuditLog.create({ subjectUser: user._id || user.id, subjectRole: user.role, actorUser: user._id || user.id, actorRole: user.role,
    action, category: "Authentication", description: action === "login" ? "Successful sign-in" : "Signed out",
    relatedEntityType: "User", relatedEntityId: user._id || user.id, metadata: { role: user.role } });
}
