import mongoose from "mongoose";
import StudentAvailability from "../models/StudentAvailability.js";

const parsePeriod = (startValue, endValue) => ({
  startAt: new Date(startValue),
  endAt: new Date(endValue),
});

const validatePeriod = ({ startAt, endAt }) => {
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()))
    return "Select valid start and end date/time values.";
  if (endAt <= startAt) return "End date/time must be later than start date/time.";
  if (startAt <= new Date()) return "Start date/time must be in the future.";
  return "";
};

const overlapsActivePeriod = ({ student, startAt, endAt, excludeId }) =>
  StudentAvailability.exists({
    ...(excludeId && { _id: { $ne: excludeId } }),
    student,
    isActive: true,
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  });

export const getStudentAvailability = async (req, res) => {
  const availability = await StudentAvailability.find({
    student: req.user.id,
  }).sort({ startAt: 1 });
  res.json({ availability });
};

export const createStudentAvailability = async (req, res) => {
  const period = parsePeriod(req.body.startAt, req.body.endAt);
  const validationError = validatePeriod(period);
  if (validationError)
    return res.status(400).json({ message: validationError });
  const isActive =
    typeof req.body.isActive === "boolean" ? req.body.isActive : true;
  if (
    isActive &&
    (await overlapsActivePeriod({ student: req.user.id, ...period }))
  )
    return res.status(409).json({
      message: "This availability overlaps another active preferred period.",
    });
  const availability = await StudentAvailability.create({
    student: req.user.id,
    ...period,
    isActive,
  });
  res.status(201).json({
    message: "Availability added.",
    availability,
  });
};

export const updateStudentAvailability = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(404).json({ message: "Availability not found." });
  const availability = await StudentAvailability.findOne({
    _id: req.params.id,
    student: req.user.id,
  });
  if (!availability)
    return res.status(404).json({ message: "Availability not found." });

  const changesPeriod =
    req.body.startAt !== undefined || req.body.endAt !== undefined;
  const nextActive =
    typeof req.body.isActive === "boolean"
      ? req.body.isActive
      : availability.isActive;
  const period = parsePeriod(
    req.body.startAt ?? availability.startAt,
    req.body.endAt ?? availability.endAt,
  );
  if (changesPeriod || nextActive) {
    const validationError = validatePeriod(period);
    if (validationError)
      return res.status(400).json({ message: validationError });
  }
  if (
    nextActive &&
    (await overlapsActivePeriod({
      student: req.user.id,
      ...period,
      excludeId: availability.id,
    }))
  )
    return res.status(409).json({
      message: "This availability overlaps another active preferred period.",
    });

  if (changesPeriod) {
    availability.startAt = period.startAt;
    availability.endAt = period.endAt;
  }
  availability.isActive = nextActive;
  await availability.save();
  res.json({
    message: changesPeriod
      ? "Availability updated."
      : `Availability ${nextActive ? "activated" : "deactivated"}.`,
    availability,
  });
};

export const deleteStudentAvailability = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(404).json({ message: "Availability not found." });
  const availability = await StudentAvailability.findOneAndDelete({
    _id: req.params.id,
    student: req.user.id,
  });
  if (!availability)
    return res.status(404).json({ message: "Availability not found." });
  res.json({ message: "Availability deleted." });
};
