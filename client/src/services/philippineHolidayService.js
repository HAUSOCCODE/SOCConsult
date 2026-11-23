const API_ROOT = "https://nagerholidays.com/api/v4/Holidays/PH";
const HOLIDAY_TIMEOUT_MS = 8000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const cache = new Map();

const validYear = (year) => Number.isInteger(Number(year)) && Number(year) >= 1970 && Number(year) <= 2100;
const stablePart = (value) => String(value || "holiday").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const stableHash = (value) => {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
};

export function yearsForCalendarRange(start, endExclusive) {
  const startKey = String(start || "").slice(0, 10);
  const endKey = String(endExclusive || "").slice(0, 10);
  if (!DATE_PATTERN.test(startKey) || !DATE_PATTERN.test(endKey)) return [];
  const lastDate = new Date(`${endKey}T00:00:00Z`);
  lastDate.setUTCDate(lastDate.getUTCDate() - 1);
  const first = Number(startKey.slice(0, 4));
  const last = lastDate.getUTCFullYear();
  if (!validYear(first) || !validYear(last) || last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

export function normalizePhilippineHolidays(payload, year) {
  if (!validYear(year) || !Array.isArray(payload)) return [];
  return payload.filter((holiday) => holiday && DATE_PATTERN.test(holiday.date || "") && holiday.date.startsWith(`${year}-`) && typeof holiday.name === "string" && holiday.name.trim()).map((holiday) => ({
    id: `ph-holiday-${holiday.date}-${stablePart(holiday.name)}-${stableHash(JSON.stringify([holiday.countryCode, holiday.nationalHoliday, holiday.subdivisionCodes, holiday.holidayTypes]))}`,
    title: holiday.name.trim(), start: holiday.date, allDay: true, editable: false,
    extendedProps: {
      kind: "holiday", source: "Nager.Holidays", countryCode: holiday.countryCode || "PH",
      nationalHoliday: holiday.nationalHoliday === true,
      subdivisionCodes: Array.isArray(holiday.subdivisionCodes) ? holiday.subdivisionCodes.filter(Boolean) : [],
      holidayTypes: Array.isArray(holiday.holidayTypes) ? holiday.holidayTypes.filter(Boolean) : [],
      localName: holiday.localName || "",
    },
  }));
}

async function requestYear(year) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), HOLIDAY_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ROOT}/${year}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Holiday service unavailable");
    return normalizePhilippineHolidays(await response.json(), year);
  } finally { window.clearTimeout(timer); }
}

export function fetchPhilippineHolidays(year) {
  if (!validYear(year)) return Promise.reject(new Error("Invalid holiday year"));
  if (!cache.has(Number(year))) cache.set(Number(year), requestYear(Number(year)).catch((error) => { cache.delete(Number(year)); throw error; }));
  return cache.get(Number(year));
}

export function clearHolidayCache() { cache.clear(); }
