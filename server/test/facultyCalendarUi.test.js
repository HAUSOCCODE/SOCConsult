import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server"), { transform } = require("esbuild");
const settle = () => new Promise(resolve => setImmediate(resolve));
const elements = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
async function harness(path, name, extra = {}) {
  const source = await readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
  const { code } = await transform(source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace("export default function", "function").replace(/export\s+(?=(const|function))/g, ""), { loader: "jsx" });
  const state = [], effects = [], pending = [], listeners = {}; let cursor = 0;
  const imports = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => state[index] = typeof value === "function" ? value(state[index]) : value]; },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
    api: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
    window: { addEventListener: (name, fn) => listeners[name] = fn, removeEventListener: name => delete listeners[name], setInterval: () => 1, clearInterval() {} },
    useDialogFocus() {}, createPortal: tree => tree,
    Link: ({ to, children }) => React.createElement("a", { href: to }, children),
    FullCalendar: props => React.createElement("div", { ...props, "data-fullcalendar": true }),
    dayGridPlugin: {}, timeGridPlugin: {}, listPlugin: {}, themePlugin: {},
    fetchPhilippineHolidays: async () => [], yearsForCalendarRange: () => [2099],
    isRecoverableStudentError: () => true, safeStudentError: () => "Unable to load calendar. Please try again.",
    DetailLoadingDialog: ({ children }) => React.createElement("section", null, children), consultationTime: value => value || "Not scheduled",
    ...Object.fromEntries(["CalendarDays", "ChevronLeft", "ChevronRight", "X"].map(name => [name, () => null])), ...extra,
  };
  const Component = new Function("React", ...Object.keys(imports), `${code};return ${name};`)(React, ...Object.values(imports));
  return { state, effects, pending, listeners, render(props = {}) { cursor = 0; effects.length = 0; return Component(props); }, html: renderToStaticMarkup };
}

test("FullCalendar range drives bounded personal requests, filters and refresh", async () => {
  const h = await harness("components/calendar/ConsultationCalendar.jsx", "ConsultationCalendar");
  const props = { personalCalendar: true, includeAvailability: true, showUpcoming: false };
  let tree = h.render(props);
  const calendar = elements(tree).find(el => el.props?.initialView === "dayGridMonth");
  assert.equal(calendar.props.initialView, "dayGridMonth");
  assert.equal(calendar.props.timeZone, "Asia/Manila");
  assert.match(calendar.props.headerToolbar.right, /dayGridMonth,timeGridWeek,timeGridDay,listMonth/);
  calendar.props.datesSet({ startStr: "2099-01-01T00:00:00+08:00", endStr: "2099-02-01T00:00:00+08:00" });
  tree = h.render(props); const cleanup = h.effects[0](); const stop = h.effects[2]();
  assert.match(h.pending[0].path, /start=2099-01-01&end=2099-01-31/);
  assert.match(h.pending[0].path, /includeInactive=true&includeFinalized=false/); assert.equal(h.pending[0].options.cache, "no-store");
  h.pending[0].resolve({ events: [] }); await settle();
  tree = h.render(props);
  const filters = elements(tree).filter(el => el.type?.name === "Filter");
  assert.equal(filters.length, 3); assert.equal(filters[0].props.checked, true); assert.equal(filters[1].props.checked, false); assert.equal(filters[2].props.checked, true);
  filters[0].props.onChange(false); filters[1].props.onChange(true);
  h.render(props); const cleanup2 = h.effects[0]();
  assert.match(h.pending[1].path, /includeInactive=false&includeFinalized=true/);
  h.pending[1].reject(Object.assign(Error("PRIVATE"), { status: 422 })); await settle();
  tree = h.render(props); const html = h.html(tree); assert.match(html, /Choose a narrower Week or Day view/); assert.doesNotMatch(html, /PRIVATE/);
  cleanup2(); stop(); assert.equal(h.listeners.focus, undefined);
  cleanup();
});

test("FullCalendar maps valid events once and preserves authorized event callbacks", async () => {
  const event = { id: "appointment-a-current", kind: "appointment", status: "Reschedule Proposed", displayStatus: "Current schedule - reschedule pending", start: "2099-01-01T15:30:00Z", end: "2099-01-01T16:30:00Z", participantName: "Student", topic: "Course" };
  const clicks = [], h = await harness("components/calendar/ConsultationCalendar.jsx", "ConsultationCalendar");
  const props = { personalCalendar: false, showUpcoming: false, onEventClick: (...args) => clicks.push(args) };
  let tree = h.render(props); elements(tree).find(el => el.props?.initialView === "dayGridMonth").props.datesSet({ startStr: "2099-01-01", endStr: "2099-02-01" });
  h.render(props); h.effects[0](); assert.doesNotMatch(h.pending[0].path, /includeInactive|includeFinalized|includeAvailability/);
  h.pending[0].resolve({ events: [event, { ...event, id: "invalid", end: event.start }] }); await settle();
  tree = h.render(props); const calendar = elements(tree).find(el => el.props?.initialView === "dayGridMonth");
  assert.equal(calendar.props.events.length, 1); assert.equal(calendar.props.events[0].id, "soc-appointment-a-current");
  const card = calendar.props.eventContent({
    event: { title: calendar.props.events[0].title, extendedProps: calendar.props.events[0].extendedProps },
    timeText: "11:30 PM", view: { type: "dayGridMonth" },
  });
  assert.equal(card.props.className, "soc-calendar-event-card is-month-card");
  assert.match(h.html(card), /11:30 PM/); assert.match(h.html(card), /Current schedule - reschedule pending/);
  assert.match(h.html(card), /Course/); assert.match(h.html(card), /Student/);
  const holidayCard = calendar.props.eventContent({ event: { title: "Independence Day", extendedProps: { kind: "holiday" } }, timeText: "", view: { type: "dayGridMonth" } });
  assert.match(h.html(holidayCard), /soc-calendar-holiday-label/); assert.match(h.html(holidayCard), /Independence Day/);
  assert.equal(calendar.props.eventOrder({ extendedProps: { kind: "holiday" } }, { extendedProps: { kind: "appointment" } }), -1);
  assert.equal(calendar.props.eventOrderStrict, true);
  const opener = {}; calendar.props.eventClick({ event: { extendedProps: calendar.props.events[0].extendedProps }, el: opener });
  assert.equal(clicks[0][0], event); assert.equal(clicks[0][1], opener);
});

test("availability selection fetches fresh narrow details, handles retry and ignores stale responses", async () => {
  const h = await harness("components/calendar/AvailabilityCalendarDetails.jsx", "AvailabilityCalendarDetails");
  const props = { selection: { id: "own-slot" }, onClose() {} };
  h.render(props); const cleanup = h.effects[0]();
  assert.equal(h.pending[0].path, "/availability/own-slot/calendar-details"); assert.equal(h.pending[0].options.cache, "no-store");
  h.pending[0].reject(Error("PRIVATE")); await settle(); let tree = h.render(props);
  assert.doesNotMatch(h.html(tree), /PRIVATE/); elements(tree).find(el => el.type === "button" && el.props.children === "Retry details").props.onClick();
  h.render(props); h.effects[0](); h.pending[1].resolve({ availability: { status: "Inactive / unavailable", mode: "Online", meetingPlatform: "Teams" } }); await settle();
  assert.match(h.html(h.render(props)), /Inactive \/ unavailable/);
  cleanup(); h.pending[0].resolve({ availability: { status: "stale" } }); await settle(); assert.doesNotMatch(h.html(h.render(props)), /stale/);
});

test("dedicated calendar routes selections by reference ID and restores focus after refresh removes an opener", async () => {
  const noop = () => null;
  const h = await harness("pages/Faculty/FacultyConsultationCalendar.jsx", "FacultyConsultationCalendar", {
    ConsultationCalendar: noop, FacultyConsultationsView: noop, AvailabilityCalendarDetails: noop,
  });
  const props = { consultationsPath: "/dean/faculty/consultations" };
  let tree = h.render(props); const root = tree.props.ref; let restored = 0;
  root.current = { focus() { restored++; } };
  const calendar = elements(tree).find(el => el.props?.personalCalendar);
  const opener = { isConnected: true, focus() { restored += 10; } };
  calendar.props.onEventClick({ id: "appointment-a-proposed", appointmentId: "a", kind: "appointment" }, opener);
  tree = h.render(props); let details = elements(tree).find(el => el.props?.detailOnly);
  assert.equal(details.props.selection.id, "a");
  details.props.onChanged(); tree = h.render(props); assert.equal(elements(tree).find(el => el.props?.personalCalendar).props.revision, 1);
  opener.isConnected = false; details = elements(tree).find(el => el.props?.detailOnly); details.props.onDetailClose(); await settle(); assert.equal(restored, 1);
  tree = h.render(props); elements(tree).find(el => el.props?.personalCalendar).props.onEventClick({ id: "availability-slot", availabilityId: "slot", kind: "availability" }, opener);
  tree = h.render(props); assert.equal(elements(tree).find(el => el.props?.selection?.kind === "availability").props.selection.id, "slot");
  assert.equal(elements(tree).find(el => el.props?.detailOnly).props.selection, null);
});
