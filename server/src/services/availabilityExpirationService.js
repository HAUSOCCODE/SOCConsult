import Appointment from "../models/Appointment.js";
import Availability from "../models/Availability.js";
import Notification from "../models/Notification.js";
import { logActivity } from "./activityService.js";

const EXPIRED_RESPONSE_NOTE =
  "The requested consultation schedule expired before confirmation.";
const STUDENT_NOTIFICATION_TITLE = "Consultation Request Expired";
const FACULTY_NOTIFICATION_TITLE = "Consultation Schedule Expired";

export const availabilityStatus = (availability, now = new Date()) => {
  if (new Date(availability.endAt) <= now) return "expired";
  return availability.isActive ? "active" : "inactive";
};

const scheduleWindow = (schedule) => {
  const options = {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  const start = new Date(schedule.startAt).toLocaleString("en-PH", options);
  const end = new Date(schedule.endAt).toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${start}–${end}`;
};

const processSchedule = async (candidate, now) => {
  const schedule = await Availability.findOneAndUpdate(
    {
      _id: candidate._id,
      endAt: { $lte: now },
      expirationNotified: { $ne: true },
    },
    { $set: { expirationNotified: true } },
    { new: true },
  );
  if (!schedule) return false;

  try {
    const affected = await Appointment.find({
      availability: schedule.id,
      status: "Pending",
    }).select("_id student status");

    await Promise.all(
      affected.map(async (item) => {
        const changed = await Appointment.findOneAndUpdate(
          { _id: item._id, status: "Pending" },
          {
            $set: {
              status: "Expired",
              responseNote: EXPIRED_RESPONSE_NOTE,
              rescheduleRequested: false,
              rescheduleRequestNote: "",
              rescheduleRequestStatus: "Approved",
              rescheduleReviewedAt: now,
              rescheduleReviewedBy: schedule.faculty,
            },
          },
          { new: true },
        );
        const appointment = changed || item;
        await Notification.updateOne(
          {
            recipient: appointment.student,
            type: "appointment",
            title: STUDENT_NOTIFICATION_TITLE,
            relatedEntityId: appointment._id,
          },
          {
            $setOnInsert: {
              message:
                "Your consultation request expired before it could be confirmed.",
            },
          },
          { upsert: true },
        );
        if (changed)
          logActivity(
            "appointment_reschedule_required",
            schedule.faculty,
            "Appointment",
            appointment.id,
            { availabilityId: schedule.id, reason: "availability_expired" },
          );
      }),
    );

    await Promise.all([
      Notification.updateOne(
        {
          recipient: schedule.faculty,
          type: "schedule",
          title: FACULTY_NOTIFICATION_TITLE,
          relatedEntityId: schedule._id,
        },
        {
          $setOnInsert: {
            message: `Your consultation schedule for ${scheduleWindow(schedule)} has expired.`,
          },
        },
        { upsert: true },
      ),
      logActivity(
        "availability_expired",
        schedule.faculty,
        "Availability",
        schedule.id,
      ),
    ]);
    return true;
  } catch (error) {
    await Availability.updateOne(
      { _id: schedule.id },
      { $set: { expirationNotified: false } },
    );
    throw error;
  }
};

export const processExpiredAvailability = async ({ facultyId } = {}) => {
  const now = new Date();
  const query = {
    endAt: { $lte: now },
    expirationNotified: { $ne: true },
  };
  if (facultyId) query.faculty = facultyId;
  const candidates = await Availability.find(query)
    .select("_id")
    .sort({ endAt: 1 })
    .limit(100)
    .lean();
  await Promise.all(
    candidates.map((candidate) =>
      processSchedule(candidate, now).catch((error) => console.error(error)),
    ),
  );
};
