import { sharedClientImports } from "./helpers/clientImports.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  deanWorkspace,
  isDeanManagementPath,
  legacyFacultyDestination,
  monitoringQuery,
} from "../../client/src/utils/deanWorkspace.js";

const source = (path) =>
  readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const requireClient = createRequire(
  new URL("../../client/package.json", import.meta.url),
);
const React = requireClient("react");
const { renderToString } = requireClient("react-dom/server");
const router = requireClient("react-router-dom");
const { transform } = requireClient("esbuild");

// Execute the actual route tree with page stubs and the actual authorization guard.
async function loadComponent(path, imports) {
  const raw = await source(path);
  const body = raw
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, "")
    .replace(/export default function (\w+)/, "function $1");
  const name = /export default function (\w+)/.exec(raw)[1];
  const compiled = await transform(body, { loader: "jsx", jsx: "transform" });
  return new Function(
    "React",
    ...Object.keys({ ...sharedClientImports, ...imports }),
    `${compiled.code}; return ${name};`,
  )(React, ...Object.values({ ...sharedClientImports, ...imports }));
}

test("Dean Import preserves template guidance and includes upload and preview", async () => {
  const CsvImport = await loadComponent("pages/Dean/CsvImport.jsx", {
    Link: router.Link,
    useSearchParams: router.useSearchParams,
    useState: React.useState,
    useEffect: React.useEffect,
    useRef: React.useRef,
    api: () => { throw new Error("Unexpected request during rendering"); },
    CSVUploadPanel: () => React.createElement("input", { type: "file" }),
    CSVValidationPreview: () => null,
    CSVImportResult: () => null,
    ConfirmDialog: () => null,
  });
  const html = renderToString(
    React.createElement(
      router.MemoryRouter,
      null,
      React.createElement(CsvImport),
    ),
  );
  assert.match(
    html,
    /href="\/templates\/socconsult-account-import-template.csv"/,
  );
  assert.match(html, /download="socconsult-account-import-template.csv"/);
  const columns = [
    "institutional_id",
    "first_name",
    "middle_name",
    "last_name",
    "official_email",
    "role",
  ];
  let previous = -1;
  for (const column of columns) {
    const position = html.indexOf(`>${column}</td>`);
    assert.ok(position > previous, column);
    previous = position;
  }
  assert.match(html, /Optional value/);
  assert.match(html, /student or faculty only/);
  assert.match(html, /Dean is not allowed/);
  assert.match(html, /200 accounts/);
  assert.match(html, /type="file"/);
  const page = await source("pages/Dean/CsvImport.jsx");
  assert.match(page, /FormData/);
  assert.match(page, /account-imports\/validate/);
});

test("URL workspace selection survives refresh and validates shared-page context", () => {
  for (const page of [
    "dashboard",
    "requests",
    "availability",
    "consultations",
    "history",
    "reports",
    "calendar",
  ]) {
    assert.equal(deanWorkspace(`/dean/faculty/${page}`), "faculty");
    assert.equal(isDeanManagementPath(`/dean/faculty/${page}`), false);
  }
  assert.equal(isDeanManagementPath("/dean/consultations"), true);
  assert.equal(isDeanManagementPath("/dean/faculty"), false);
  for (const page of ["notifications", "account"]) {
    assert.equal(
      deanWorkspace(`/dean/${page}`, "?workspace=faculty"),
      "faculty",
    );
    assert.equal(
      deanWorkspace(`/dean/${page}`, "?workspace=invalid"),
      "management",
    );
    assert.equal(deanWorkspace(`/dean/${page}`), "management");
  }
  assert.equal(
    deanWorkspace("/dean/reports", "?workspace=faculty"),
    "management",
  );
  assert.equal(
    legacyFacultyDestination(
      "/faculty/appointments",
      "?status=Approved",
      "#record",
    ),
    "/dean/faculty/consultations?status=Approved#record",
  );
  assert.equal(
    legacyFacultyDestination("/faculty/calendar"),
    "/dean/faculty/calendar",
  );
  assert.equal(legacyFacultyDestination("/faculty/account", "?tab=profile&workspace=management", "#details"), "/dean/account?tab=profile&workspace=faculty#details");
  assert.equal(legacyFacultyDestination("/faculty"), "/dean/faculty/dashboard");
  assert.equal(
    legacyFacultyDestination("/faculty/profile", "?x=1", "#profile"),
    "/dean/account?x=1&workspace=faculty#profile",
  );
});

test("actual App routes allow only Dean on both Dean workspaces and preserve Faculty", async () => {
  let auth;
  const ProtectedRoute = await loadComponent("components/ProtectedRoute.jsx", {
    ...router,
    useAuth: () => auth,
  });
  const names = [
    ...(await source("App.jsx")).matchAll(/^import (\w+) from/gm),
  ].map((match) => match[1]);
  const components = Object.fromEntries(
    names.map((name) => [name, () => React.createElement("div", null, name)]),
  );
  components.ProtectedRoute = ProtectedRoute;
  components.DeanLayout = () => React.createElement(router.Outlet);
  components.StudentLayout = () => React.createElement(router.Outlet);
  const icons = Object.fromEntries(
    [
      "Bell",
      "CalendarClock",
      "CalendarDays",
      "ClipboardList",
      "History",
      "LayoutDashboard",
      "UserRound",
      "LockKeyhole",
      "FileBarChart",
    ].map((name) => [name, () => null]),
  );
  components.FacultyLayout = await loadComponent("layouts/FacultyLayout.jsx", {
    ...router,
    ...icons,
    legacyFacultyDestination,
    useAuth: () => auth,
    RoleLayout: () => React.createElement(router.Outlet),
    SOCConsultFacultyAIAssistant: () => null,
  });
  const App = await loadComponent("App.jsx", { ...router, ...components, monitoringQuery });
  const render = (path) =>
    renderToString(
      React.createElement(
        router.MemoryRouter,
        { initialEntries: [path] },
        React.createElement(App),
      ),
    );
  const pages = {
    dashboard: "DeanDashboard",
    import: "CsvImport",
    users: "UserManagement",
    consultations: "ConsultationMonitoring",
    "attendance-review": "AttendanceReview",
    "attendance-review/1234567890abcdef12345678": "AttendanceReview",
    reports: "ReportsAnalytics",
    notifications: "DeanNotifications",
    account: "DeanAccountSettings",
    "faculty/dashboard": "FacultyDashboard",
    "faculty/requests": "AppointmentRequests",
    "faculty/availability": "ManageAvailability",
    "faculty/consultations": "FacultyAppointments",
    "faculty/history": "FacultyHistory",
    "faculty/reports": "DeferredFeaturePage",
  };
  for (const role of ["dean", "faculty", "student"]) {
    auth = { user: { role }, loading: false };
    for (const [page, component] of Object.entries(pages)) {
      const html = render(`/dean/${page}`);
      if (role === "dean") assert.ok(html.includes(component), page);
      else assert.ok(!html.includes(component), `${role}: ${page}`);
    }
    for (const path of ["/admin/dashboard", "/admin/registrations"]) assert.match(render(path), /NotFoundPage/);
    assert.match(render(`/${role}/register`), /NotFoundPage/);
    if (role === "dean") assert.match(render("/dean/registrations"), /NotFoundPage/);
    for (const [page, component] of Object.entries({ dashboard: "FacultyDashboard", requests: "AppointmentRequests", availability: "FacultyAvailabilityCalendar", consultations: "FacultyAppointments", history: "FacultyHistory", reports: "DeferredFeaturePage", notifications: "FacultyNotifications", account: "FacultyAccountSettings", calendar: "FacultyConsultationCalendar" })) {
      assert.equal(render(`/faculty/${page}`).includes(component), role === "faculty", `${role}: ${page}`);
    }
    const html = render("/faculty/dashboard");
    assert.equal(html.includes("FacultyDashboard"), role === "faculty");
  }
  auth = { user: null, loading: true };
  assert.match(render("/dean/faculty/dashboard"), /Loading SOCConsult/);
  auth = { user: null, loading: false };
  assert.ok(!render("/dean/dashboard").includes("DeanDashboard"));
});

test("actual legacy Faculty layout redirects Dean only and preserves URL details", async () => {
  let role = "dean";
  const icons = Object.fromEntries(
    [
      "Bell",
      "CalendarClock",
      "CalendarDays",
      "ClipboardList",
      "History",
      "LayoutDashboard",
      "UserRound",
      "LockKeyhole",
      "FileBarChart",
    ].map((name) => [name, () => null]),
  );
  const FacultyLayout = await loadComponent("layouts/FacultyLayout.jsx", {
    ...icons,
    Navigate: router.Navigate,
    legacyFacultyDestination,
    useAuth: () => ({ user: { role } }),
    useLocation: () => ({
      pathname: "/faculty/appointments",
      search: "?status=Approved",
      hash: "#record",
    }),
    RoleLayout: () => null,
    SOCConsultFacultyAIAssistant: () => null,
  });
  const redirect = FacultyLayout();
  assert.equal(redirect.type, router.Navigate);
  assert.equal(
    redirect.props.to,
    "/dean/faculty/consultations?status=Approved#record",
  );
  assert.equal(redirect.props.replace, true);
  role = "faculty";
  assert.equal(FacultyLayout().type, React.Fragment);
});

test("switcher navigates from URL without changing session or role", async () => {
  let target;
  const Switcher = await loadComponent(
    "components/navigation/WorkspaceSwitcher.jsx",
    {
      deanWorkspace,
      useLocation: () => ({ pathname: "/dean/faculty/requests", search: "" }),
      useNavigate: () => (destination) => {
        target = destination;
      },
    },
  );
  const label = Switcher();
  const select = label.props.children[1];
  assert.equal(label.props.children[0], "Workspace");
  assert.equal(select.props.value, "faculty");
  assert.deepEqual(
    select.props.children.map((option) => option.props.children),
    ["Dean Management", "My Faculty Workspace"],
  );
  select.props.onChange({ target: { value: "management" } });
  assert.equal(target, "/dean/dashboard");
  select.props.onChange({ target: { value: "faculty" } });
  assert.equal(target, "/dean/faculty/dashboard");
  assert.doesNotMatch(
    await source("components/navigation/WorkspaceSwitcher.jsx"),
    /Storage|useAuth|login|token|setUser/,
  );
});

test("deferred pages, component reuse and AI mount architecture", async () => {
  const [deferred, dean, faculty, app] = await Promise.all(
    [
      "pages/Dean/DeferredFeaturePage.jsx",
      "layouts/DeanLayout.jsx",
      "layouts/FacultyLayout.jsx",
      "App.jsx",
    ].map(source),
  );
  assert.doesNotMatch(deferred, /\bapi\b|fetch\(|<form|<button/);
  assert.match(deferred, /scheduled for a later development task/);
  assert.doesNotMatch(dean, /AIAssistant/);
  assert.doesNotMatch(faculty, /AIAssistant/);
  assert.match(app, /<FacultyDashboard\s+routeBase="\/dean\/faculty"/);
  assert.match(app, /<FacultyAppointments \/>/);
  assert.doesNotMatch(app, /initialTab="Pending Registrations"|tab=pending/);
  assert.doesNotMatch(app, /path="registrations"|\/admin\/|FacultyRegister/);
  assert.match(app, /DeanRouteRedirect to="\/dean\/account"/);
});
