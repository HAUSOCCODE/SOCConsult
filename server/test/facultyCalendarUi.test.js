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
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => state[index] = typeof value === "function" ? value(state[index]) : value]; },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
    api: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
    window: { addEventListener: (name, fn) => listeners[name] = fn, removeEventListener: name => delete listeners[name], setInterval: () => 1, clearInterval() {} },
    useDialogFocus() {}, createPortal: tree => tree,
    Link: ({ to, children }) => React.createElement("a", { href: to }, children),
    FullCalendar: () => React.createElement("div", { "data-fullcalendar": true }),
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

test("PDF lifecycle recovers after every failure, blocks duplicates and survives StrictMode replay", async () => {
  const requests = [], urls = [], revoked = [], clicks = [];
  let failClick = false;
  const api = { download: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) };
  const h = await harness("pages/Faculty/FacultyReports.jsx", "FacultyReports", {
    api, FacultyReportFilters: () => null, safeUiError: () => "Please try again.",
    URL: { createObjectURL: () => { urls.push("blob:test"); return "blob:test"; }, revokeObjectURL: url => revoked.push(url) },
    document: { body: { appendChild() {} }, createElement: () => ({ click() { if (failClick) throw Error("download failed"); clicks.push(true); }, remove() {} }) },
    setTimeout: fn => fn(),
  });
  const form = () => elements(h.render()).find(el => el.props?.onSubmit);
  const submit = () => form().props.onSubmit({ preventDefault() {} });
  h.render(); h.effects[0]()(); h.effects[0](); // StrictMode setup / cleanup / setup
  for (const status of [400, 401, 403, 404, 413, 500, 503]) {
    const work = submit(); const duplicate = submit();
    assert.equal(form().props.busy, true);
    const count = requests.length; await duplicate; assert.equal(requests.length, count);
    requests.at(-1).reject({ status }); await work;
    assert.equal(form().props.busy, false); assert.ok(form().props.error);
  }
  for (const blob of [new Blob(["oops"], { type: "text/html" }), new Blob([], { type: "application/pdf" }), undefined]) {
    const work = submit(); requests.at(-1).resolve({ blob }); await work;
    assert.equal(form().props.busy, false); assert.ok(form().props.error);
  }
  assert.equal(urls.length, 0);
  failClick = true;
  let work = submit(); requests.at(-1).resolve({ blob: new Blob(["%PDF"], { type: "application/pdf" }) }); await work;
  assert.equal(form().props.busy, false); assert.equal(h.state[3], ""); assert.equal(revoked.length, 1);
  failClick = false;
  work = submit(); requests.at(-1).resolve({ blob: new Blob(["%PDF"], { type: "application/pdf" }), total: 1 }); await work;
  assert.equal(form().props.busy, false); assert.match(h.state[3], /successfully/); assert.equal(clicks.length, 1); assert.equal(revoked.length, 2);
  work = submit(); h.effects[0]()();
  const snapshot = h.state.slice(0, 4);
  requests.at(-1).resolve({ blob: new Blob(["%PDF"], { type: "application/pdf" }) }); await work;
  assert.deepEqual(h.state.slice(0, 4), snapshot); assert.equal(urls.length, 2);
});

test("calendar retains navigation through 422, Week/Day recovery, retry and stale requests", async () => {
  for (const personalCalendar of [false, true]) {
    const h = await harness("components/calendar/ConsultationCalendar.jsx", "ConsultationCalendar");
    const props = { personalCalendar, showUpcoming: false };
    const calendar = () => elements(h.render(props)).find(el => el.props?.initialView === "dayGridMonth");
    const range = (start, endStr) => calendar().props.datesSet({ startStr: start, endStr });
    range("2099-01-01", "2099-02-01"); h.render(props); const oldCleanup = h.effects[0]();
    h.pending[0].reject({ status: 422 }); await settle();
    assert.ok(calendar()); assert.match(h.html(h.render(props)), /Choose a narrower Week or Day view/);
    assert.match(calendar().props.headerToolbar.right, /dayGridMonth,timeGridWeek,timeGridDay,listMonth/);
    assert.doesNotMatch(h.html(h.render(props)), /No consultations are scheduled/);
    range("2099-01-01", "2099-01-08"); oldCleanup(); h.render(props); const weekCleanup = h.effects[0]();
    assert.match(h.pending[1].path, /end=2099-01-07/);
    h.pending[1].reject({ status: 503 }); await settle();
    range("2099-01-01", "2099-01-02"); weekCleanup(); h.render(props); const dayCleanup = h.effects[0]();
    assert.match(h.pending[2].path, /end=2099-01-01/);
    const err = elements(h.render(props)).find(el => el.type?.name === "CalendarError");
    // Current request clears the previous error; retry after another failure.
    assert.equal(err, undefined);
    h.pending[2].reject({ status: 503 }); await settle();
    elements(h.render(props)).find(el => el.type?.name === "CalendarError").props.onRetry();
    dayCleanup(); h.render(props); h.effects[0]();
    h.pending[3].resolve({ events: [] }); await settle();
    assert.equal(elements(h.render(props)).some(el => el.type?.name === "CalendarError"), false);
    assert.equal(h.state[6], false);
    range("2099-02-01", "2099-02-08"); h.render(props); h.effects[0]();
    range("2099-03-01", "2099-03-08"); h.render(props); h.effects[0]();
    h.pending[5].resolve({ events: [{ id: "new" }] }); await settle();
    h.pending[4].resolve({ events: [{ id: "old" }] }); await settle();
    assert.equal(h.state[1][0].id, "new");
    const current = h.state[0]; range("2099-03-01", "2099-03-08"); assert.equal(h.state[0], current);
    assert.equal(h.pending.length, 6);
  }
});

test("Student calendar hydrates actual appointment references with loading, retry and abort protection", async () => {
  const modal = () => null;
  const h = await harness("pages/Student/StudentCalendar.jsx", "StudentCalendarDetails", { StudentAppointmentDetailsModal: modal, safeStudentError: () => "Unable to load details" });
  const props = { selection: { id: "appointment-a", opener: {} }, onClose() {} };
  let tree = h.render(props); assert.match(h.html(tree), /Loading consultation details/);
  const cleanup = h.effects[0](); assert.equal(h.pending[0].path, "/appointments/student-details/appointment-a");
  h.pending[0].reject({ status: 404 }); await settle();
  tree = h.render(props); assert.match(h.html(tree), /Unable to load details/);
  elements(tree).find(el => el.props?.children === "Retry details").props.onClick();
  h.render(props); h.effects[0]();
  h.pending[1].resolve({ appointment: { _id: "appointment-a", subject: "Current record" } }); await settle();
  tree = h.render(props); assert.equal(tree.type, modal); assert.equal(tree.props.readOnly, undefined); assert.equal(tree.props.appointment.subject, "Current record");
  assert.equal(tree.props.opener, props.selection.opener);
  cleanup();
  const stale = await harness("pages/Student/StudentCalendar.jsx", "StudentCalendarDetails", { StudentAppointmentDetailsModal: modal });
  stale.render(props); const close = stale.effects[0](); close();
  stale.pending[0].resolve({ appointment: { _id: "appointment-a" } }); await settle();
  assert.equal(stale.state[0].appointment, undefined);
  const page = await harness("pages/Student/StudentCalendar.jsx", "StudentCalendar", { ConsultationCalendar: () => null });
  const calendar = elements(page.render()).find(el => el.props?.onEventClick);
  calendar.props.onEventClick({ id: "soc-display-only", appointmentId: "actual-id" }, props.selection.opener);
  assert.equal(page.state[0].id, "actual-id");
  calendar.props.onEventClick({ id: "another-id" }); assert.equal(page.state[0].id, "another-id");
  const detail = elements(page.render()).find(el => el.type?.name === "StudentCalendarDetails"); assert.equal(detail.key, "another-id");
});

test("history modal separates requested and confirmed dates, keeps metadata and prevents historical actions", async () => {
  const { hasConfirmedSchedule, preferredTimeLabel, requestedDateLabel } = await import("../../client/src/utils/appointmentSchedule.js");
  const { formatPersonName } = await import("../../client/src/utils/formatPersonName.js");
  const stubs = Object.fromEntries(["CalendarDownload", "StatusBadge", "SupportingDocumentViewer", "OnlineMeetingDetails", "StudentAttendanceResponseForm", "AttendanceResponseSummary", "StudentConsultationRecord", "OutcomeReportSummary", "RequestedAvailability"].map(name => [name, () => null]));
  const h = await harness("components/appointments/StudentAppointmentDetailsModal.jsx", "StudentAppointmentDetailsModal", {
    ...stubs, hasConfirmedSchedule, formatPersonName, getAppointmentDisplayStatus: appointment => appointment.status,
    canStudentCancelAppointment: () => true, document: { body: {} },
  });
  const appointment = { _id: "a", status: "Completed", requestedConsultationDate: "2026-10-19", startAt: "2026-10-20T01:00:00Z", endAt: "2026-10-20T02:00:00Z", faculty: { firstName: "Faculty", lastName: "Owner" } };
  const props = { appointment, readOnly: true, historyMode: true, onClose() {} };
  const tree = h.render(props), nodes = elements(tree);
  assert.equal(nodes.find(el => el.props?.label === "Faculty Name").props.value, "Faculty Owner");
  assert.match(nodes.find(el => el.props?.label === "Consultation Date").props.value, /20/);
  assert.equal(nodes.find(el => el.type === stubs.RequestedAvailability).props.appointment.requestedConsultationDate, "2026-10-19");
  assert.ok(nodes.find(el => el.props?.title === "Confirmed Schedule"));
  assert.equal(nodes.find(el => el.type === stubs.OutcomeReportSummary).props.viewerRole, undefined);
  const cleanup = h.effects[0](); cleanup(); h.pending[0].resolve({ attendance: { private: "stale" } }); await settle(); assert.equal(h.state[0], null);
  const availability = await harness("components/appointments/RequestedAvailability.jsx", "RequestedAvailability", { clock: preferredTimeLabel, requestedDateLabel });
  const availabilityTree = availability.render({ appointment: { ...appointment, requestedConsultationTime: "08:00", availableTimeSlots: [{ startTime: "09:00", endTime: "10:00" }, { startTime: "13:00", endTime: "15:00" }] } });
  const html = availability.html(availabilityTree);
  assert.match(html, /8:00/); assert.match(html, /1:00/); assert.match(html, /not a confirmed consultation schedule/);
});

test("Student calendar keeps eligible attendance actions without enabling appointment editing or history actions", async () => {
  const { hasConfirmedSchedule } = await import("../../client/src/utils/appointmentSchedule.js");
  const stubs = Object.fromEntries(["CalendarDownload", "StatusBadge", "SupportingDocumentViewer", "OnlineMeetingDetails", "StudentAttendanceResponseForm", "AttendanceResponseSummary", "StudentConsultationRecord", "OutcomeReportSummary", "RequestedAvailability"].map(name => [name, () => null]));
  const extra = { ...stubs, hasConfirmedSchedule, formatPersonName: () => "Faculty", getAppointmentDisplayStatus: appointment => appointment.status, canStudentCancelAppointment: () => true, document: { body: {} } };
  const appointment = { _id: "owned", status: "Confirmed", startAt: "2020-01-01T01:00:00Z", endAt: "2020-01-01T02:00:00Z" };
  const selection = await harness("pages/Student/StudentCalendar.jsx", "StudentCalendarDetails", { StudentAppointmentDetailsModal: () => null });
  const selectionProps = { selection: { id: "owned" }, onClose() {} };
  selection.render(selectionProps); selection.effects[0](); selection.pending[0].resolve({ appointment }); await settle();
  const props = selection.render(selectionProps).props;
  assert.equal(props.readOnly, undefined);
  assert.equal(props.onCancelConsultation, undefined); assert.equal(props.onRespondToProposal, undefined); assert.equal(props.onRespondToFacultyRequest, undefined);
  const h = await harness("components/appointments/StudentAppointmentDetailsModal.jsx", "StudentAppointmentDetailsModal", extra);
  h.render(props); const cleanup = h.effects[0]();
  assert.equal(h.pending[0].path, "/appointments/owned/attendance");
  h.pending[0].resolve({ attendance: { eligible: true } }); await settle();
  const hasForm = currentProps => elements(h.render(currentProps)).some(el => el.type === stubs.StudentAttendanceResponseForm);
  assert.equal(hasForm(props), true);
  assert.equal(hasForm({ ...props, readOnly: true, historyMode: true }), false);
  for (const attendance of [{ eligible: false }, { eligible: true, ownResponse: { outcome: "Completed" } }, null]) {
    h.state[0] = attendance; assert.equal(hasForm(props), false);
  }
  h.state[0] = { eligible: true };
  assert.equal(hasForm({ ...props, appointment: { ...appointment, startAt: "2099-01-01T01:00:00Z", endAt: "2099-01-01T02:00:00Z" } }), false);
  assert.equal(hasForm({ ...props, appointment: { ...appointment, status: "Completed" } }), false);
  const summaryProps = currentProps => elements(h.render(currentProps)).find(el => el.type === stubs.OutcomeReportSummary).props;
  assert.equal(summaryProps(props).viewerRole, "student");
  assert.equal(summaryProps({ ...props, readOnly: true, historyMode: true }).viewerRole, undefined);
  const summary = await harness("components/attendance/OutcomeReportSummary.jsx", "OutcomeReportSummary", { formatManilaDateTime: value => value, ConfirmDialog: () => null });
  const attendance = { status: "Completed", recordedOutcome: { outcome: "Completed", reportedByRole: "faculty" } };
  const canDispute = input => elements(summary.render(input)).some(el => el.props?.children === "Dispute Outcome");
  assert.equal(canDispute({ ...summaryProps(props), attendance }), true);
  assert.equal(canDispute({ ...summaryProps({ ...props, readOnly: true, historyMode: true }), attendance }), false);
  assert.equal(canDispute({ ...summaryProps(props), attendance: { ...attendance, status: "Attendance Review" } }), false);
  assert.equal(canDispute({ ...summaryProps(props), attendance: { ...attendance, recordedOutcome: { ...attendance.recordedOutcome, reportedByRole: "student" } } }), false);
  cleanup();
});

test("calendar layout tracks the rendered upcoming panel through errors and recovery", async () => {
  for (const props of [
    { apiPath: "/faculty/calendar", personalCalendar: true, showUpcoming: true },
    { apiPath: "/faculty/calendar", personalCalendar: true, consultationsPath: "/dean/faculty/consultations", showUpcoming: true },
    { apiPath: "/calendar/student", showUpcoming: false },
  ]) {
    const h = await harness("components/calendar/ConsultationCalendar.jsx", "ConsultationCalendar");
    const calendar = tree => elements(tree).find(el => el.props?.initialView === "dayGridMonth");
    const check = (error) => {
      const tree = h.render(props);
      const layout = elements(tree).find(el => el.type === "div" && el.props.className?.includes("grid min-w-0 gap-4 xl:gap-5"));
      assert.equal(layout.props.className.includes("faculty-calendar-layout"), props.showUpcoming && !error);
      assert.equal(elements(tree).some(el => el.type?.name === "UpcomingPanel"), props.showUpcoming && !error);
      assert.match(calendar(tree).props.headerToolbar.right, /dayGridMonth,timeGridWeek,timeGridDay,listMonth/);
      assert.equal(elements(tree).some(el => el.type?.name === "CalendarError"), error);
      return tree;
    };
    calendar(h.render(props)).props.datesSet({ startStr: "2099-01-01", endStr: "2099-02-01" });
    h.render(props); const initialCleanup = h.effects[0]();
    h.pending[0].resolve({ events: [], upcoming: [] }); await settle();
    calendar(check(false)).props.datesSet({ startStr: "2099-02-01", endStr: "2099-03-01" });
    initialCleanup(); h.render(props); const failedCleanup = h.effects[0]();
    h.pending[1].reject({ status: 422 }); await settle();
    const errorTree = check(true);
    const banner = elements(errorTree).find(el => el.type?.name === "CalendarError");
    assert.equal(banner.props.retryable, true); banner.props.onRetry();
    failedCleanup(); h.render(props); const finalCleanup = h.effects[0]();
    h.pending[2].resolve({ events: [], upcoming: [] }); await settle(); check(false); finalCleanup();
  }
});
