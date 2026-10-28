import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getNotifications,
  clearNotifications,
  clearReadNotifications,
  deleteNotification,
  markAllNotificationsRead,
  markAllNotificationsUnread,
  markNotificationRead,
} from "../controllers/notificationController.js";
const router = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.use(authenticate);
router.get("/", getNotifications);
router.put("/read-all", markAllNotificationsRead);
router.put("/unread-all", markAllNotificationsUnread);
router.put("/:id/read", markNotificationRead);
router.delete("/read", clearReadNotifications);
router.delete("/:id", deleteNotification);
router.delete("/", clearNotifications);
export default router;
