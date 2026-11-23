import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearHolidayCache,
  fetchPhilippineHolidays,
  normalizePhilippineHolidays,
  yearsForCalendarRange,
} from "../../client/src/services/philippineHolidayService.js";

const originalFetch = global.fetch;
const originalWindow = global.window;

afterEach(() => {
  clearHolidayCache();
  global.fetch = originalFetch;
  global.window = originalWindow;
});

test("Nager Philippine holidays retain exact all-day dates and supported metadata", () => {
  const events = normalizePhilippineHolidays([
    { date: "2026-01-01", name: "New Year's Day", countryCode: "PH", nationalHoliday: true, subdivisionCodes: null, holidayTypes: ["Public"] },
    { date: "2026-02-01", name: "Regional Day", countryCode: "PH", nationalHoliday: false, subdivisionCodes: ["PH-PAM"], holidayTypes: ["Observance"] },
    { date: "2025-12-31", name: "Wrong year" },
    { date: "bad", name: "Malformed" },
  ], 2026);
  assert.equal(events.length, 2);
  assert.equal(events[0].start, "2026-01-01");
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].extendedProps.nationalHoliday, true);
  assert.deepEqual(events[1].extendedProps.subdivisionCodes, ["PH-PAM"]);
  assert.notEqual(events[0].id, events[1].id);
});

test("visible ranges request every crossed calendar year without shifting date-only boundaries", () => {
  assert.deepEqual(yearsForCalendarRange("2026-12-28", "2027-02-01"), [2026, 2027]);
  assert.deepEqual(yearsForCalendarRange("2026-01-01", "2027-01-01"), [2026]);
  assert.deepEqual(yearsForCalendarRange("bad", "2027-01-01"), []);
});

test("holiday requests use the PH v4 endpoint and cache each year", async () => {
  let calls = 0;
  global.window = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  global.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, "https://nagerholidays.com/api/v4/Holidays/PH/2026");
    assert.equal(options.headers.Accept, "application/json");
    return { ok: true, json: async () => [{ date: "2026-06-12", name: "Independence Day", nationalHoliday: true }] };
  };
  const [first, second] = await Promise.all([fetchPhilippineHolidays(2026), fetchPhilippineHolidays(2026)]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});

test("failed holiday requests are retryable and invalid years never call upstream", async () => {
  let calls = 0;
  global.window = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  global.fetch = async () => { calls += 1; return { ok: false }; };
  await assert.rejects(fetchPhilippineHolidays(2026), /unavailable/);
  await assert.rejects(fetchPhilippineHolidays(2026), /unavailable/);
  assert.equal(calls, 2);
  await assert.rejects(fetchPhilippineHolidays(2200), /Invalid holiday year/);
  assert.equal(calls, 2);
});
