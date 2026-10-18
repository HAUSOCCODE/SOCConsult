import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react"), { transform } = require("esbuild");
const source = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));

function host() {
  const state = [], effects = [], previous = [];
  let slot = 0, effectSlot = 0;
  return {
    useRef(value) { const index = slot++; return state[index] ??= { current: value }; },
    useState(value) { const index = slot++; if (!(index in state)) state[index] = value; return [state[index], next => { state[index] = next; }]; },
    useEffect(fn, deps) { effects[effectSlot++] = { fn, deps }; },
    render(fn) { slot = 0; effectSlot = 0; return fn(); },
    commit() { effects.forEach((effect, index) => {
      if (!previous[index] || effect.deps.some((value, i) => !Object.is(value, previous[index].deps[i]))) {
        previous[index]?.cleanup?.(); previous[index] = { deps: effect.deps, cleanup: effect.fn() };
      }
    }); },
    unmount() { previous.forEach(effect => effect.cleanup?.()); }, state,
  };
}
function fakeDocument() {
  const listeners = new Map();
  const doc = { activeElement: null, body: { style: { overflow: "auto" } },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name, data = {}) {
      const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...data };
      for (const listener of listeners.get(name) || []) { listener(event); if (event.stopped) break; }
      return event;
    },
  };
  return doc;
}
function control(doc, options = {}) {
  return { tabIndex: 0, isConnected: true, disabled: false, closest: () => null, getClientRects: () => [1],
    focus() { doc.activeElement = this; }, ...options };
}
function panel(doc, items) {
  return control(doc, { tabIndex: -1, querySelectorAll: () => items, querySelector: () => items[0], contains: item => items.includes(item),
  });
}

test("nested dialog keyboard handling belongs to top layer; busy, restoration and scroll locks are safe", async () => {
  const old = globalThis.document, doc = fakeDocument(); globalThis.document = doc;
  let current;
  const raw = (await source("hooks/useDialogFocus.js")).replace(/^import.*$/gm, "").replace("export default function", "function").replace("export function", "function");
  const hook = new Function("useRef", "useEffect", `${raw}; return useDialogFocus;`)(value => current.useRef(value), (fn, deps) => current.useEffect(fn, deps));
  const outer = host(), inner = host();
  const opener = control(doc), first = control(doc), last = control(doc), confirm = control(doc);
  const outerPanel = panel(doc, [first, last]), innerPanel = panel(doc, [confirm]);
  outerPanel.contains = value => value === outerPanel || [first, last].includes(value);
  innerPanel.contains = value => value === innerPanel || value === confirm;
  const outerRef = { current: outerPanel }, innerRef = { current: innerPanel };
  let parentClosed = 0, childClosed = 0;
  const render = (h, ref, props) => { current = h; h.render(() => hook(ref, props)); h.commit(); };
  try {
    opener.focus(); render(outer, outerRef, { onClose: () => parentClosed++ }); assert.equal(doc.activeElement, first);
    last.focus(); doc.fire("keydown", { key: "Tab" }); assert.equal(doc.activeElement, first);
    doc.fire("keydown", { key: "Tab", shiftKey: true }); assert.equal(doc.activeElement, last);
    render(inner, innerRef, { onClose: () => childClosed++ }); assert.equal(doc.activeElement, confirm);
    doc.fire("keydown", { key: "Escape" }); assert.equal(childClosed, 1); assert.equal(parentClosed, 0);
    render(inner, innerRef, { busy: true, onClose: () => childClosed++ }); assert.equal(doc.activeElement, innerPanel);
    assert.equal(doc.fire("keydown", { key: "Escape" }).prevented, true); assert.equal(childClosed, 1);
    doc.fire("keydown", { key: "Tab" }); assert.equal(doc.activeElement, confirm);
    opener.focus(); doc.fire("focusin", { target: opener }); assert.equal(doc.activeElement, confirm);
    inner.unmount(); await settle(); assert.equal(doc.activeElement, last); assert.equal(doc.body.style.overflow, "hidden");
    doc.fire("keydown", { key: "Escape" }); assert.equal(parentClosed, 1);
    outer.unmount(); await settle(); assert.equal(doc.activeElement, opener); assert.equal(doc.body.style.overflow, "auto");
    const parent2 = host(), child2 = host();
    opener.focus(); render(parent2, outerRef, {}); render(child2, innerRef, {});
    parent2.unmount(); first.isConnected = false; last.isConnected = false; child2.unmount(); await settle();
    assert.equal(doc.activeElement, opener); assert.equal(doc.body.style.overflow, "auto");
  } finally { globalThis.document = old; }
});

test("focus skips hidden, inert, disabled and negative-tabindex controls and tolerates removed openers", async () => {
  const old = globalThis.document, doc = fakeDocument(); globalThis.document = doc;
  const h = host();
  const raw = (await source("hooks/useDialogFocus.js")).replace(/^import.*$/gm, "").replace("export default function", "function").replace("export function", "function");
  const hook = new Function("useRef", "useEffect", `${raw}; return useDialogFocus;`)(h.useRef, h.useEffect);
  const opener = control(doc), hidden = control(doc, { getClientRects: () => [] }), inert = control(doc, { closest: () => ({}) });
  const disabled = control(doc, { disabled: true }), negative = control(doc, { tabIndex: -1 }), visible = control(doc);
  const content = panel(doc, [hidden, inert, disabled, negative, visible]); content.contains = value => value === visible || value === content;
  try {
    opener.focus(); h.render(() => hook({ current: content })); h.commit(); assert.equal(doc.activeElement, visible);
    opener.isConnected = false; h.unmount(); await settle(); assert.equal(doc.activeElement, visible);
  } finally { globalThis.document = old; }
});

test("overflow region is named and enters the tab sequence only while meaningfully scrollable", async () => {
  const h = host(), oldWindow = globalThis.window, oldObserver = globalThis.ResizeObserver;
  let resized, disconnected = false;
  globalThis.window = { addEventListener(name, fn) { resized = fn; }, removeEventListener() {} };
  globalThis.ResizeObserver = class { constructor(fn) { resized = fn; } observe() {} disconnect() { disconnected = true; } };
  const raw = (await source("components/ResponsiveTable.jsx")).replace(/^import.*$/gm, "").replace("export default function", "function");
  const { code } = await transform(raw, { loader: "jsx" });
  const Component = new Function("React", "useRef", "useState", "useEffect", `const { cloneElement, isValidElement } = React; ${code}; return ResponsiveTable;`)(React, h.useRef, h.useState, h.useEffect);
  const props = { label: "Consultation records", children: React.createElement("table") };
  const element = { clientWidth: 300, scrollWidth: 1000 };
  try {
    let tree = h.render(() => Component(props)); tree.props.ref.current = element; h.commit();
    tree = h.render(() => Component(props)); assert.equal(tree.props.role, "region"); assert.equal(tree.props["aria-label"], props.label); assert.equal(tree.props.tabIndex, 0);
    assert.equal(tree.props.children.type, "table"); assert.equal(tree.props.children.props["aria-label"], props.label);
    element.clientWidth = 1200; resized(); tree = h.render(() => Component(props)); assert.equal(tree.props.tabIndex, undefined);
    element.clientWidth = 0; resized(); assert.equal(h.render(() => Component(props)).props.tabIndex, undefined);
    h.unmount(); assert.ok(disconnected);
  } finally { globalThis.window = oldWindow; globalThis.ResizeObserver = oldObserver; }
});

test("Dean tables preserve scoped headers; shared layout and fields expose navigation and error semantics", async () => {
  for (const path of ["pages/Dean/DeanDashboard.jsx", "pages/Dean/CsvImport.jsx", "pages/Dean/UserManagement.jsx", "pages/Dean/ConsultationMonitoring.jsx", "pages/Dean/AttendanceReview.jsx", "pages/Dean/ManagementAuditFeed.jsx", "components/accounts/CSVErrorTable.jsx", "components/notifications/NotificationsView.jsx"]) {
    const raw = await source(path);
    assert.match(raw, /<ResponsiveTable label="[^"]+"/);
    for (const header of raw.matchAll(/<th\b[^>]*>/g)) assert.match(header[0], /scope="col"/);
  }
  const layout = await source("components/RoleLayout.jsx"), audit = await source("pages/Dean/AuditLogs.jsx");
  assert.match(layout, /inert=\{!desktop && !open\}/); assert.match(layout, /aria-expanded=\{open\}/); assert.match(layout, /Notifications,.*unread/);
  assert.doesNotMatch(audit, /role="tab"|aria-selected/); assert.match(audit, /aria-pressed=\{selectedId === user.id\}/); assert.match(audit, /mobilePanel.current\?\.focus/);
  assert.match(await source("components/profile/ProfileForm.jsx"), /aria-describedby=\{nameErrors\[key\]/);
  const css = await source("index.css"); assert.match(css, /overflow-wrap: anywhere/);
  for (const path of ["components/ConfirmDialog.jsx", "components/accounts/ManualAccountForm.jsx", "components/attendance/AttendanceReviewDetails.jsx", "components/appointments/FacultyScheduleDetailsModal.jsx", "components/appointments/FacultyAppointmentDetailsModal.jsx", "components/calendar/ConsultationCalendar.jsx", "components/profile/ProfilePictureEditor.jsx", "components/appointments/OneTimeScheduleRequests.jsx"]) {
    const raw = await source(path); assert.match(raw, /useDialogFocus\(/); assert.doesNotMatch(raw, /tabIndex=\{[1-9]/);
  }
});

test("confirmation input exposes required/error associations and uses native disabled action buttons", async () => {
  const raw = (await source("components/ConfirmDialog.jsx")).replace(/^import.*$/gm, "").replace("export default function", "function");
  const { code } = await transform(raw, { loader: "jsx" });
  let id = 0;
  const Dialog = new Function("React", "useId", "useRef", "useDialogFocus", "createPortal", "X", `${code}; return ConfirmDialog;`)(React, () => `dialog-${id++}`, () => ({ current: null }), () => {}, child => child, () => null);
  const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  let confirmed = 0;
  const props = { portalTarget: {}, open: true, title: "Deactivate account", message: "Confirm deactivation", inputLabel: "Deactivation reason (required)", inputRequired: true, inputError: "A reason is required.", onConfirm: () => confirmed++, onCancel() {} };
  const all = nodes(Dialog(props)), field = all.find(node => node.type === "textarea");
  assert.equal(field.props.required, true); assert.equal(field.props["aria-invalid"], true);
  assert.ok(all.some(node => node.props?.id === field.props["aria-describedby"] && node.props.children === props.inputError));
  assert.ok(all.some(node => node.type === "label" && nodes(node).includes(field)));
  const confirm = all.filter(node => node.type === "button").at(-1);
  assert.equal(confirm.props.type, "button"); confirm.props.onClick(); assert.equal(confirmed, 1);
  for (const button of nodes(Dialog({ ...props, loading: true })).filter(node => node.type === "button")) assert.equal(button.props.disabled, true);
});

test("status badges retain full visible text and calendar events expose status without color", async () => {
  const raw = (await source("components/UI.jsx")).replace(/^import.*$/gm, "").replaceAll("export const", "const").replaceAll("export function", "function");
  const { code } = await transform(raw, { loader: "jsx" });
  const Badge = new Function("React", `${code}; return StatusBadge;`)(React);
  for (const status of ["Active", "Inactive", "Attendance Review", "Awaiting Attendance Update", "Reschedule Proposed", "Read", "Unread"]) {
    const node = Badge({ status, allowWrap: true }); assert.equal(node.props.children, status); assert.match(node.props.className, /whitespace-normal/);
  }
  const calendar = await source("components/calendar/ConsultationCalendar.jsx");
  for (const name of ["CalendarEventPill", "WeekEvent"]) {
    const body = calendar.slice(calendar.indexOf(`function ${name}`)).split("\nfunction ")[0];
    assert.match(body, />\{event.status\}<\/span>/);
  }
  const { code: calendarCode } = await transform(calendar.replace(/^import.*$/gm, "").replace("export default function", "function"), { loader: "jsx" });
  const Pill = new Function("React", `${calendarCode}; return CalendarEventPill;`)(React);
  const topic = "A very long consultation subject ".repeat(30);
  const event = { status: "Attendance Review", participantName: "Long Participant Name", topic, start: "2026-10-18T16:05:00Z" };
  let opened;
  const tree = Pill({ event, onOpen: (value, trigger) => { opened = { value, trigger }; } });
  assert.ok(tree.props["aria-label"].includes(topic));
  const trigger = {}; tree.props.onClick({ currentTarget: trigger });
  assert.equal(opened.value.topic, topic); assert.equal(opened.trigger, trigger);
});
