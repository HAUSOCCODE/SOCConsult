import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { calendarAliasSuffix, legacyFacultyDestination } from "../../client/src/utils/deanWorkspace.js";
const require = createRequire(
  new URL("../../client/package.json", import.meta.url),
);
const React = require("react");
const { transform } = require("esbuild");
const router = require("react-router-dom");
const source = (path) =>
  readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
async function load(path, imports) {
  const raw = await source(path),
    name = /export default function (\w+)/.exec(raw)[1];
  const body = raw
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, "")
    .replace("export default function", "function");
  const { code } = await transform(body, { loader: "jsx" });
  return new Function(
    "React",
    ...Object.keys(imports),
    `${code}; return ${name}`,
  )(React, ...Object.values(imports));
}
test("Faculty sidebar has separate canonical Availability and Calendar entries", async () => {
  const raw = await source("layouts/FacultyLayout.jsx");
  const icons = Object.fromEntries(
    [...raw.matchAll(/icon: (\w+)/g)].map(([, name]) => [name, () => null]),
  );
  const Component = await load("layouts/FacultyLayout.jsx", {
    ...icons,
    useAuth: () => ({ user: { role: "faculty" } }),
    useLocation: () => ({ pathname: "/faculty/calendar" }),
    RoleLayout: () => null,
  });
  const navigation = React.Children.toArray(Component().props.children).find(child => child.props?.navigation).props.navigation;
  const labels = [
    "Dashboard",
    "Find Student",
    "Availability",
    "Calendar",
    "Consultations / Requests",
    "Consultation History",
    "Reports",
    "Notifications",
    "Account Settings",
  ];
  assert.deepEqual(
    navigation.map((x) => x.label),
    labels,
  );
  assert.deepEqual(
    navigation.map((x) => x.path),
    [
      "dashboard",
      "students",
      "availability",
      "calendar",
      "consultations",
      "history",
      "reports",
      "notifications",
      "account",
    ].map((x) => `/faculty/${x}`),
  );
  assert.equal(navigation[2].activePaths, undefined);
  assert.equal(navigation[3].activePaths, undefined);
  const layout = await source("components/RoleLayout.jsx");
  assert.match(
    layout,
    /aria-current=\{activePaths.includes\(location.pathname\) \? "page"/,
  );
  assert.match(
    layout,
    /isActive \|\| activePaths.includes\(location.pathname\)/,
  );
  assert.match(layout, /activePaths.includes\(location.pathname\)/);
});
test("actual Faculty compatibility redirects preserve query and hash", async () => {
  const raw = await source("App.jsx");
  const names = [...raw.matchAll(/^import (\w+) from/gm)].map((x) => x[1]);
  const imports = Object.fromEntries(names.map((name) => [name, () => null]));
  const App = await load("App.jsx", { ...router, ...imports });
  const children = (node) =>
    !node || typeof node !== "object"
      ? []
      : [
          node,
          ...React.Children.toArray(node.props?.children).flatMap(children),
        ];
  const faculty = children(App()).find(
    (node) =>
      node.props?.path === "faculty" &&
      node.props.element?.type === imports.FacultyLayout,
  );
  for (const [old, canonical] of [
    ["appointments", "consultations"],
    ["profile", "account"],
    ["security", "account"],
  ]) {
    const route = React.Children.toArray(faculty.props.children).find(
      (node) => node.props.path === old,
    );
    const Redirect = await load("App.jsx", {
      ...router,
      ...imports,
      useLocation: () => ({ search: "?status=Confirmed", hash: "#record" }),
    });
    // Redirect component belongs to the loaded App closure; execute it with the location hook stub.
    const faculty2 = children(Redirect()).find(
      (node) =>
        node.props?.path === "faculty" &&
        node.props.element?.type === imports.FacultyLayout,
    );
    const element = React.Children.toArray(faculty2.props.children).find(
      (node) => node.props.path === old,
    ).props.element;
    assert.equal(
      element.type(element.props).props.to,
      `/faculty/${canonical}?status=Confirmed#record`,
    );
    assert.equal(element.type(element.props).props.replace, true);
    assert.ok(route);
  }
  for (const [page, destination] of [
    ["account", "/dean/account?x=1&workspace=faculty#details"],
    ["calendar", "/dean/faculty/calendar?x=1#details"],
    ["consultations", "/dean/faculty/consultations?x=1#details"],
  ]) {
    assert.equal(
      legacyFacultyDestination(`/faculty/${page}`, "?x=1", "#details"),
      destination,
    );
  }
});
test("canonical titles, reused account components and calendar links remain available", async () => {
  const titles = {};
  const oldDocument = globalThis.document;
  globalThis.document = {};
  try {
    for (const [page, title] of Object.entries({
      dashboard: "Faculty Dashboard",
      requests: "Consultations / Requests",
      availability: "Availability",
      consultations: "Consultations / Requests",
      history: "Consultation History",
      reports: "Reports",
      notifications: "Notifications",
      account: "Account Settings",
      calendar: "Consultation Calendar",
    })) {
      const Title = await load("components/RouteDocumentTitle.jsx", {
        useLocation: () => ({ pathname: `/faculty/${page}` }),
        useEffect: (fn) => fn(),
      });
      Title();
      titles[page] = document.title;
      assert.equal(titles[page], `${title} | SOCConsult`);
    }
  } finally {
    globalThis.document = oldDocument;
  }
  const account = await source("pages/Faculty/FacultyAccountSettings.jsx");
  assert.match(account, /ProfilePictureEditor/);
  assert.match(account, /SecuritySettings/);
  assert.match(account, /Institutional Faculty ID/);
  assert.match(account, /Official Email Address/);
  assert.match(account, /role="tablist"/);
  const Profile = () => null;
  const Availability = await load("pages/Faculty/FacultyAvailabilityCalendar.jsx", {
    ManageAvailability: Profile,
  });
  const integrated = React.Children.toArray(Availability({}).props.children);
  assert.equal(integrated[0].type, "header");
  assert.equal(integrated[1].props.showCalendarLink, true);
  const Calendar = await load("pages/Faculty/FacultyConsultationCalendar.jsx", {
    Link: router.Link, ConsultationCalendar: Profile, FacultyConsultationsView: Profile,
    AvailabilityCalendarDetails: Profile, useState: initial => [initial, () => {}],
    useCallback: fn => fn, useRef: () => ({ current: null }),
  });
  const facultyCalendar = React.Children.toArray(Calendar({}).props.children);
  assert.equal(facultyCalendar[0].props.title, "Calendar");
  assert.equal(facultyCalendar[0].props.personalCalendar, true);
  assert.equal(facultyCalendar[0].props.includeAvailability, true);
  assert.equal(facultyCalendar[1].props.children[1].props.to, "/faculty/availability");
  const deanCalendar = React.Children.toArray(Calendar({ consultationsPath: "/dean/faculty/consultations" }).props.children);
  assert.equal(deanCalendar[1].props.children[1].props.to, "/dean/faculty/availability");
  assert.equal(calendarAliasSuffix("?date=2026-02-30&view=week&view=month&includeInactive=maybe", "#//evil"), "");
  const app = await source("App.jsx");
  assert.ok(app.includes('FacultyAvailabilityCalendar routeBase="/dean/faculty"'));

});
