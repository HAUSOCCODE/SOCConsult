import { sharedClientImports } from "./helpers/clientImports.js";
﻿import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { deanUiError } from "../../client/src/utils/deanUiErrors.js";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react"), { transform } = require("esbuild");
const source = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type) => nodes(tree).filter(n => n.type === type);
const text = tree => JSON.stringify(tree);
function focusPanel(items, extra = {}) {
  for (const element of items) Object.assign(element, { tabIndex: 0, isConnected: true, closest: () => null, getClientRects: () => [1] });
  return { querySelector: () => items[0], querySelectorAll: () => items, contains: target => items.includes(target), ...extra };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function harness(path, name, extra = {}) {
  let index = 0, effectIndex = 0;
  const state = [], effects = [], previous = [], requests = [], toasts = [];
  const context = { pagination: { total: 0, totalPages: 0 }, category: "", actionBusy: false, setPagination(value) { this.pagination = value; }, setCategory() {}, setActionBusy(value) { context.actionBusy = value; } };
  const imports = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === "function" ? initial() : initial; return [state[slot], value => state[slot] = typeof value === "function" ? value(state[slot]) : value]; },
    useRef(initial) { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect(fn, deps) { effects[effectIndex++] = { fn, deps }; },
    useContext: () => context, createContext: () => ({}),
    useSearchParams: () => [new URLSearchParams(), () => {}],
    deanUiError, createPortal: child => child,
    api: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
    useToast: () => ({ success: message => toasts.push(message), error: message => toasts.push(message) }),
    useAuth: () => ({ user: { role: "dean" }, updateUser: value => toasts.push(value) }),
    useId: () => "test-id", useCallback: fn => fn,
    Link: () => null, CSVUploadPanel: () => null, CSVValidationPreview: () => null, CSVImportResult: () => null, ConfirmDialog: () => null,
    EmptyState: () => null, ErrorState: () => null, Loading: () => null, StatusBadge: () => null, Pagination: () => null,
    ManagementAuditFeed: () => null, ReportNarrativePanel: () => null, ProfilePictureEditor: () => null,
    ProfileImagePreview: () => null, formatPersonName: () => "Test User", formatPersonNameInNotification: value => value,
    ...extra,
  };
  const hookCode = (await source("hooks/useDialogFocus.js")).replace(/^import.*$/gm, "").replace("export default function", "function").replace("export function", "function");
  imports.useDialogFocus = new Function("useEffect", "useRef", hookCode + "; return useDialogFocus;")(imports.useEffect, imports.useRef);
  const raw = await source(path);
  const icons = /import \{([^}]+)\} from "lucide-react"/s.exec(raw);
  if (icons) for (const name of icons[1].split(",").map(value => value.trim()).filter(Boolean)) imports[name] ??= () => null;
  const body = raw.replaceAll("import.meta.env.VITE_API_URL", "undefined").replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, "").replaceAll("export default function", "function").replaceAll("export function", "function").replaceAll("export const", "const");
  const compiled = await transform(body, { loader: "jsx" });
  for (const key of Object.keys({ ...sharedClientImports, ...imports })) { if (new RegExp(`(?:function|const) ${key}\\b`).test(body)) delete imports[key]; }
  const Component = new Function("React", ...Object.keys({ ...sharedClientImports, ...imports }), `${compiled.code}; return ${name};`)(React, ...Object.values({ ...sharedClientImports, ...imports }));
  return { state, requests, context, toasts, imports, raw,
    render(props = {}) { index = 0; effectIndex = 0; return Component(props); },
    effects() { effects.forEach((effect, i) => { if (!previous[i] || effect.deps?.some((dep, j) => !Object.is(dep, previous[i].deps[j]))) { previous[i]?.cleanup?.(); previous[i] = { deps: effect.deps, cleanup: effect.fn() }; } }); },
    unmount() { previous.forEach(effect => effect.cleanup?.()); },
  };
}

test("Dean Faculty consultation workspace loads the personal API and renders its assigned consultation", async () => {
  const statuses = await import("../../client/src/utils/appointmentStatus.js");
  const h = await harness("components/appointments/AppointmentsView.jsx", "AppointmentsPage", {
    ...statuses, setInterval: () => 1, clearInterval: () => {},
    AppointmentRequestDetailsModal: () => null, StudentAppointmentDetailsModal: () => null,
    FacultyAppointmentDetailsModal: () => null, FacultyRescheduleModal: () => null,
    formatPersonName: person => person?.name || "Unavailable",
  });
  try {
    h.render(); h.effects();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].path, "/appointments/mine");
    h.requests[0].resolve({ appointments: [{
      _id: "personal-consultation", subject: "Assigned Dean consultation", status: "Confirmed",
      student: { name: "Assigned Student" }, faculty: { name: "Dean" }, consultationMode: "Online",
      startAt: "2099-02-01T02:00:00Z", endAt: "2099-02-01T02:30:00Z", createdAt: "2026-10-01T00:00:00Z",
    }], availabilityCapacity: [] });
    await settle();
    const rendered = text(h.render());
    assert.match(rendered, /Assigned Dean consultation/);
    assert.match(rendered, /Assigned Student/);
    assert.equal(h.requests.length, 1);
  } finally { h.unmount(); }
});

test("Dean document preview chooses personal or management authorization from the active workspace", async () => {
  const { isDeanManagementPath } = await import("../../client/src/utils/deanWorkspace.js");
  for (const pathname of ["/dean/consultations", "/dean/faculty/consultations"]) {
    for (const legacy of [false, true]) {
      const h = await harness("components/appointments/SupportingDocumentViewer.jsx", "SupportingDocumentViewer", {
        isDeanManagementPath, useLocation: () => ({ pathname }), useMemo: fn => fn(),
      });
      try {
        const appointment = { _id: "consultation", ...(legacy
          ? { supportingDocument: { name: "Evidence.txt", mimeType: "text/plain" } }
          : { supportingDocuments: [{ _id: "document", originalName: "Evidence.txt", mimeType: "text/plain" }] }) };
        const tree = h.render({ appointment });
        const pending = find(tree, "button")[0].props.onClick();
        const prefix = isDeanManagementPath(pathname) ? "/dean" : "";
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].path, `${prefix}/appointments/consultation/${legacy ? "document" : "documents/document"}`);
        h.requests[0].resolve({ supportingDocument: { name: "Evidence.txt", data: "data:text/plain;base64,b2s=" } });
        await pending;
      } finally { h.unmount(); }
    }
  }
});

test("contextual messages never expose server, provider, HTML, exception or prototype text", () => {
  for (const context of ["csv", "import", "profile", "password", "avatar", "ai", "pdf", "audit", "document", "resolution", "create", "account"]) {
    for (const code of [undefined, "UNKNOWN", "__proto__", "constructor"]) {
      const message = deanUiError({ code, message: "<html>SECRET database stack provider</html>" }, context);
      assert.doesNotMatch(message, /SECRET|html|database|stack|provider/);
    }
  }
  assert.match(deanUiError({ code: "PASSWORD_CHANGE_UNCERTAIN" }, "password"), /sign in before/);
  assert.match(deanUiError({ code: "SERVICE_UNAVAILABLE" }, "import"), /Refresh.*status/);
  assert.match(deanUiError({ status: 409 }, "ai"), /Refresh/);
  assert.match(deanUiError({ status: 403 }, "document"), /access/);
  assert.match(deanUiError({ status: 404 }, "document"), /no longer available/);
});

test("shared loading, error retry and empty states have accessible semantics for all roles", async () => {
  for (const name of ["Loading", "ErrorState", "EmptyState"]) {
    const h = await harness("components/UI.jsx", name, { isLegacyAppointmentStatus: () => false });
    let retried = 0; const tree = h.render({ message: "Safe error", onRetry: () => retried++ });
    assert.equal(tree.props.role, name === "ErrorState" ? "alert" : "status");
    if (name === "ErrorState") { find(tree, "button")[0].props.onClick(); assert.equal(retried, 1); }
  }
});

test("CSV no-file, invalid, empty, oversized, validation progress and same-tick submission guard", async () => {
  const h = await harness("pages/Dean/CsvImport.jsx", "CsvImport");
  assert.match(text(h.render()), /No CSV file selected/);
  for (const [file, expected] of [[{ name: "x.exe", size: 10 }, /supported CSV/], [{ name: "x.csv", size: 0 }, /empty/], [{ name: "x.csv", size: 1048577 }, /1 MiB/]]) {
    h.state[0] = file; const tree = h.render(); const upload = nodes(tree).find(n => n.type === h.imports.CSVUploadPanel);
    await upload.props.onSubmit({ preventDefault() {} }); assert.match(text(h.render()), expected); assert.equal(h.requests.length, 0);
  }
  h.state[0] = new File(["rows"], "accounts.csv", { type: "text/csv" });
  const upload = nodes(h.render()).find(n => n.type === h.imports.CSVUploadPanel);
  const first = upload.props.onSubmit({ preventDefault() {} }); await upload.props.onSubmit({ preventDefault() {} });
  assert.equal(h.requests.length, 1); assert.match(text(h.render()), /validating CSV/);
  h.requests[0].reject(new Error("SECRET stack")); await first;
  assert.match(text(h.render()), /Unable to validate/); assert.doesNotMatch(text(h.render()), /SECRET/);
  const next = nodes(h.render()).find(n => n.type === h.imports.CSVUploadPanel).props.onSubmit({ preventDefault() {} });
  h.render(); h.effects(); h.unmount(); h.requests[1].resolve({ previewId: "stale" }); await next;
  assert.equal(h.state[1], null);
});

test("AI conflict requires a read-only refresh and unmounted generation cannot replace state", async () => {
  const h = await harness("components/dean/ReportNarrativePanel.jsx", "ReportNarrativePanel");
  const props = { filters: { start: "2026-10-01", end: "2026-10-18" } };
  const summary = { id: "id", version: 1, filters: props.filters, reviewState: "unreviewed", narrative: "Safe aggregate narrative" };
  let tree = h.render(props); h.effects(); let pending = find(tree, "button")[0].props.onClick();
  h.requests[0].resolve(summary); await pending; tree = h.render(props);
  assert.match(text(tree), /ready for review/);
  pending = find(tree, "button")[1].props.onClick(); h.requests[1].reject({ status: 409, message: "SECRET" }); await pending;
  tree = h.render(props); assert.doesNotMatch(text(tree), /SECRET/);
  assert.equal(find(tree, "button").at(-1).props.disabled, true);
  pending = find(tree, "button").find(n => n.props.children === "Refresh narrative status").props.onClick();
  assert.equal(h.requests[2].options, undefined); h.requests[2].resolve({ ...summary, reviewState: "reviewed" }); await pending;
  assert.match(text(h.render(props)), /Review completed/);
  pending = find(h.render(props), "button")[0].props.onClick(); h.unmount(); h.requests[3].resolve({ ...summary, id: "stale" }); await pending;
  assert.equal(h.state[0].id, "id");
});

test("shared notification mutations guard synchronous duplicates for Dean, Student and Faculty", async () => {
  const oldWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {}, setInterval() { return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} };
  try {
    for (const role of ["dean", "student", "faculty"]) {
      const h = await harness("components/notifications/NotificationsView.jsx", "NotificationsPageContent");

      const props = { compact: true, [role]: true }; let tree = h.render(props);
      const content = nodes(tree).find(n => n.props?.readAll);
      const pending = content.props.readAll(); await content.props.readAll(); assert.equal(h.requests.length, 1);
      assert.equal(h.context.actionBusy, true); assert.match(text(h.render(props)), /Updating notifications/);
      h.requests[0].reject(new Error("SECRET")); await pending; assert.equal(h.context.actionBusy, false); assert.doesNotMatch(h.toasts.join(), /SECRET/);
    }
  } finally { globalThis.window = oldWindow; }
});

test("notification action controls and rows stay disabled during shared mutations for each role", async () => {
  for (const name of ["DeanNotificationActions", "StudentNotificationActions", "NotificationActions", "FacultyNotificationCard", "DeanNotificationRow"]) {
    const icons = Object.fromEntries(["Mail", "CheckCircle2", "MailOpen", "Trash2", "Eye", "UserRound", "ChevronRight", "ChevronUp", "Bell", "CalendarDays"].map(key => [key, () => null]));
    const h = await harness("components/notifications/NotificationsView.jsx", name, icons); h.context.actionBusy = true;
    const tree = h.render({ notifications: [{ isRead: true }], unreadCount: 1, notification: { _id: "id", title: "Notice", type: "account", isRead: false }, expanded: true, isExpanded: true, date: () => "today", typeLabel: () => "Account" });
    const actions = find(tree, "button").filter(n => /Mark|Clear|Delete/.test(text(n.props.children)));
    assert.ok(actions.length); for (const button of actions) assert.equal(button.props.disabled, true);
  }
});

test("notification detail dialog traps Tab, handles Escape and restores the keyboard trigger", async () => {
  const h = await harness("components/notifications/NotificationsView.jsx", "NotificationDetailsModal");
  let focused = "trigger", close = 0; const listeners = new Map();
  const trigger = { focus() { focused = "trigger"; } }, first = { focus() { focused = "first"; } }, last = { focus() { focused = "last"; } };
  const oldDocument = globalThis.document;
  globalThis.document = { activeElement: trigger, body: { style: { overflow: "auto" } }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  try {
    h.render({ notification: { title: "Notice" }, date: () => "Today", typeLabel: () => "Account", onClose: () => close++ });
    trigger.isConnected = true; h.state[0].current = focusPanel([first, last]); h.effects(); assert.equal(focused, "first");
    document.activeElement = last; listeners.get("keydown")({ key: "Tab", preventDefault() {} }); assert.equal(focused, "first");
    document.activeElement = first; listeners.get("keydown")({ key: "Tab", shiftKey: true, preventDefault() {} }); assert.equal(focused, "last");
    listeners.get("keydown")({ key: "Escape", preventDefault() {}, stopImmediatePropagation() {} }); assert.equal(close, 1);
    h.unmount(); await settle(); assert.equal(focused, "trigger"); assert.equal(document.body.style.overflow, "auto");
  } finally { globalThis.document = oldDocument; }
});

test("shared password form guards repeats, announces progress and hides provider errors for all roles", async () => {
  for (const role of ["dean", "student", "faculty"]) {
    let recommendationCleared = 0;
    const h = await harness("components/profile/ProfileForm.jsx", "SecuritySettings", { useAuth: () => ({ user: { role }, clearPasswordRecommendation: () => recommendationCleared++ }), FACULTY_POSITIONS: [], OTHER_POSITION: "Other" });
    let tree = h.render(); const fields = find(tree, "input");
    for (const [i, value] of ["OldPassword1", "NewPassword2", "NewPassword2"].entries()) fields[i].props.onChange({ target: { value } });
    tree = h.render(); const pending = find(tree, "form")[0].props.onSubmit({ preventDefault() {} }); await find(tree, "form")[0].props.onSubmit({ preventDefault() {} });
    assert.equal(h.requests.length, 1); assert.match(text(h.render()), /Changing password/);
    h.requests[0].reject({ code: "PASSWORD_CHANGE_UNCERTAIN", message: "SECRET provider" }); await pending;
    assert.match(h.toasts.join(), /sign in before/); assert.doesNotMatch(h.toasts.join(), /SECRET|provider/);
    assert.equal(recommendationCleared, 0);
    const success = find(h.render(), "form")[0].props.onSubmit({ preventDefault() {} });
    h.requests[1].resolve({}); await success;
    assert.equal(recommendationCleared, role === "faculty" ? 1 : 0);
  }
});

test("avatar validation, progress, duplicate guard and safe failures preserve Student and Faculty behavior", async () => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  globalThis.document = { body: {} }; globalThis.window = { document };
  try {
    for (const role of ["dean", "student", "faculty"]) {
      const h = await harness("components/profile/ProfilePictureEditor.jsx", "ProfilePictureEditor", { useAuth: () => ({ user: { role }, updateUser() {} }) });
      let tree = h.render(); const input = find(tree, "input")[0];
      input.props.onChange({ target: { files: [new File(["x"], "bad.exe", { type: "application/octet-stream" })] } });
      assert.match(h.toasts.join(), /valid image/); assert.equal(h.requests.length, 0);
      input.props.onChange({ target: { files: [new File(["image"], "valid.png", { type: "image/png" })] } });
      tree = h.render(); const save = find(tree, "button").find(n => n.props.children === "Save Photo");
      const pending = save.props.onClick(); await save.props.onClick(); assert.equal(h.requests.length, 1);
      tree = h.render(); assert.ok(nodes(tree).some(n => n.props?.role === "status"));
      h.requests[0].reject(new Error("SECRET storage URL")); await pending; assert.doesNotMatch(h.toasts.join(), /SECRET|storage URL/);
      h.unmount();
    }
  } finally { globalThis.document = oldDocument; globalThis.window = oldWindow; }
});

test("audit list has safe retry, empty/search states, and does not accept responses after cleanup", async () => {
  const h = await harness("pages/Dean/AuditLogs.jsx", "AuditLogs");
  const oldWindow = globalThis.window; globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
  try {
    h.render(); h.effects(); assert.equal(h.requests.length, 1);
    h.requests[0].reject(new Error("SECRET SQL stack")); await settle();
    let tree = h.render(); assert.match(text(tree), /Unable to load audit/); assert.doesNotMatch(text(tree), /SECRET/);
    const retry = nodes(tree).find(n => n.type?.name === "InlineError"); const pending = retry.props.retry();
    h.requests[1].resolve({ users: [], counts: {}, pagination: { total: 0 } }); await pending;
    assert.match(text(h.render()), /No registered students yet/);
    const search = find(h.render(), "input").find(n => n.props.type === "search"); search.props.onChange({ target: { value: "Nobody" } });
    h.state[2] = "Nobody"; h.render(); h.effects(); h.requests.at(-1).resolve({ users: [], counts: {}, pagination: { total: 0 } }); await settle();
    assert.match(text(h.render()), /match this search/);
    h.render(); h.effects(); const last = h.requests.at(-1); h.unmount(); last.resolve({ users: [{ id: "stale" }] }); await settle(); assert.equal(h.state[4].users.length, 0);
  } finally { globalThis.window = oldWindow; }
});

test("document access and transport failures are safe and old record responses are discarded", async () => {
  for (const status of [403, 404, 500]) {
    const h = await harness("components/dean/ConsultationDocumentViewer.jsx", "ConsultationDocumentViewer", { fetch: async () => ({ ok: false, status }), sessionStorage: { getItem: () => "isolated" } });
    let tree = h.render({ recordId: "record", documents: [{ name: "Evidence", documentId: "doc" }] }); h.effects();
    await find(tree, "button")[0].props.onClick(); tree = h.render({ recordId: "record", documents: [] });
    assert.ok(nodes(tree).some(n => n.props?.role === "alert")); assert.doesNotMatch(text(tree), /https?:|storage|SECRET/);
  }
  let release;
  const h = await harness("components/dean/ConsultationDocumentViewer.jsx", "ConsultationDocumentViewer", { fetch: () => new Promise(resolve => release = resolve), sessionStorage: { getItem: () => "isolated" } });
  let tree = h.render({ recordId: "old", documents: [{ name: "Evidence" }] }); h.effects();
  const pending = find(tree, "button")[0].props.onClick(); h.render({ recordId: "new", documents: [] }); h.effects();
  release({ ok: true, blob: async () => new Blob(["SECRET"], { type: "text/plain" }) }); await pending;
  assert.deepEqual(h.state[0], {}); h.unmount();
});

test("confirmation focus remains inside the busy dialog and returns only when closed", async () => {
  const h = await harness("components/ConfirmDialog.jsx", "ConfirmDialog");
  let focus = "trigger", cancelled = 0; const listeners = new Map();
  const trigger = { focus() { focus = "trigger"; } }, control = { focus() { focus = "control"; } };
  const dialog = focusPanel([], { querySelector: () => control, focus() { focus = "dialog"; } }); trigger.isConnected = true;
  const oldDocument = globalThis.document;
  globalThis.document = { activeElement: trigger, body: { style: { overflow: "auto" } }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  try {
    const props = { open: true, title: "Confirm", onCancel: () => cancelled++ };
    h.render(props); h.state[0].current = dialog; h.effects(); assert.equal(focus, "control");
    h.render({ ...props, loading: true }); h.effects(); assert.equal(focus, "dialog");
    listeners.get("keydown")({ key: "Tab", preventDefault() {} }); assert.equal(focus, "dialog");
    listeners.get("keydown")({ key: "Escape", preventDefault() {}, stopImmediatePropagation() {} }); assert.equal(cancelled, 0);
    h.unmount(); await settle(); assert.equal(focus, "trigger");
  } finally { globalThis.document = oldDocument; }
});

test("profile image preview traps keyboard focus and restores its trigger for shared account pages", async () => {
  const h = await harness("components/profile/ProfileImagePreview.jsx", "ProfileImagePreview", { UserAvatar: () => null });
  let focus = "trigger"; const listeners = new Map(), trigger = { focus() { focus = "trigger"; } }, close = { focus() { focus = "close"; } };
  const oldDocument = globalThis.document;
  globalThis.document = { activeElement: trigger, body: { style: {} }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  try {
    const props = { user: { profilePicture: "blob:authorized-preview" } };
    find(h.render(props), "button")[0].props.onClick({ stopPropagation() {} }); h.render(props);
    trigger.isConnected = true; h.state[1].current = focusPanel([close]); h.effects(); assert.equal(focus, "close");
    listeners.get("keydown")({ key: "Tab", preventDefault() {} }); assert.equal(focus, "close");
    listeners.get("keydown")({ key: "Escape", preventDefault() {}, stopImmediatePropagation() {} }); h.render(props); h.effects(); await settle(); assert.equal(focus, "trigger");
  } finally { globalThis.document = oldDocument; }
});

test("CSV preview readiness, invalid rows, processing and terminal states use local status text", async () => {
  const h = await harness("components/accounts/CSVValidationPreview.jsx", "CSVValidationPreview", { CSVErrorTable: () => null });
  for (const [status, invalidRows, ready] of [["validated", 0, true], ["validated", 1, false], ["processing", 0, false]]) {
    const tree = h.render({ preview: { status, canConfirm: true, expiresAt: new Date(Date.now() + 60000).toISOString(), summary: { invalidRows }, rows: [] }, onConfirm() {} });
    assert.equal(find(tree, "button")[0].props.disabled, !ready); assert.ok(nodes(tree).some(n => n.props?.role === "status"));
  }
  const result = await harness("components/accounts/CSVImportResult.jsx", "CSVImportResult");
  for (const status of ["completed", "failed"]) {
    const tree = result.render({ result: { status, message: "SECRET exception", importedAt: null } });
    assert.doesNotMatch(text(tree), /SECRET/); assert.match(text(tree), status === "completed" ? /Accounts created successfully/ : /No accounts were created/);
  }
});

test("CSV missing preview supports GET retry, while an uncertain confirmation cannot be blindly resubmitted", async () => {
  const params = new URLSearchParams("preview=id");
  const h = await harness("pages/Dean/CsvImport.jsx", "CsvImport", { useSearchParams: () => [params, () => {}] });
  h.render(); h.effects(); h.requests[0].reject({ status: 404, message: "SECRET" }); await settle();
  let tree = h.render(); assert.match(text(tree), /missing or expired/); assert.doesNotMatch(text(tree), /SECRET/);
  find(tree, "button").find(n => n.props.children === "Refresh import status").props.onClick(); h.render(); h.effects();
  assert.equal(h.requests[1].options.signal instanceof AbortSignal, true);
  const preview = { previewId: "id", status: "validated", canConfirm: true, summary: { invalidRows: 0, totalRows: 1 }, expiresAt: new Date(Date.now() + 60000).toISOString(), rows: [{ role: "student" }] };
  h.requests[1].resolve(preview); await settle(); tree = h.render();
  const confirm = nodes(tree).find(n => n.type === h.imports.ConfirmDialog).props.onConfirm;
  const pending = confirm(); h.requests[2].reject(new Error("SECRET transaction")); await settle();
  assert.equal(h.requests[3].options, undefined); h.requests[3].resolve(preview); await pending;
  tree = h.render(); assert.match(text(tree), /Refresh to check its status/);
  await nodes(tree).find(n => n.type === h.imports.ConfirmDialog).props.onConfirm(); assert.equal(h.requests.length, 4);
  h.unmount();
});

test("Dean notifications distinguish initial loading, true empty and filtered empty results", async () => {
  const h = await harness("components/notifications/NotificationsView.jsx", "DeanNotificationsContent");
  const props = { notifications: [], pageNotifications: [], shown: [], safePage: 1, filter: "All", date: () => "today", typeLabel: () => "Account" };
  assert.match(text(h.render({ ...props, loading: true })), /Loading notifications/);
  assert.match(text(h.render(props)), /No notifications yet/);
  assert.match(text(h.render({ ...props, filter: "Unread" })), /No notifications match these filters/);
  h.context.category = "Management"; assert.match(text(h.render(props)), /No notifications match these filters/);
});
