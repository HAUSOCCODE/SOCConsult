export const EMPTY_TIME_SLOT = Object.freeze({ startTime: "", endTime: "" });
export const MAX_AVAILABLE_TIME_SLOTS = 8;

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isTime = value => typeof value === "string" && TIME.test(value);

export function validateAvailableTimeSlots(slots, { date, now = new Date() } = {}) {
  const errors = (Array.isArray(slots) ? slots : []).map(() => ({}));
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_AVAILABLE_TIME_SLOTS)
    return { valid: false, errors, message: `Enter between 1 and ${MAX_AVAILABLE_TIME_SLOTS} available time slots.` };

  if (date !== undefined) {
    const day = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+day) || day.toISOString().slice(0, 10) !== date)
      return { valid: false, errors, message: "Choose a valid consultation date." };
  }
  for (const [index, slot] of slots.entries()) {
    if (!slot || typeof slot !== "object" || Array.isArray(slot) || Object.keys(slot).some(key => !["startTime", "endTime"].includes(key))) {
      errors[index] = { startTime: "Enter a valid time range." };
      continue;
    }
    if (!isTime(slot.startTime)) errors[index].startTime = "Enter a valid start time.";
    if (!isTime(slot.endTime)) errors[index].endTime = "Enter a valid end time.";
    if (isTime(slot.startTime) && isTime(slot.endTime) && slot.startTime >= slot.endTime)
      errors[index].endTime = "End time must be later than start time.";
    if (date && isTime(slot.startTime) && new Date(`${date}T${slot.startTime}:00+08:00`) <= now)
      errors[index].startTime = "Start time must be in the future.";
  }
  for (let left = 0; left < slots.length; left += 1) for (let right = left + 1; right < slots.length; right += 1) {
    if (!isTime(slots[left]?.startTime) || !isTime(slots[left]?.endTime) ||
        !isTime(slots[right]?.startTime) || !isTime(slots[right]?.endTime)) continue;
    const duplicate = slots[left].startTime === slots[right].startTime && slots[left].endTime === slots[right].endTime;
    const overlap = slots[left].startTime < slots[right].endTime && slots[left].endTime > slots[right].startTime;
    if (duplicate || overlap) errors[right].startTime = duplicate ? "This time slot is duplicated." : `This time slot overlaps Time Slot ${left + 1}.`;
  }
  return { valid: errors.every(error => !Object.keys(error).length), errors };
}
