import mongoose from "mongoose";
import Availability from "../models/Availability.js";
import Appointment from "../models/Appointment.js";
import { BLOCKING_STATUSES } from "../config/appointmentStatus.js";
import { lockProviderSchedules } from "./providerSchedulingLock.js";

const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
const protectedMessage = "This slot has a reserved consultation. Use the consultation reschedule or cancellation workflow.";
const stale = () => fail("This availability changed. Refresh and try again.");
const text = (value, max, label) => {
  if (typeof value !== "string" || value.length > max) fail(`Enter a valid ${label} (up to ${max} characters).`, 400);
  return value.trim();
};
function instant(value) {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))
    fail("Choose a valid date and time with a timezone.", 400);
  const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(+calendarDate) || calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10))
    fail("Choose a valid availability date.", 400);
  return new Date(value);
}
export function validateAvailability(input, now = new Date()) {
  const startAt = instant(input.startAt), endAt = instant(input.endAt);
  if (!Number.isFinite(+startAt) || !Number.isFinite(+endAt)) fail("Choose valid availability dates.", 400);
  if (endAt <= startAt) fail("End time must be later than start time.", 400);
  if (startAt <= now) fail("Start time must be later than the current time.", 400);
  const mode = input.mode;
  if (!["Face-to-Face", "Online"].includes(mode)) fail("Select a valid consultation mode.", 400);
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") fail("Select a valid availability state.", 400);
  const location = mode === "Face-to-Face" ? text(input.location ?? "", 150, "location") : "";
  const meetingPlatform = mode === "Online" ? text(input.meetingPlatform ?? "", 100, "meeting platform") : "";
  const meetingLink = mode === "Online" ? text(input.meetingLink ?? "", 500, "meeting link") : "";
  if (mode === "Face-to-Face" && !location) fail("Location is required for face-to-face availability.", 400);
  if (mode === "Online" && !meetingPlatform) fail("Meeting platform is required for online availability.", 400);
  if (meetingLink) {
    let url;
    try { url = new URL(meetingLink); } catch { fail("Please enter a valid meeting link.", 400); }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) fail("Please enter a valid meeting link.", 400);
  }
  return { startAt, endAt, mode, location, meetingPlatform, meetingLink, isActive: input.isActive ?? true };
}
const versionFilter = slot => ({ __v: slot.__v == null ? { $exists: false } : slot.__v });
export const safeAvailability = slot => {
  const value = slot.toObject ? slot.toObject() : { ...slot };
  delete value.reservationToken;
  return value;
};

export async function mutateAvailability({ actor, id, input = {}, action, now = new Date() }) {
  if (!["faculty", "dean"].includes(actor.role)) fail("Unauthorized.", 403);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Enter valid availability details.", 400);
  if (action !== "create" && !mongoose.isValidObjectId(id)) fail("Availability not found.", 404);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await lockProviderSchedules([actor.id], session);
      let slot;
      if (action !== "create") {
        slot = await Availability.findOne({ _id: id, faculty: actor.id }).select("+meetingLink +reservationToken").session(session).lean();
        if (!slot) fail("Availability not found.", 404);
        if (!(new Date(slot.startAt) > now)) fail("Only availability that starts in the future can be changed.");
        if (input.expectedVersion !== undefined && input.expectedVersion !== (slot.__v ?? 0)) stale();
        if (slot.reservationToken || await Appointment.exists({ availability: id, status: { $in: BLOCKING_STATUSES } }).session(session)) fail(protectedMessage);
      }
      if (action === "delete") {
        if (await Appointment.exists({ $or: [{ availability: id }, { proposedAvailability: id },
          { "scheduleHistory.previous.availability": id }, { "scheduleHistory.next.availability": id }] }).session(session))
          fail("This slot has consultation history and must be retained. Deactivate it instead.");
        result = await Availability.findOneAndDelete({ _id: id, faculty: actor.id, ...versionFilter(slot) }, { session });
        if (!result) stale();
        result = safeAvailability(result);
        return;
      }
      const mutable = ["startAt", "endAt", "mode", "location", "meetingPlatform", "meetingLink", "isActive"];
      const changes = Object.fromEntries(mutable.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
      const next = validateAvailability({ ...slot, ...changes }, now);
      if (next.isActive) {
        const overlap = { startAt: { $lt: next.endAt }, endAt: { $gt: next.startAt } };
        if (await Availability.exists({ faculty: actor.id, isActive: true, ...(id && { _id: { $ne: id } }), ...overlap }).session(session))
          fail("This availability overlaps an existing schedule.");
        if (await Appointment.exists({ faculty: actor.id, status: { $in: BLOCKING_STATUSES }, ...overlap }).session(session))
          fail("This availability conflicts with an active consultation. Use the consultation reschedule or cancellation workflow.");
      }
      if (action === "create") {
        [result] = await Availability.create([{ faculty: actor.id, ...next }], { session });
      } else {
        result = await Availability.findOneAndUpdate({ _id: id, faculty: actor.id, ...versionFilter(slot) },
          { $set: next, $inc: { __v: 1 } }, { session, new: true, runValidators: true });
        if (!result) stale();
      }
      result = safeAvailability(result);
    });
  } catch (error) {
    if (error.code === 11000 || error.code === 112 || error.hasErrorLabel?.("TransientTransactionError")) stale();
    throw error;
  } finally { await session.endSession(); }
  return result;
}
