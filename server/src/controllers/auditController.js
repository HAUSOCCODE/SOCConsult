import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";
import { formatFullName } from "../services/personNameService.js";

const ROLES = ["student", "faculty"];
const CATEGORIES = [
  "Account",
  "Authentication",
  "Profile",
  "Consultation",
  "Appointment",
  "Documents",
  "Tasks",
];
const MANILA_OFFSET = 8 * 60 * 60 * 1000;
const ACTION_LABELS = {
  student_registered: "Registration submitted",
  faculty_registered: "Registration submitted",
  registration_approved: "Account approved",
  registration_rejected: "Registration rejected",
  account_activated: "Account activated",
  account_deactivated: "Account deactivated",
  admin_password_reset: "Password reset by administrator",
  dean_password_reset: "Password reset by dean",
  password_changed: "Password changed",
  login: "Successful sign-in",
  profile_updated: "Profile information updated",
  profile_picture_updated: "Profile picture updated",
  profile_picture_removed: "Profile picture removed",
  appointment_created: "Consultation request submitted",
  published_schedule_selected: "Published schedule selected",
  schedule_requested: "Direct schedule request submitted",
  schedule_request_cancelled: "Schedule request cancelled",
  schedule_request_rejected: "Appointment rejected",
  schedule_request_approved: "Faculty assigned a consultation schedule",
  appointment_approved: "Appointment approved",
  appointment_rejected: "Appointment rejected",
  appointment_completed: "Consultation marked completed",
  appointment_no_show: "Consultation marked No Show",
  appointment_cancelled: "Appointment cancelled",
  appointment_reschedule_requested: "Reschedule requested",
  appointment_reschedule_approved: "Reschedule approved",
  appointment_reschedule_rejected: "Reschedule rejected",
  appointment_reschedule_required: "Faculty requested a new schedule",
  appointment_rescheduled: "Consultation rescheduled by faculty",
  supporting_document_uploaded: "Supporting document uploaded",
  supporting_document_removed: "Supporting document removed",
  consultation_location_updated: "Consultation location added or changed",
  online_meeting_details_updated: "Online meeting details added or changed",
  task_assigned: "Follow-up task assigned",
  task_completed: "Follow-up task marked completed",
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const positiveInteger = (value, fallback, max) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max
    ? parsed
    : null;
};
const parseDate = (value, end = false) => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const utc = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== value)
    return false;
  return new Date(utc.getTime() - MANILA_OFFSET + (end ? 86400000 : 0));
};
const profileUrl = (value) =>
  typeof value === "string" ? value : value?.url || null;
const publicUser = (user, lastActivity = null) => ({
  id: String(user._id),
  firstName: user.firstName || "",
  middleName: user.middleName || "",
  lastName: user.lastName || "",
  name: formatFullName(user),
  email: user.email,
  role: user.role,
  studentId: user.studentId || null,
  employeeId: user.employeeId || null,
  yearLevel: user.yearLevel || null,
  program: user.program || null,
  position: user.position || null,
  specialization: user.specialization || null,
  accountStatus: user.accountStatus,
  registrationStatus: user.registrationStatus,
  profilePicture: profileUrl(user.profilePicture),
  registeredAt: user.createdAt,
  lastActivity,
});
const logQueryFor = (userId) => ({
  // Retained for the future authorized review workflow, excluded from general
  // activity so a Dean acting as Faculty cannot discover a counterpart's submission.
  action: { $ne: "attendance_response_submitted" },
  $or: [
    { subjectUser: userId },
    { subjectUsers: userId },
    { subjectUser: { $exists: false }, targetType: "User", targetId: userId },
  ],
});
const categoryFor = (log) =>
  log.category ||
  (log.action === "login"
    ? "Authentication"
    : /profile/.test(log.action)
      ? "Profile"
      : /task/.test(log.action)
        ? "Tasks"
        : /document/.test(log.action)
          ? "Documents"
          : /appointment|schedule|reschedul/.test(log.action)
            ? "Appointment"
            : "Account");
const actorName = (log) => {
  const actor = log.actorUser || log.actor;
  if (actor?.name) return actor.name;
  if (log.actorRole === "system") return "SOCConsult System";
  return "SOCConsult System";
};
const PUBLIC_METADATA_KEYS = new Set([
  "appointmentId",
  "facultyName",
  "studentName",
  "topic",
  "previousSchedule",
  "newSchedule",
  "reason",
  "initiatedBy",
]);
const publicMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object") return null;
  const safe = Object.fromEntries(
    Object.entries(metadata)
      .filter(([key, value]) => PUBLIC_METADATA_KEYS.has(key) && value != null)
      .map(([key, value]) => [key, String(value).slice(0, 500)]),
  );
  return Object.keys(safe).length ? safe : null;
};
const publicLog = (log) => ({
  id: String(log._id),
  action: log.action,
  title: ACTION_LABELS[log.action] || log.description || "Activity recorded",
  category: categoryFor(log),
  description:
    log.description || ACTION_LABELS[log.action] || "Activity recorded.",
  actor: {
    name: actorName(log),
    role: log.actorRole || log.actorUser?.role || log.actor?.role || "system",
  },
  relatedRecord:
    log.relatedEntityId || log.targetId
      ? {
          type: log.relatedEntityType || log.targetType || "Record",
          id: String(log.relatedEntityId || log.targetId),
        }
      : null,
  changes: {
    before: log.changes?.before || null,
    after: log.changes?.after || null,
  },
  metadata: publicMetadata(log.metadata || log.details),
  createdAt: log.createdAt,
});

const validatedFilters = (req, res) => {
  const page = positiveInteger(req.query.page, 1, 100000);
  const limit = positiveInteger(req.query.limit, 20, 100);
  const category = req.query.category || "";
  const start = parseDate(req.query.startDate);
  const end = parseDate(req.query.endDate, true);
  if (!page || !limit)
    return res
      .status(400)
      .json({ message: "Page and limit must be positive numbers." });
  if (category && !CATEGORIES.includes(category))
    return res.status(400).json({ message: "Invalid activity category." });
  if (start === false || end === false || (start && end && start >= end))
    return res.status(400).json({ message: "Choose a valid date range." });
  return { page, limit, category, start, end };
};

export async function getAuditUsers(req, res) {
  const role = req.query.role || "student";
  const page = positiveInteger(req.query.page, 1, 100000);
  const limit = positiveInteger(req.query.limit, 8, 50);
  if (!ROLES.includes(role))
    return res
      .status(400)
      .json({ message: "Role must be student or faculty." });
  if (!page || !limit)
    return res
      .status(400)
      .json({ message: "Page and limit must be positive numbers." });
  const search = String(req.query.search || "")
    .trim()
    .slice(0, 100);
  const query = { role, registrationStatus: "Approved" };
  if (search) {
    const match = new RegExp(escapeRegex(search), "i");
    query.$or = [
      { name: match },
      { email: match },
      role === "student" ? { studentId: match } : { employeeId: match },
    ];
  }
  const [users, total, counts] = await Promise.all([
    User.find(query)
      .select(
        "name firstName middleName lastName email role studentId employeeId yearLevel program position specialization accountStatus registrationStatus createdAt +profilePicture",
      )
      .sort({ name: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(query),
    User.aggregate([
      { $match: { role: { $in: ROLES }, registrationStatus: "Approved" } },
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]),
  ]);
  const ids = users.map((user) => user._id);
  const activity = ids.length
    ? await AuditLog.aggregate([
        {
          $match: {
            action: { $ne: "attendance_response_submitted" },
            $or: [
              { subjectUser: { $in: ids } },
              { subjectUsers: { $in: ids } },
              {
                subjectUser: { $exists: false },
                targetType: "User",
                targetId: { $in: ids },
              },
            ],
          },
        },
        { $addFields: { auditSubjects: { $ifNull: ["$subjectUsers", [{ $ifNull: ["$subjectUser", "$targetId"] }]] } } },
        { $unwind: "$auditSubjects" },
        {
          $group: {
            _id: "$auditSubjects",
            lastActivity: { $max: "$createdAt" },
          },
        },
      ])
    : [];
  const activityMap = new Map(
    activity.map((item) => [String(item._id), item.lastActivity]),
  );
  res.json({
    users: users.map((user) =>
      publicUser(user, activityMap.get(String(user._id)) || null),
    ),
    counts: Object.fromEntries(
      ROLES.map((item) => [
        item,
        counts.find((count) => count._id === item)?.count || 0,
      ]),
    ),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}

export async function getAuditUserLogs(req, res) {
  if (!mongoose.isValidObjectId(req.params.userId))
    return res.status(400).json({ message: "Invalid user ID." });
  const filters = validatedFilters(req, res);
  if (!filters) return;
  const user = await User.findOne({
    _id: req.params.userId,
    role: { $in: ROLES },
    registrationStatus: "Approved",
  })
    .select(
      "name firstName middleName lastName email role studentId employeeId yearLevel program position specialization accountStatus registrationStatus createdAt +profilePicture",
    )
    .lean();
  if (!user)
    return res.status(404).json({ message: "Registered user not found." });
  const query = logQueryFor(user._id);
  if (filters.category) query.category = filters.category;
  if (filters.start || filters.end) {
    query.createdAt = {};
    if (filters.start) query.createdAt.$gte = filters.start;
    if (filters.end) query.createdAt.$lt = filters.end;
  }
  const [logs, total, latest] = await Promise.all([
    AuditLog.find(query)
      .select(
        "action category description actorUser actorRole actor relatedEntityType relatedEntityId targetType targetId changes metadata details createdAt",
      )
      .populate("actorUser", "name role")
      .populate("actor", "name role")
      .sort({ createdAt: -1, _id: -1 })
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .lean(),
    AuditLog.countDocuments(query),
    AuditLog.findOne(logQueryFor(user._id))
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),
  ]);
  res.json({
    user: publicUser(user, latest?.createdAt || null),
    logs: logs.map(publicLog),
    summary: { totalEvents: total, lastActivity: latest?.createdAt || null },
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.max(1, Math.ceil(total / filters.limit)),
    },
  });
}

const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export async function exportAuditLogs(req, res) {
  if (!mongoose.isValidObjectId(req.query.userId))
    return res.status(400).json({ message: "Select a valid registered user." });
  const filters = validatedFilters(
    { ...req, query: { ...req.query, page: 1, limit: 100 } },
    res,
  );
  if (!filters) return;
  const user = await User.findOne({
    _id: req.query.userId,
    role: { $in: ROLES },
    registrationStatus: "Approved",
  })
    .select("name role")
    .lean();
  if (!user)
    return res.status(404).json({ message: "Registered user not found." });
  const query = logQueryFor(user._id);
  if (filters.category) query.category = filters.category;
  if (filters.start || filters.end) {
    query.createdAt = {};
    if (filters.start) query.createdAt.$gte = filters.start;
    if (filters.end) query.createdAt.$lt = filters.end;
  }
  const logs = await AuditLog.find(query)
    .select(
      "action category description actorUser actorRole actor relatedEntityType relatedEntityId targetType targetId changes createdAt",
    )
    .populate("actorUser", "name role")
    .populate("actor", "name role")
    .sort({ createdAt: -1, _id: -1 })
    .limit(5000)
    .lean();
  const rows = [
    [
      "Date",
      "Time",
      "User",
      "Role",
      "Category",
      "Action",
      "Description",
      "Performed by",
      "Related record",
    ],
  ];
  for (const source of logs) {
    const log = publicLog(source);
    const date = new Date(log.createdAt);
    rows.push([
      date.toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      date.toLocaleTimeString("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
      user.name,
      user.role,
      log.category,
      log.title,
      log.description,
      log.actor.name,
      log.relatedRecord
        ? `${log.relatedRecord.type} ${log.relatedRecord.id}`
        : "",
    ]);
  }
  const filename = `socconsult-audit-logs-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}.csv`;
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`);
}

export const auditControllerInternals = { publicLog, parseDate, CATEGORIES };
