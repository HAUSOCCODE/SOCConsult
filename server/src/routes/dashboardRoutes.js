import { Router } from "express";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import Notification from "../models/Notification.js";
import Task from "../models/Task.js";
import Availability from "../models/Availability.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { processExpiredAvailability } from "../services/availabilityExpirationService.js";
import { getDateRangeFilter } from "../services/calendarRangeService.js";
import { getDeanDashboard } from "../controllers/deanDashboardController.js";
const router = Router();
router.use("/dean", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.use(authenticate);
router.get("/dean", authorize("dean"), getDeanDashboard);
router.get("/student", authorize("student"), async (req, res) => {
  const now = new Date();
  const weekRange = getDateRangeFilter("this_week", now);
  const [
    upcoming,
    pending,
    completed,
    tasks,
    unread,
    recentNotifications,
    recentAppointments,
    weeklyStatusCounts,
  ] = await Promise.all([
    Appointment.countDocuments({
      student: req.user.id,
      status: { $in: ["Approved", "Rescheduled"] },
      endAt: { $gt: now },
    }),
    Appointment.countDocuments({
      student: req.user.id,
      $or: [
        { status: "Pending", endAt: { $gt: now } },
        { status: "Awaiting Faculty Schedule" },
      ],
    }),
    Appointment.countDocuments({ student: req.user.id, status: "Completed" }),
    Task.countDocuments({ student: req.user.id, status: "Pending" }),
    Notification.countDocuments({ recipient: req.user.id, isRead: false }),
    Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 })
      .limit(5),
    Appointment.find({ student: req.user.id })
      .populate("faculty", "name")
      .sort({ createdAt: -1 })
      .limit(5),
    Appointment.aggregate([
      {
        $match: {
          student: req.user._id,
          ...weekRange,
          status: { $in: ["Completed", "Pending", "Cancelled", "No Show"] },
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);
  const weeklyOverview = Object.fromEntries(
    ["Completed", "Pending", "Cancelled", "No Show"].map((status) => [
      status,
      weeklyStatusCounts.find((item) => item._id === status)?.count || 0,
    ]),
  );
  res.json({
    stats: {
      upcomingAppointments: upcoming,
      pendingAppointments: pending,
      completedConsultations: completed,
      assignedTasks: tasks,
      unreadNotifications: unread,
    },
    recentNotifications,
    recentAppointments,
    weeklyOverview,
  });
});
router.get("/faculty", authorize("faculty", "dean"), async (req, res) => {
  await processExpiredAvailability({ facultyId: req.user.id });
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const week = new Date(start);
  week.setDate(week.getDate() + 7);
  const [today, pending, weekly, completed, recentRequests, availability] =
    await Promise.all([
      Appointment.countDocuments({
        faculty: req.user.id,
        status: { $in: ["Approved", "Rescheduled"] },
        startAt: { $gte: start, $lt: tomorrow },
      }),
      Appointment.countDocuments({
        faculty: req.user.id,
        status: { $in: ["Pending", "Awaiting Faculty Schedule"] },
      }),
      Appointment.countDocuments({
        faculty: req.user.id,
        status: { $in: ["Approved", "Completed", "Rescheduled"] },
        startAt: { $gte: start, $lt: week },
      }),
      Appointment.countDocuments({ faculty: req.user.id, status: "Completed" }),
      Appointment.find({
        faculty: req.user.id,
        status: { $in: ["Pending", "Awaiting Faculty Schedule"] },
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
