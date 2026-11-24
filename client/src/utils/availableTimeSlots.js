export const EMPTY_TIME_SLOT = Object.freeze({ startTime: "", endTime: "" });
export const MAX_AVAILABLE_TIME_SLOTS = 8;

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateAvailableTimeSlots(slots, { date, now = new Date() } = {}) {
  const errors = (Array.isArray(slots) ? slots : []).map(() => ({}));
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_AVAILABLE_TIME_SLOTS)
    return { valid: false, errors, message: `Enter between 1 and ${MAX_AVAILABLE_TIME_SLOTS} available time slots.` };

  slots.forEach((slot, index) => {
    if (!TIME.test(slot?.startTime || "")) errors[index].startTime = "Enter a valid start time.";
    if (!TIME.test(slot?.endTime || "")) errors[index].endTime = "Enter a valid end time.";
    if (TIME.test(slot?.startTime || "") && TIME.test(slot?.endTime || "") && slot.startTime >= slot.endTime)
      errors[index].endTime = "End time must be later than start time.";
    if (date && TIME.test(slot?.endTime || "") && new Date(`${date}T${slot.endTime}:00+08:00`) <= now)
      errors[index].endTime = "This availability is already in the past.";
  });
  for (let left = 0; left < slots.length; left += 1) for (let right = left + 1; right < slots.length; right += 1) {
    if (!TIME.test(slots[left]?.startTime || "") || !TIME.test(slots[left]?.endTime || "") ||
        !TIME.test(slots[right]?.startTime || "") || !TIME.test(slots[right]?.endTime || "")) continue;
    const duplicate = slots[left].startTime === slots[right].startTime && slots[left].endTime === slots[right].endTime;
    const overlap = slots[left].startTime < slots[right].endTime && slots[left].endTime > slots[right].startTime;
    if (duplicate || overlap) errors[right].startTime = duplicate ? "This time slot is duplicated." : `This time slot overlaps Time Slot ${left + 1}.`;
  }
  return { valid: errors.every(error => !Object.keys(error).length), errors };
}
