import { countRequiredAttendance } from "../services/attendanceRequiredService.js";
import { visibleNotifications } from "../services/notificationService.js";
import { attendanceCounts } from "../services/attendanceReportingService.js";
import { Router } from "express";
import { getFacultyDashboard } from "../controllers/facultyDashboardController.js";
import Appointment from "../models/Appointment.js";
import Notification from "../models/Notification.js";

import { authenticate, authorize } from "../middleware/auth.js";
import { getDeanDashboard } from "../controllers/deanDashboardController.js";
const router = Router();
router.use(["/dean", "/faculty"], (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.use(authenticate);
router.get("/dean", authorize("dean"), getDeanDashboard);
export async function getStudentDashboard(req, res) {
  const now = new Date();
  const [
    upcomingCount,
    pendingCount,
    attendanceRequiredCount,
    unreadNotificationCount,
    nextConsultation,
    recentConsultations,
    recentNotifications,
  ] = await Promise.all([
    Appointment.countDocuments({
      student: req.user.id,
      status: "Confirmed",
      startAt: { $gte: now },
      endAt: { $gt: now },
    }),
    Appointment.countDocuments({
      student: req.user.id,
      status: "Pending",
    }),
    countRequiredAttendance(req.user.id, "student", now),
    Notification.countDocuments({ ...visibleNotifications(req.user), isRead: false }),
    Appointment.findOne({
      student: req.user.id,
      status: "Confirmed",
      startAt: { $gte: now },
      endAt: { $gt: now },
    })
      .select(
        "faculty subject startAt endAt consultationMode location meetingPlatform status",
      )
      .populate("faculty", "name firstName middleName lastName")
      .sort({ startAt: 1, _id: 1 })
      .lean(),
    Appointment.find({
      student: req.user.id,
      status: {
        $in: [
          "Pending",
          "Reschedule Proposed",
          "Confirmed",
          "Rejected",
          "Cancelled",
          "Expired",
          "Awaiting Attendance Update",
          "Completed",
          "Attendance Review",
        ],
      },
    })
      .select("faculty subject startAt endAt status createdAt")
      .populate("faculty", "name firstName middleName lastName")
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .lean(),
    Notification.find(visibleNotifications(req.user))
      .select("title message isRead createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .lean(),
  ]);
  res.json({
    upcomingCount,
    pendingCount,
    attendanceRequiredCount,
    unreadNotificationCount,
    nextConsultation: nextConsultation || null,
    recentConsultations,
    recentNotifications,
    attendanceSummary: await attendanceCounts({ student: req.user.id }),
  });
}
router.get("/student", authorize("student"), getStudentDashboard);
router.get("/faculty", authorize("faculty", "dean"), getFacultyDashboard);
export default router;
