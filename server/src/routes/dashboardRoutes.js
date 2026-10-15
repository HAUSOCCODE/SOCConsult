import { Router } from "express";
import { getDateRangeFilter } from "../services/calendarRangeService.js";
import Appointment from "../models/Appointment.js";
import Notification from "../models/Notification.js";
import Availability from "../models/Availability.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { getDeanDashboard } from "../controllers/deanDashboardController.js";
const router = Router();
router.use("/dean", (_req, res, next) => {
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
    Appointment.countDocuments({
      student: req.user.id,
      status: "Awaiting Attendance Update",
    }),
    Notification.countDocuments({ recipient: req.user.id, isRead: false }),
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
    Notification.find({ recipient: req.user.id })
      .select("title message isRead createdAt")
      .sort({ createdAt: -1 })
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
  });
}
router.get("/student", authorize("student"), getStudentDashboard);
router.get("/faculty", authorize("faculty", "dean"), async (req, res) => {
  const now = new Date();
  const { startAt: todayRange } = getDateRangeFilter("today", now);
  const { startAt: weekRange } = getDateRangeFilter("this_week", now);
  const [today, pending, weekly, completed, recentRequests, availability] =
    await Promise.all([
      Appointment.countDocuments({
        faculty: req.user.id,
        status: "Confirmed",
        startAt: todayRange,
      }),
      Appointment.countDocuments({
        faculty: req.user.id,
        status: "Pending",
      }),
      Appointment.countDocuments({
        faculty: req.user.id,
        status: { $in: ["Confirmed", "Completed"] },
        startAt: weekRange,
      }),
      Appointment.countDocuments({ faculty: req.user.id, status: "Completed" }),
      Appointment.find({
        faculty: req.user.id,
        status: "Pending",
      })
        .populate("student", "name email")
        .sort({ createdAt: -1 })
        .limit(5),
      Availability.countDocuments({
        faculty: req.user.id,
        isActive: true,
        endAt: { $gt: now },
      }),
    ]);
  res.json({
    stats: {
      todayAppointments: today,
      pendingRequests: pending,
      weeklyConsultations: weekly,
      completedConsultations: completed,
      availableSchedules: availability,
    },
    recentRequests,
  });
});
export default router;
