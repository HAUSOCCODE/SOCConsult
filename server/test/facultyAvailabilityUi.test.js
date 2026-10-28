import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as dates from "../../client/src/utils/formatDateTime.js";
import { safeStudentError } from "../../client/src/utils/studentUiErrors.js";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server"), { transform } = require("esbuild");
const settle = () => new Promise(resolve => setImmediate(resolve));
const elements = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
const Link = ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children);
async function compile(path, names, imports) {
  const raw = await readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
  const source = raw.replace(/^import[\s\S]*?;\r?\n/gm, "").replace("export default function", "function");
  const compiled = await transform(source, { loader: "jsx" });
  return new Function("React", ...Object.keys(imports), `${compiled.code}; return {${names.join(",")}};`)(React, ...Object.values(imports));
}
async function management() {
  const state = [], effects = [], pending = [], listeners = {}, toasts = [];
  let cursor = 0;
  const imports = { ...dates, safeStudentError, Link,
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useEffect: callback => effects.push(callback),
    useToast: () => Object.fromEntries(["success", "warning", "error"].map(kind => [kind, value => toasts.push([kind, value])])),
    api: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
    window: { setInterval: () => 1, clearInterval() {}, scrollTo() {}, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; } },
    EmptyState: ({ title }) => React.createElement("p", null, title), ErrorState: ({ message }) => React.createElement("p", null, message),
    Loading: () => React.createElement("p", null, "Loading"), StatusBadge: ({ status }) => React.createElement("span", null, status), ConfirmDialog: () => null,
    ...Object.fromEntries(["Clock3", "ChevronDown", "MapPin", "Monitor", "Pencil", "Power", "Trash2", "UsersRound"].map(name => [name, () => null])),
  };
  const { ManageAvailability, ScheduleCard } = await compile("pages/Faculty/ManageAvailability.jsx", ["ManageAvailability", "ScheduleCard"], imports);
  return { state, effects, pending, listeners, toasts, ScheduleCard,
    render(props = {}) { cursor = 0; effects.length = 0; return ManageAvailability(props); },
  };
}

test("Manila form input and prefill round-trip midnight/leap boundaries in any host timezone", () => {
  const module = new URL("../../client/src/utils/formatDateTime.js", import.meta.url).href;
  const script = `import {parseManilaInput,manilaInputParts} from ${JSON.stringify(module)}; console.log(JSON.stringify([parseManilaInput('2099-01-01','00:05').toISOString(),manilaInputParts('2098-12-31T16:05:00Z')]))`;
  const outputs = ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map(TZ => execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" }));
  assert.equal(new Set(outputs).size, 1); assert.match(outputs[0], /2098-12-31T16:05:00.000Z/);
  assert.equal(dates.parseManilaInput("2099-02-29", "10:00"), null);
  assert.equal(dates.parseManilaInput("2099-01-01", "24:00"), null);
  assert.ok(dates.parseManilaInput("2096-02-29", "23:59"));
});

test("management rejects stale/unmounted refreshes and keeps Dean route bases and reservation guidance", async () => {
  const h = await management(); h.render(); const cleanup = h.effects[1]();
  h.listeners.focus(); h.pending[1].resolve({ availability: [] }); await settle();
  h.pending[0].resolve({ availability: [{ _id: "stale" }] }); await settle();
  let tree = h.render({ routeBase: "/dean/faculty", consultationsPath: "/dean/faculty/consultations" });
  assert.deepEqual(h.state[3], []);
  assert.match(renderToStaticMarkup(tree), /href="\/dean\/faculty\/calendar"/);
  h.listeners.focus(); cleanup(); h.pending[2].resolve({ availability: [{ _id: "unmounted" }] }); await settle();
  assert.deepEqual(h.state[3], []);
  const slot = { _id: "slot", startAt: "2099-01-01T02:00:00Z", endAt: "2099-01-01T02:30:00Z", mode: "Online", isActive: true, protected: true };
  const html = renderToStaticMarkup(React.createElement(h.ScheduleCard, { item: slot, expanded: true, consultationsPath: "/dean/faculty/consultations" }));
  assert.match(html, /Use reschedule or cancellation/); assert.match(html, /href="\/dean\/faculty\/consultations"/);
  assert.doesNotMatch(html, />Edit<|>Deactivate</); assert.match(html, /disabled=""/);
});

test("management submits an optional link and Manila instants, guards duplicate clicks and hides raw request errors", async () => {
  const h = await management(); h.render(); h.effects[1](); h.pending[0].resolve({ availability: [] }); await settle();
  let tree = h.render();
  const field = type => elements(tree).find(node => node.type === "input" && node.props.type === type);
  field("date").props.onChange({ target: { value: "2099-01-01" } }); tree = h.render();
  elements(tree).filter(node => node.type === "input" && node.props.type === "time")[0].props.onChange({ target: { value: "00:05" } }); tree = h.render();
  elements(tree).filter(node => node.type === "input" && node.props.type === "time")[1].props.onChange({ target: { value: "00:35" } }); tree = h.render();
  elements(tree).find(node => node.type === "select" && node.props.value === "Face-to-Face").props.onChange({ target: { value: "Online" } }); tree = h.render();
  const submit = elements(tree).find(node => node.type === "form").props.onSubmit;
  const saving = submit({ preventDefault() {} }); await submit({ preventDefault() {} });
  assert.equal(h.pending.length, 2);
  const body = JSON.parse(h.pending[1].options.body);
  assert.equal(body.startAt, "2098-12-31T16:05:00.000Z"); assert.equal(body.meetingLink, ""); assert.equal(body.isActive, true);
  h.pending[1].reject(Object.assign(Error("PRIVATE database payload"), { status: 500 })); await saving;
  assert.equal(h.toasts.at(-1)[1], "Unable to save availability.");
  assert.doesNotMatch(JSON.stringify(h.toasts), /PRIVATE/);
});

test("editing an overnight slot prefills both Manila dates and preserves its UTC instants and version", async () => {
  const h = await management(); h.render(); h.effects[1]();
  const slot = { _id: "overnight", startAt: "2098-12-31T15:30:00.000Z", endAt: "2098-12-31T16:30:00.000Z",
    mode: "Online", meetingPlatform: "Teams", isActive: false, __v: 3 };
  h.pending[0].resolve({ availability: [slot] }); await settle();
  let tree = h.render(); elements(tree).find(node => node.props?.onEdit).props.onEdit(slot); tree = h.render();
  assert.deepEqual(elements(tree).filter(node => node.type === "input" && node.props.type === "date").map(node => node.props.value), ["2098-12-31", "2099-01-01"]);
  const saving = elements(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  const body = JSON.parse(h.pending[1].options.body);
  assert.equal(body.startAt, slot.startAt); assert.equal(body.endAt, slot.endAt);
  assert.equal(body.expectedVersion, 3); assert.equal(body.isActive, false);
  h.pending[1].reject(Object.assign(Error("unavailable"), { status: 503 })); await saving;
});

test("combined calendar renders explicit labels/colors while Student legend and Dean appointment links remain intact", async () => {
  const imports = { Link, useDialogFocus() {}, createPortal: tree => tree,
    ...Object.fromEntries(["CalendarDays", "ChevronLeft", "ChevronRight", "X"].map(name => [name, () => null])),
    StatusBadge: ({ status }) => React.createElement("span", null, status), formatPersonName: value => value || "",
  };
  const { CalendarLegend, CalendarEventPill, CalendarEventModal, UpcomingPanel } = await compile("components/calendar/ConsultationCalendar.jsx",
    ["CalendarLegend", "CalendarEventPill", "CalendarEventModal", "UpcomingPanel"], imports);
  const legend = renderToStaticMarkup(React.createElement(CalendarLegend, { includeAvailability: true }));
  for (const label of ["Available", "Pending request", "Confirmed consultation", "Inactive / unavailable"]) assert.ok(legend.includes(label));
  const studentLegend = renderToStaticMarkup(React.createElement(CalendarLegend, {})); assert.doesNotMatch(studentLegend, /Available|Pending request|Inactive/);
  const event = { id: "a", start: "2099-01-01T02:00:00Z", end: "2099-01-01T02:30:00Z", student: { name: "Student" }, topic: "Project" };
  const colors = [];
  for (const status of ["Available", "Pending", "Confirmed", "Inactive"]) {
    const label = status === "Pending" ? "Pending request" : status === "Confirmed" ? "Confirmed consultation" : status;
    const html = renderToStaticMarkup(React.createElement(CalendarEventPill, { event: { ...event, status, displayStatus: label } }));
    assert.ok(html.includes(label)); colors.push(html.match(/border-(emerald|amber|maroon|slate)-\d+/)[1]);
  }
  assert.equal(new Set(colors).size, 4);
  // Calling the availability branch avoids appointment hooks and participant fields.
  const modal = CalendarEventModal({ event: { ...event, kind: "availability", status: "Available", mode: "Online", meetingPlatform: "Teams" } });
  assert.equal(modal.props.title, "Available slot"); assert.doesNotMatch(JSON.stringify(modal.props.children), /Reason \/ notes|Meeting link/);
  const upcoming = renderToStaticMarkup(React.createElement(UpcomingPanel, { items: [], loading: false, consultationsPath: "/dean/faculty/consultations" }));
  assert.match(upcoming, /href="\/dean\/faculty\/consultations"/);
});

for (const action of ["activate", "remove"]) test(action + " availability refreshes the integrated calendar after success", async () => {
  const h = await management(); let changed = 0; const props = { onChanged: () => changed++ };
  h.render(props); h.effects[1]();
  const slot = { _id: "slot", isActive: false, startAt: "2099-01-01T02:00:00Z", endAt: "2099-01-01T02:30:00Z", __v: 2 };
  h.pending[0].resolve({ availability: [slot] }); await settle();
  let tree = h.render(props); const card = elements(tree).find(el => el.props?.item?._id === "slot");
  let work;
  if (action === "activate") card.props.onToggle(slot);
  else { card.props.onRemove("slot"); tree = h.render(props); work = elements(tree).find(el => el.props?.title === "Remove Consultation Availability").props.onConfirm(); }
  assert.equal(h.pending[1].options.method, action === "activate" ? "PUT" : "DELETE");
  h.pending[1].resolve({ message: "Updated" }); await settle();
  h.pending[2].resolve({ availability: [] }); await settle(); if (work) await work;
  assert.equal(changed, 1);
});
