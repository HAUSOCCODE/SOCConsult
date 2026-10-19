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
  const { code } = await transform(source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace("export default function", "function"), { loader: "jsx" });
  const state = [], effects = [], pending = [], listeners = {}; let cursor = 0;
  const imports = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => state[index] = typeof value === "function" ? value(state[index]) : value]; },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
    api: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
    window: { addEventListener: (name, fn) => listeners[name] = fn, removeEventListener: name => delete listeners[name], setInterval: () => 1, clearInterval() {} },
    useDialogFocus() {}, createPortal: tree => tree,
    Link: ({ to, children }) => React.createElement("a", { href: to }, children),
    StatusBadge: ({ status }) => React.createElement("span", null, status), formatPersonName: value => value || "",
    isRecoverableStudentError: () => true, safeStudentError: () => "Unable to load calendar. Please try again.",
    DetailLoadingDialog: ({ children }) => React.createElement("section", null, children), consultationTime: value => value || "Not scheduled",
    ...Object.fromEntries(["CalendarDays", "ChevronLeft", "ChevronRight", "X"].map(name => [name, () => null])), ...extra,
  };
  const Component = new Function("React", ...Object.keys(imports), `${code};return ${name};`)(React, ...Object.values(imports));
  return { state, effects, pending, listeners, render(props = {}) { cursor = 0; effects.length = 0; return Component(props); }, html: renderToStaticMarkup };
}

test("personal calendar toggles, refresh, stale/unmounted responses and overflow recovery", async () => {
  const h = await harness("components/calendar/ConsultationCalendar.jsx", "ConsultationCalendar");
  const props = { personalCalendar: true, includeAvailability: true, showUpcoming: false };
  let tree = h.render(props); const cleanup = h.effects[0](); const stop = h.effects[1]();
  assert.match(h.pending[0].path, /includeInactive=true&includeFinalized=false/); assert.equal(h.pending[0].options.cache, "no-store");
  h.listeners.focus();
  tree = h.render(props); cleanup(); h.effects[0]();
  h.pending[1].resolve({ events: [] }); await settle();
  h.pending[0].resolve({ events: [{ id: "stale" }] }); await settle();
  tree = h.render(props); assert.doesNotMatch(h.html(tree), /stale/);
  const checkboxes = elements(tree).filter(el => el.type === "input" && el.props.type === "checkbox");
  assert.equal(checkboxes[0].props.checked, true); assert.equal(checkboxes[1].props.checked, false);
  checkboxes[0].props.onChange({ target: { checked: false } }); checkboxes[1].props.onChange({ target: { checked: true } });
  h.render(props); const cleanup2 = h.effects[0]();
  assert.match(h.pending[2].path, /includeInactive=false&includeFinalized=true/);
  h.pending[2].reject(Object.assign(Error("PRIVATE"), { status: 422 })); await settle();
  tree = h.render(props); const html = h.html(tree); assert.match(html, /Choose a narrower range using Week view/); assert.doesNotMatch(html, /PRIVATE/);
  const toolbar = elements(tree).find(el => el.props?.onView); toolbar.props.onView("week");
  h.render(props); const cleanup3 = h.effects[0]();
  const url = new URL("http://test" + h.pending[3].path); assert.equal((Date.parse(url.searchParams.get("end")) - Date.parse(url.searchParams.get("start"))) / 86400000, 6);
  cleanup3(); h.pending[3].resolve({ events: [{ id: "unmounted" }] }); await settle(); assert.deepEqual(h.state[3], []);
  cleanup2(); stop(); assert.equal(h.listeners.focus, undefined);
});

test("personal overlap events cover intersecting Manila dates; Student keeps original date grouping and query contract", async () => {
  const event = { id: "appointment-a-current", kind: "appointment", status: "Reschedule Proposed", displayStatus: "Current schedule - reschedule pending", start: "2099-01-01T15:30:00Z", end: "2099-01-01T16:30:00Z", participantName: "Student", topic: "Course" };
  for (const personalCalendar of [true, false]) {
    const h = await harness("components/calendar/ConsultationCalendar.jsx", "ConsultationCalendar");
    const props = { personalCalendar, includeAvailability: personalCalendar, showUpcoming: false };
    h.render(props); h.state[1] = "2099-01-01"; h.render(props); h.effects[0]();
    h.pending[0].resolve({ events: [event] }); await settle();
    const tree = h.render(props), month = elements(tree).find(el => el.props?.eventsByDate && el.props?.dates?.length === 42);
    assert.equal(month.props.eventsByDate.has("2099-01-01"), true);
    assert.equal(month.props.eventsByDate.has("2099-01-02"), personalCalendar);
    if (!personalCalendar) assert.doesNotMatch(h.pending[0].path, /includeInactive|includeFinalized|includeAvailability/);
    const clicks = []; const withClick = h.render({ ...props, onEventClick: (...args) => clicks.push(args) });
    const opener = {}; elements(withClick).find(el => el.props?.onOpenEvent).props.onOpenEvent(event, opener);
    assert.equal(clicks[0][0], event); assert.equal(clicks[0][1], opener);
  }
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

test("consolidated page routes selections by reference ID and restores focus after calendar refresh removes an opener", async () => {
  const noop = () => null;
  const h = await harness("pages/Faculty/FacultyAvailabilityCalendar.jsx", "FacultyAvailabilityCalendar", {
    ManageAvailability: noop, ConsultationCalendar: noop, FacultyConsultationsView: noop, AvailabilityCalendarDetails: noop,
  });
  const props = { routeBase: "/dean/faculty", consultationsPath: "/dean/faculty/consultations" };
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
