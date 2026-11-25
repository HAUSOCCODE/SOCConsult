import mongoose from "mongoose";
import StudentAvailability from "../models/StudentAvailability.js";
import { availabilityStatus, availabilityWithStatus } from "../services/availabilityExpirationService.js";
import { lockProviderSchedules } from "../services/providerSchedulingLock.js";
import { parseScheduleInstant } from "../services/availableTimeSlotService.js";

const endedMessage = "This availability period has already ended. Please create a new schedule.";
const overlapMessage = "This availability overlaps another active preferred period.";
const notFoundMessage = "Availability not found.";
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };

const parsePeriod = (startValue, endValue) => ({
  startAt: startValue instanceof Date ? startValue : parseScheduleInstant(startValue),
  endAt: endValue instanceof Date ? endValue : parseScheduleInstant(endValue),
});

const validatePeriod = ({ startAt, endAt }) => {
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()))
    return "Select valid start and end date/time values.";
  if (endAt <= startAt) return "End date/time must be later than start date/time.";
  if (startAt <= new Date()) return "Start date/time must be in the future.";
  return "";
};

const overlapsActivePeriod = ({ student, startAt, endAt, excludeId }, session) =>
  StudentAvailability.exists({
    ...(excludeId && { _id: { $ne: excludeId } }),
    student,
    isActive: true,
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  }).session(session);

async function mutatePeriod(student, work) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      await lockProviderSchedules([student], session);
      return work(session);
    });
  } catch (error) {
    if (error.code === 112 || error.hasErrorLabel?.("TransientTransactionError"))
      fail(409, "Availability changed. Refresh and try again.");
    throw error;
  } finally {
    await session.endSession();
  }
}

export const getStudentAvailability = async (req, res) => {
  const now = new Date();
  const availability = await StudentAvailability.find({
    student: req.user.id,
  }).sort({ startAt: 1 });
  res.json({ availability: availability.map(item => availabilityWithStatus(item, now)) });
};

export const createStudentAvailability = async (req, res) => {
  const period = parsePeriod(req.body.startAt, req.body.endAt);
  const student = req.user.id;
  const isActive =
    typeof req.body.isActive === "boolean" ? req.body.isActive : true;
  const availability = await mutatePeriod(student, async (session) => {
    const validationError = validatePeriod(period);
    if (validationError) fail(400, validationError);
    if (isActive && await overlapsActivePeriod({ student, ...period }, session))
      fail(409, overlapMessage);
    const [created] = await StudentAvailability.create([{ student, ...period, isActive }], { session });
    return created;
  });
  res.status(201).json({
    message: "Availability added.",
    availability,
  });
};

export const updateStudentAvailability = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(404).json({ message: notFoundMessage });
  const student = req.user.id;
  const filter = { _id: req.params.id, student };
  const result = await mutatePeriod(student, async (session) => {
    const current = await StudentAvailability.findOne(filter).session(session);
    if (!current) fail(404, notFoundMessage);
    if (availabilityStatus(current) === "expired") fail(409, endedMessage);

    const changesPeriod = req.body.startAt !== undefined || req.body.endAt !== undefined;
    const nextActive = typeof req.body.isActive === "boolean" ? req.body.isActive : current.isActive;
    const period = parsePeriod(
      req.body.startAt === undefined ? current.startAt : req.body.startAt,
      req.body.endAt === undefined ? current.endAt : req.body.endAt,
    );
    if (changesPeriod || nextActive) {
      const validationError = validatePeriod(period);
      if (validationError) fail(400, validationError);
    }
    if (nextActive && await overlapsActivePeriod({ student, ...period, excludeId: current._id }, session))
      fail(409, overlapMessage);

    const availability = await StudentAvailability.findOneAndUpdate(filter,
      { $set: { ...(changesPeriod && period), isActive: nextActive } }, { new: true, runValidators: true, session });
    if (!availability) fail(404, notFoundMessage);
    return {
      message: changesPeriod ? "Availability updated." : `Availability ${nextActive ? "activated" : "deactivated"}.`,
      availability,
    };
  });
  res.json(result);
};

export const deleteStudentAvailability = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(404).json({ message: notFoundMessage });
  const student = req.user.id;
  await mutatePeriod(student, async (session) => {
    const availability = await StudentAvailability.findOneAndDelete({ _id: req.params.id, student }, { session });
    if (!availability) fail(404, notFoundMessage);
  });
  res.json({ message: "Availability deleted." });
};
