import Notification from "../models/Notification.js";

export const CATEGORIES = ["Management", "Consultation", "Attendance", "Report"];
export const notificationProjection = "type category title message relatedEntityId actionUrl isRead readAt createdAt";
export const categoryExpression = { $ifNull: ["$category", { $switch: { branches: [
  { case: { $eq: ["$type", "registration"] }, then: "Management" },
  { case: { $regexMatch: { input: "$title", regex: "attendance", options: "i" } }, then: "Attendance" },
], default: "Consultation" } }] };
export function safeActionUrl(value, user, category) {
  if (typeof value !== "string" || value.length > 200 || /[\\\s#]/.test(value)) return undefined;
  if (user.role === "dean" && value === "/faculty/appointments") value = "/dean/faculty/consultations";
  const base = user.role === "dean" ? "/dean" : user.role === "student" ? "/student" : "/faculty";
  const allowed = user.role === "dean"
    ? /^\/dean\/(?:import(?:\?preview=[a-f\d-]{36})?|users(?:\?userId=[a-f\d]{24})?|attendance-review(?:\/[a-f\d]{24})?|reports|consultations|faculty\/(?:consultations|requests|history))$/i
    : new RegExp(`^${base}/(?:consultations|appointments|requests|history)$`);
  if (!allowed.test(value)) return undefined;
  if (user.role === "dean") {
    if (category === "Management" && !/^\/dean\/(?:users|import|consultations)(?:\?|$)/.test(value)) return undefined;
    if (category === "Consultation" && value !== "/dean/consultations" && !value.startsWith("/dean/faculty/")) return undefined;
    if (category === "Report" && value !== "/dean/reports") return undefined;
    if (category === "Attendance" && !value.startsWith("/dean/attendance-review") && !value.startsWith("/dean/faculty/")) return undefined;
  }
  return value;
}
// Historical destinations are normalized only while reading; stored notices stay intact.
function historicalActionUrl(value, user) {
  if (user.role !== "dean" || typeof value !== "string") return value;
  const destinations = {
    "/admin/registrations": "/dean/users", "/admin/users": "/dean/users",
    "/admin/appointments": "/dean/consultations",
    "/admin/consultation-overview": "/dean/consultations",
    "/admin/reports": "/dean/reports", "/admin/import": "/dean/import",
    "/admin/attendance-review": "/dean/attendance-review",
  };
  return Object.hasOwn(destinations, value) ? destinations[value] : value;
}
export function publicNotification(row, user) {
  const value = row.toObject ? row.toObject() : row;
  const category = value.category || (value.type === "registration" ? "Management" : /attendance/i.test(value.title) ? "Attendance" : "Consultation");
  const fallback = category === "Management" ? `/dean/users${value.relatedEntityId ? `?userId=${value.relatedEntityId}` : ""}`
    : "/dean/faculty/consultations";
  return Object.fromEntries(Object.entries({ _id: value._id, type: value.type, category,
    title: value.title, message: value.message, relatedEntityId: value.relatedEntityId,
    actionUrl: safeActionUrl(historicalActionUrl(value.actionUrl, user) || (user.role === "dean" ? fallback : ""), user, category),
    isRead: value.isRead, readAt: value.readAt, createdAt: value.createdAt }).filter(([, v]) => v !== undefined));
}
const events = {
  import_completed: ["Management", "CSV import completed", "The account import completed."],
  import_failed: ["Management", "CSV import failed", "The account import could not be completed. Review the import page."],
  account_created: ["Management", "Account created", "A user account was created."],
  account_deactivated: ["Management", "Account deactivated", "A user account was deactivated."],
  account_reactivated: ["Management", "Account reactivated", "A user account was reactivated."],
  attendance_review_created: ["Attendance", "Attendance Review created", "An attendance record is available for authorized review."],
  report_generated: ["Report", "Report generated", "A consultation report was generated."],
  ai_summary_failed: ["Report", "AI summary generation failed", "The report summary could not be generated. You may try again."],
};
export async function createEventNotification({ recipient, event, relatedEntityId, actionUrl, key, session }) {
  const [category, title, message] = events[event];
  const safe = safeActionUrl(actionUrl, { role: "dean" }, category);
  if (!safe) throw new Error("Invalid notification destination.");
  const data = { recipient, type: event, category, title, message, relatedEntityId, actionUrl: safe,
    ...(key && { deduplicationKey: `${event}:${key}` }) };
  // Transactional sources already guard their state transition. Duplicate-key errors must
  // propagate there: swallowing one would leave a MongoDB transaction aborted.
  if (key && !session) return Notification.updateOne({ recipient, deduplicationKey: data.deduplicationKey }, { $setOnInsert: data }, { upsert: true });
  return Notification.create([data], { session });
}
export async function bestEffortNotification(input) {
  try { await createEventNotification(input); return true; }
  catch { console.warn("[Notification] Delivery failed."); return false; }
}
