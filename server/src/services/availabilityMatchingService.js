export const MINIMUM_CONSULTATION_MINUTES = 5;

const instant = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const interval = (value) => {
  const startAt = instant(value?.startAt), endAt = instant(value?.endAt);
  return startAt && endAt && startAt < endAt ? { startAt, endAt } : null;
};
const overlaps = (left, right) =>
  left.startAt < right.endAt && left.endAt > right.startAt;

export function overlappingWindow(left, right, minimumMinutes = MINIMUM_CONSULTATION_MINUTES) {
  const a = interval(left), b = interval(right);
  if (!a || !b) return null;
  const startAt = new Date(Math.max(a.startAt.getTime(), b.startAt.getTime()));
  const endAt = new Date(Math.min(a.endAt.getTime(), b.endAt.getTime()));
  const durationMinutes = Math.floor((endAt - startAt) / 60000);
  return startAt < endAt && durationMinutes >= minimumMinutes
    ? { startAt, endAt, durationMinutes }
    : null;
}

export function matchingAvailability({
  schedules = [],
  studentAvailability = [],
  studentAppointments = [],
  providerAppointments = [],
  minimumMinutes = MINIMUM_CONSULTATION_MINUTES,
  now = new Date(),
}) {
  const validStudentPeriods = studentAvailability.map(interval)
    .filter((value) => value && value.endAt > now);
  const studentConflicts = studentAppointments.map(interval).filter(Boolean);
  const providerConflicts = providerAppointments.map((row) => {
    const value = interval(row);
    return value ? { ...value, availability: row?.availability } : null;
  }).filter(Boolean);
  const matches = [];
  for (const schedule of schedules) {
    const facultyWindow = interval(schedule);
    if (!facultyWindow || facultyWindow.endAt <= now) continue;
    const windows = validStudentPeriods.length
      ? validStudentPeriods.map((period) => overlappingWindow(facultyWindow, period, minimumMinutes)).filter(Boolean)
      : [overlappingWindow(facultyWindow, facultyWindow, minimumMinutes)].filter(Boolean);
    for (const window of windows) {
      if (studentConflicts.some((appointment) => overlaps(window, appointment))) continue;
      if (providerConflicts.some((appointment) =>
        String(appointment.availability || "") === String(schedule._id || schedule.id) ||
        overlaps(window, appointment))) continue;
      matches.push({ schedule, ...window });
    }
  }
  const unique = new Map();
  for (const match of matches) {
    const key = `${match.schedule._id || match.schedule.id}:${match.startAt.toISOString()}:${match.endAt.toISOString()}`;
    if (!unique.has(key)) unique.set(key, match);
  }
  return [...unique.values()].sort((left, right) => left.startAt - right.startAt);
}
