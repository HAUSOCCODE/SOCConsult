import AuditLog from "../models/AuditLog.js";
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

const SAFE_DETAIL_KEYS = new Set([
  "role",
  "status",
  "previousStatus",
  "newStatus",
  "mode",
  "previousMode",
  "newMode",
  "documentCount",
  "fieldNames",
]);
const sanitizeObject = (value = {}) =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => SAFE_DETAIL_KEYS.has(key) && item != null)
      .map(([key, item]) => [
        key,
        Array.isArray(item)
          ? item.map(String).slice(0, 20)
          : String(item).slice(0, 200),
      ]),
  );

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
    const safeChanges = {
      before: sanitizeObject(changes?.before),
      after: sanitizeObject(changes?.after),
    };
    const safeMetadata = sanitizeObject(metadata);
    await Promise.all(
      (subjectlessFailure ? [null] : subjects).map((subject) =>
        AuditLog.create({
          subjectUser: subject?._id,
          subjectRole: subject?.role,
          actorUser: actorUser || undefined,
          actorRole: actorRole || actor?.role || "system",
          actor: actorUser || undefined,
          action,
          category,
          description: String(description || "Activity recorded.").slice(
            0,
            500,
          ),
          relatedEntityType: relatedEntityType || undefined,
          relatedEntityId: relatedEntityId || undefined,
          changes: safeChanges,
          metadata: safeMetadata,
          targetType: relatedEntityType,
          targetId: relatedEntityId,
          details: safeMetadata,
        }),
      ),
    );
  } catch (error) {
    console.error("[Audit] Unable to record activity:", error.message);
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
      "[Audit] Unable to resolve activity subjects:",
      error.message,
    );
  }
}
export const notify = (recipient, type, title, message, relatedEntityId) =>
  Notification.create({
    recipient,
    type,
    title,
    message,
    relatedEntityId,
  }).catch(console.error);
