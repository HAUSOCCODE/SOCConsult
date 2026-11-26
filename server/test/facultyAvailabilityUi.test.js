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
  const h = await management(); h.render(); const cleanup = h.effects[0]();
  h.listeners.focus(); h.pending[1].resolve({ availability: [] }); await settle();
  h.pending[0].resolve({ availability: [{ _id: "stale" }] }); await settle();
  let tree = h.render({ routeBase: "/dean/faculty", consultationsPath: "/dean/faculty/consultations" });
  assert.deepEqual(h.state[3], []);
  assert.match(renderToStaticMarkup(tree), /href="\/dean\/faculty\/calendar"/);
  h.listeners.focus(); cleanup(); h.pending[2].resolve({ availability: [{ _id: "unmounted" }] }); await settle();
  assert.deepEqual(h.state[3], []);
  const slot = { _id: "slot", startAt: "2099-01-01T02:00:00Z", endAt: "2099-01-01T02:30:00Z", mode: "Online", isActive: true, protected: true };
  const html = renderToStaticMarkup(React.createElement(h.ScheduleCard, { item: slot, expanded: true, consultationsPath: "/dean/faculty/consultations" }));
  assert.match(html, /This schedule has an existing consultation reservation/); assert.match(html, /href="\/dean\/faculty\/consultations"/);
  assert.doesNotMatch(html, />Edit<|>Deactivate<|>Remove</);
});

test("management submits an optional link and Manila instants, guards duplicate clicks and hides raw request errors", async () => {
  const h = await management(); h.render(); h.effects[0](); h.pending[0].resolve({ availability: [] }); await settle();
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
  const h = await management(); h.render(); h.effects[0]();
  const slot = { _id: "overnight", startAt: "2098-12-31T15:30:00.000Z", endAt: "2098-12-31T16:30:00.000Z",
    mode: "Online", meetingPlatform: "Teams", isActive: false, __v: 3 };
  h.pending[0].resolve({ availability: [slot] }); await settle();
  let tree = h.render(); elements(tree).find(node => node.props?.onEdit).props.onEdit(slot); tree = h.render();
  const form = elements(tree).find(node => node.type === "form");
  assert.deepEqual(elements(form).filter(node => node.type === "input" && node.props.type === "date").map(node => node.props.value), ["2098-12-31", "2099-01-01"]);
  const saving = form.props.onSubmit({ preventDefault() {} });
  const body = JSON.parse(h.pending[1].options.body);
  assert.equal(body.startAt, slot.startAt); assert.equal(body.endAt, slot.endAt);
  assert.equal(body.expectedVersion, 3); assert.equal(body.isActive, false);
  h.pending[1].reject(Object.assign(Error("unavailable"), { status: 503 })); await saving;
});

test("combined FullCalendar keeps explicit event categories, details and Dean links", async () => {
  const calendar = await readFile(new URL("../../client/src/components/calendar/ConsultationCalendar.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../../client/src/components/calendar/consultation-calendar.css", import.meta.url), "utf8");
  for (const label of ["Consultation", "Reschedule proposal", "Available slot", "Inactive / unavailable", "Philippine public holiday"])
    assert.ok(calendar.includes(label), label);
  for (const category of ["consultation", "proposal", "availability", "unavailable", "finalized", "holiday"])
    assert.match(css, new RegExp(`fc-event-${category}`));
  assert.match(calendar, /Consultation Details/);
  assert.match(calendar, /Availability Details/);
  assert.match(calendar, /to=\{consultationsPath\}/);
  assert.match(calendar, /eventStartEditable=\{false\}/);
});

for (const action of ["activate", "remove"]) test(action + " availability refreshes the integrated calendar after success", async () => {
  const h = await management(); let changed = 0; const props = { onChanged: () => changed++ };
  h.render(props); h.effects[0]();
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

const semesterSlot = (_id, extra = {}) => ({
  _id, startAt: "2098-12-31T16:00:00.000Z", endAt: "2098-12-31T16:30:00.000Z",
  mode: "Online", isActive: true, __v: 4, ...extra,
});
const button = (tree, label) => elements(tree).find(node => node.type === "button" &&
  [node.props.children].flat().filter(child => typeof child === "string").join("").startsWith(label));
const cards = tree => elements(tree).filter(node => node.props?.item).map(node => node.props.item._id);

test("published schedules group by end time, show empty states, and keep ongoing and historical cards read-only", async () => {
  const h = await management(); h.render(); h.effects[0]();
  const now = Date.now();
  const ongoing = semesterSlot("ongoing", { startAt: new Date(now - 60_000), endAt: new Date(now + 60_000) });
  const active = semesterSlot("active"), inactive = semesterSlot("inactive", { isActive: false });
  const past = semesterSlot("past", { startAt: new Date(now - 120_000), endAt: new Date(now) });
  h.pending[0].resolve({ availability: [active, inactive, ongoing, past] }); await settle();
  let tree = h.render();
  assert.deepEqual(cards(tree), ["active", "inactive", "ongoing"]);
  assert.equal(button(tree, "Current & Upcoming").props["aria-pressed"], true);
  const html = renderToStaticMarkup(tree);
  assert.match(html, />Active<.*>Inactive</);
  assert.match(html, /This schedule has already started/);
  for (const [item, label] of [[ongoing, /already started/], [past, /Expired/],
    [semesterSlot("starts-now", { startAt: new Date(now), endAt: new Date(now + 1) }), /already started/]]) {
    const card = renderToStaticMarkup(React.createElement(h.ScheduleCard, { item, expanded: true, now }));
    assert.match(card, label);
    assert.doesNotMatch(card, />Edit<|>Activate<|>Deactivate<|>Remove</);
  }
  button(tree, "Past Schedules").props.onClick(); tree = h.render();
  assert.deepEqual(cards(tree), ["past"]);
  assert.match(renderToStaticMarkup(tree), />Expired</);
  h.listeners.focus(); h.pending[1].resolve({ availability: [] }); await settle();
  tree = h.render(); assert.match(renderToStaticMarkup(tree), /No past schedules\./);
  button(tree, "Current & Upcoming").props.onClick();
  assert.match(renderToStaticMarkup(h.render()), /No current or upcoming schedules\./);
});

async function semesterManagement(availability, props = {}) {
  const h = await management(); h.render(props); h.effects[0]();
  h.pending[0].resolve({ availability }); await settle();
  button(h.render(props), "End Semester Availability").props.onClick();
  const render = () => h.render(props);
  const date = (label, value) => elements(render()).find(node => node.props?.label === `Semester ${label} Date`)
    .props.children.props.onChange({ target: { value } });
  const confirm = () => {
    button(render(), "Review Deactivation").props.onClick();
    return elements(render()).find(node => node.props.title === "Confirm End Semester Availability").props;
  };
  return { ...h, render, date, confirm };
}

test("semester preview validates both dates and includes both Manila date boundaries by schedule start", async () => {
  const first = semesterSlot("first");
  const last = semesterSlot("last", { startAt: "2099-01-02T15:59:59.999Z", endAt: "2099-01-02T16:30:00Z" });
  const h = await semesterManagement([first, last,
    semesterSlot("previous-day", { startAt: "2098-12-31T15:59:59.999Z" }),
    semesterSlot("next-day", { startAt: "2099-01-02T16:00:00Z", endAt: "2099-01-02T16:30:00Z" }),
    semesterSlot("inactive", { isActive: false }), semesterSlot("protected", { protected: true }),
  ], { consultationsPath: "/dean/faculty/consultations" });
  assert.match(renderToStaticMarkup(h.render()), /Select both dates/);
  assert.equal(button(h.render(), "Review Deactivation").props.disabled, true);
  h.date("Start", "2099-01-02"); h.date("End", "2099-01-01");
  assert.match(renderToStaticMarkup(h.render()), /end date on or after the start date/);
  assert.equal(button(h.render(), "Review Deactivation").props.disabled, true);
  h.date("Start", "2099-02-29"); h.date("End", "2099-03-01");
  assert.equal(button(h.render(), "Review Deactivation").props.disabled, true);
  h.date("Start", "2099-01-04"); h.date("End", "2099-01-04");
  assert.match(renderToStaticMarkup(h.render()), /No eligible schedules/);
  assert.equal(button(h.render(), "Review Deactivation").props.disabled, true);
  h.date("Start", "2099-01-01"); h.date("End", "2099-01-02");
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /2 eligible for deactivation/);
  assert.match(html, /2 to skip \(1 inactive, 0 started or ended, 1 reserved\)/);
  assert.match(html, /href="\/dean\/faculty\/consultations"/);
  const confirm = h.confirm();
  assert.match(confirm.message, /Deactivate 2 schedules from 2099-01-01 through 2099-01-02/);
  assert.equal(h.pending.length, 1);
  confirm.onCancel(); assert.equal(h.pending.length, 1);
});

test("semester confirmation is sequential and versioned, reports partial outcomes, and shows refreshed records", async () => {
  const available = ["ok", "new-reservation", "stale", "network", "unconfirmed"].map(id => semesterSlot(id));
  const inactive = semesterSlot("inactive", { isActive: false }), reserved = semesterSlot("reserved", { protected: true });
  const expired = semesterSlot("expired", { startAt: "2020-01-01T02:00:00Z", endAt: "2020-01-01T02:30:00Z" });
  const otherDay = semesterSlot("outside", { startAt: "2099-01-02T16:00:00Z", endAt: "2099-01-02T16:30:00Z" });
  let changes = 0;
  const h = await semesterManagement([...available, inactive, reserved, expired, otherDay], { onChanged: () => changes++ });
  h.date("Start", "2020-01-01"); h.date("End", "2099-01-02");
  assert.match(renderToStaticMarkup(h.render()), /3 to skip \(1 inactive, 1 started or ended, 1 reserved\)/);
  const confirm = h.confirm();
  const work = confirm.onConfirm(); await confirm.onConfirm();
  assert.equal(h.pending.length, 2);
  assert.equal(button(h.render(), "Review Deactivation").props.disabled, true);
  const outcomes = [
    request => request.resolve({ availability: semesterSlot("ok", { isActive: false, __v: 5 }) }),
    request => request.reject(Object.assign(Error("This slot has a reserved consultation. Use the consultation reschedule or cancellation workflow."), { status: 409 })),
    request => request.reject(Object.assign(Error("This availability changed. Refresh and try again."), { status: 409 })),
    request => request.reject(Error("PRIVATE network failure")),
    request => request.resolve({ availability: semesterSlot("unconfirmed") }),
  ];
  for (const [index, settleRequest] of outcomes.entries()) {
    assert.equal(h.pending.length, index + 2);
    const request = h.pending[index + 1];
    assert.equal(request.path, `/availability/${available[index]._id}`);
    assert.equal(request.options.method, "PUT");
    assert.deepEqual(JSON.parse(request.options.body), { isActive: false, expectedVersion: 4 });
    settleRequest(request); await settle();
  }
  const refresh = h.pending.at(-1);
  assert.equal(refresh.path, "/availability/mine");
  assert.equal(refresh.options.cache, "no-store");
  refresh.resolve({ availability: [semesterSlot("ok", { isActive: false }), inactive, reserved, expired, otherDay] });
  await work;
  const tree = h.render();
  assert.deepEqual(cards(tree), ["ok", "inactive", "reserved", "outside"]);
  assert.equal(elements(tree).find(node => node.props?.item?._id === "ok").props.item.isActive, false);
  assert.equal(changes, 1);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /1 deactivated/);
  assert.match(html, /5 skipped \(1 inactive, 1 started or ended, 2 reserved, 1 changed or removed\)/);
  assert.match(html, /2 updates could not be confirmed/);
  assert.doesNotMatch(html, /PRIVATE/);
});

test("semester authorization failure stops further updates and keeps the result visible if refresh fails", async () => {
  const h = await semesterManagement([semesterSlot("first"), semesterSlot("second")]);
  h.date("Start", "2099-01-01"); h.date("End", "2099-01-01");
  const work = h.confirm().onConfirm();
  h.pending[1].reject(Object.assign(Error("Forbidden"), { status: 403 })); await settle();
  assert.equal(h.pending.length, 3);
  assert.equal(h.pending[2].path, "/availability/mine");
  h.pending[2].reject(Error("Offline")); await work;
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /Unable to load availability/);
  assert.match(html, /0 deactivated/);
  assert.match(html, /1 update could not be confirmed/);
  assert.match(html, /1 schedule left unprocessed/);
  assert.equal(button(h.render(), "Review Deactivation").props.disabled, true);
});
