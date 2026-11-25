const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const MAX_AVAILABLE_TIME_SLOTS = 8;

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+day) && day.toISOString().slice(0, 10) === value;
}

export function parseScheduleInstant(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
      !isCalendarDate(value.slice(0, 10))) return new Date(NaN);
  return new Date(value);
}

export function parseAvailableTimeSlots(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

export function validateAvailableTimeSlots({ date, slots, now = new Date() }) {
  if (!isCalendarDate(date))
    return { code: "INVALID_REQUESTED_DATE", message: "Please choose a valid preferred consultation date." };
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_AVAILABLE_TIME_SLOTS)
    return { code: "INVALID_AVAILABLE_TIME_SLOTS", message: `Enter between 1 and ${MAX_AVAILABLE_TIME_SLOTS} available time slots.` };
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot || typeof slot !== "object" || Array.isArray(slot) ||
      Object.keys(slot).some(key => !["startTime", "endTime"].includes(key)) ||
      typeof slot.startTime !== "string" || typeof slot.endTime !== "string" || !TIME.test(slot.startTime) || !TIME.test(slot.endTime))
      return { code: "INVALID_AVAILABLE_TIME_SLOT", message: `Time Slot ${index + 1} must contain valid start and end times.`, slotIndex: index };
    if (slot.startTime >= slot.endTime)
      return { code: "INVALID_AVAILABLE_TIME_SLOT_ORDER", message: `Time Slot ${index + 1} must end after it starts.`, slotIndex: index };
    if (new Date(`${date}T${slot.startTime}:00+08:00`) <= now)
      return { code: "PAST_AVAILABLE_TIME_SLOT", message: `Time Slot ${index + 1} must start in the future.`, slotIndex: index };
    for (let previous = 0; previous < index; previous += 1) {
      const other = slots[previous];
      const duplicate = slot.startTime === other.startTime && slot.endTime === other.endTime;
      const overlap = slot.startTime < other.endTime && slot.endTime > other.startTime;
      if (duplicate || overlap) return { code: duplicate ? "DUPLICATE_AVAILABLE_TIME_SLOT" : "OVERLAPPING_AVAILABLE_TIME_SLOTS",
        message: duplicate ? `Time Slot ${index + 1} duplicates Time Slot ${previous + 1}.` : `Time Slot ${index + 1} overlaps Time Slot ${previous + 1}.`, slotIndex: index };
    }
  }
  return null;
}

export function scheduleFitsAvailableTimeSlot({ date, slots, startAt, endAt }) {
  if (!isCalendarDate(date) || !Array.isArray(slots) || !slots.length) return false;
  const start = new Date(startAt), end = new Date(endAt);
  return start < end && slots.some(slot => start >= new Date(`${date}T${slot?.startTime}:00+08:00`) && end <= new Date(`${date}T${slot?.endTime}:00+08:00`));
}
