export const DISPLAY_TIME_ZONE = "Asia/Manila";
const timestamp = new Intl.DateTimeFormat("en-PH", {
  timeZone: DISPLAY_TIME_ZONE, dateStyle: "medium", timeStyle: "short",
});
const date = new Intl.DateTimeFormat("en-PH", {
  timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "short", day: "numeric",
});
const time = new Intl.DateTimeFormat("en-PH", {
  timeZone: DISPLAY_TIME_ZONE, hour: "numeric", minute: "2-digit",
});
function display(value, formatter, fallback) {
  if (!value) return fallback;
  // Date-only values are calendar dates, never instants.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateOnly(value, fallback);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? formatter.format(parsed) : fallback;
}
export const formatManilaDateTime = (value, fallback = "Unavailable") => display(value, timestamp, fallback);
export const formatManilaDate = (value, fallback = "Unavailable") => display(value, date, fallback);
export const formatManilaTime = (value, fallback = "Unavailable") => display(value, time, fallback);
export function formatDateOnly(value, fallback = "Unavailable") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(12, 0, 0, 0);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return fallback;
  return date.format(parsed);
}

export function formatManilaDisplay(value, options, kind = "timestamp", fallback = "Unavailable") {
  const defaults = kind === "date" ? { year: "numeric", month: "short", day: "numeric" } :
    kind === "time" ? { hour: "numeric", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" };
  return display(value, new Intl.DateTimeFormat("en-PH", { ...(options && Object.keys(options).some(key => key !== "timeZone") ? options : defaults), timeZone: DISPLAY_TIME_ZONE }), fallback);
}

// Form values are wall time in Manila, independent of the browser's timezone.
export function manilaInputParts(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed)) return { date: "", time: "" };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(parsed).map(({ type, value }) => [type, value]));
  return { date: parts.year + "-" + parts.month + "-" + parts.day, time: parts.hour + ":" + parts.minute };
}
export function parseManilaInput(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const parsed = new Date(date + "T" + time + ":00+08:00");
  if (!Number.isFinite(+parsed)) return null;
  const parts = manilaInputParts(parsed);
  return parts.date === date && parts.time === time ? parsed : null;
}
