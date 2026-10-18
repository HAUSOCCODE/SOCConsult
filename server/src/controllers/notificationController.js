import Notification from "../models/Notification.js";
import mongoose from "mongoose";
import { CATEGORIES, categoryExpression, notificationProjection, publicNotification } from "../services/notificationService.js";

export async function getNotifications(req, res) {
  const query = req.query || {};
  const integer = (value, fallback, max) => value === undefined ? fallback :
    typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(+value) && +value <= max ? +value : null;
  const page = integer(query.page, 1, 1000000), limit = integer(query.limit, 20, 100);
  if (!page || !limit || Object.keys(query).some(key => !["page", "limit", "category", "readState"].includes(key)) ||
    (query.category !== undefined && !CATEGORIES.includes(query.category)) ||
    (query.readState !== undefined && !["all", "read", "unread"].includes(query.readState)))
    return res.status(400).json({ message: "Invalid notification filters." });
  const owned = { recipient: req.user.id, ...(req.user.role === "student" && { type: { $ne: "task" } }) };
  const filter = { ...owned };
  if (query.category) filter.$expr = { $eq: [categoryExpression, query.category] };
  if (query.readState && query.readState !== "all") filter.isRead = query.readState === "read";
  const [notifications, unreadCount, total] = await Promise.all([
    Notification.find(filter).select(notificationProjection).sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments({ ...owned, isRead: false }),
    Notification.countDocuments(filter),
  ]);
  res.json({ notifications: notifications.map(row => publicNotification(row, req.user)), unreadCount,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

export async function markAllNotificationsRead(req, res) {
  await Notification.updateMany(
    { recipient: req.user.id, isRead: false, ...(req.user.role === "student" && { type: { $ne: "task" } }) },
    { isRead: true, readAt: new Date() },
  );
  res.json({ message: "All notifications marked as read." });
}

export async function markAllNotificationsUnread(req, res) {
  await Notification.updateMany(
    { recipient: req.user.id, isRead: true, ...(req.user.role === "student" && { type: { $ne: "task" } }) },
    { $set: { isRead: false }, $unset: { readAt: 1 } },
  );
  const unreadCount = await Notification.countDocuments({
    recipient: req.user.id,
    ...(req.user.role === "student" && { type: { $ne: "task" } }),
    isRead: false,
  });
  res.json({
    message: "All notifications marked as unread.",
    unreadCount,
  });
}

export async function markNotificationRead(req, res) {
  if (!/^[a-f\d]{24}$/i.test(req.params.id || "")) return res.status(400).json({ message: "Invalid notification ID." });
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user.id, ...(req.user.role === "student" && { type: { $ne: "task" } }) },
    { isRead: true, readAt: new Date() },
    { new: true, projection: notificationProjection },
  );
  if (!notification)
    return res.status(404).json({ message: "Notification not found." });
  res.json({ notification: publicNotification(notification, req.user) });
}

export async function deleteNotification(req, res) {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ message: "Invalid notification ID." });

  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipient: req.user.id,
  });
  if (!notification)
    return res.status(404).json({ message: "Notification not found." });

  res.json({ message: "Notification deleted." });
}

export async function clearReadNotifications(req, res) {
  const result = await Notification.deleteMany({
    recipient: req.user.id,
    isRead: true,
  });
  res.json({
    message: "Read notifications cleared.",
    deletedCount: result.deletedCount,
  });
}

export async function clearNotifications(req, res) {
  const result = await Notification.deleteMany({ recipient: req.user.id });
  res.json({
    message: "All notifications cleared.",
    deletedCount: result.deletedCount,
  });
}
