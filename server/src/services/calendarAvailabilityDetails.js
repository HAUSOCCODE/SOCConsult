import Availability from "../models/Availability.js";
import Appointment from "../models/Appointment.js";
import { BLOCKING_STATUSES } from "../config/appointmentStatus.js";

export async function calendarAvailabilityDetails({ faculty, id, input = {}, now = new Date() }) {
  const fail = statusCode => { throw Object.assign(new Error(), { statusCode }); };
  if (Object.keys(input).length) fail(400);
  if (!/^[a-f\d]{24}$/i.test(id)) fail(404);
  const slot = await Availability.findOne({ _id: id, faculty }).select("startAt endAt mode location meetingPlatform isActive +reservationToken").maxTimeMS(10000).lean();
  if (!slot) fail(404);
  const occupied = Boolean(slot.reservationToken) || Boolean(await Appointment.exists({ faculty, status: { $in: BLOCKING_STATUSES },
    $or: [{ availability: slot._id }, ...(slot.isActive ? [{ startAt: { $lt: slot.endAt }, endAt: { $gt: slot.startAt } }] : [])] }).maxTimeMS(10000));
  return { availability: { id: String(slot._id), startAt: slot.startAt, endAt: slot.endAt, mode: slot.mode,
    location: slot.mode === "Face-to-Face" ? slot.location || null : null,
    meetingPlatform: slot.mode === "Online" ? slot.meetingPlatform || null : null,
    status: +new Date(slot.endAt) <= +now ? "Expired" : occupied ? "Reserved / unavailable" : slot.isActive && +new Date(slot.startAt) > +now ? "Available" : "Inactive / unavailable" } };
}
