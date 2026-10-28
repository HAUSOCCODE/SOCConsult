import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import Availability from "../models/Availability.js";

export async function getPublicStats(_req, res) {
  const now = new Date();
  const [activeRequests, completedConsultations, facultyCount, next] =
    await Promise.all([
      Appointment.countDocuments({
        status: { $in: ["Pending", "Reschedule Proposed", "Confirmed"] },
      }),
      Appointment.countDocuments({ status: "Completed" }),
      User.countDocuments({
        role: "faculty",
        registrationStatus: "Approved",
        accountStatus: "Active",
      }),
      Availability.findOne({ isActive: true, endAt: { $gt: now } })
        .sort({ startAt: 1 })
        .select("startAt"),
    ]);
  res.json({
    activeRequests,
    completedConsultations,
    facultyCount,
    nextAvailableSlot: next
      ? {
          day: next.startAt.toLocaleDateString("en-US", { weekday: "long" }),
          time: next.startAt.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
        }
      : null,
  });
}
