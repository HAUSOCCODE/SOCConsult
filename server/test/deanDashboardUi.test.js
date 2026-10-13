import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const requireClient = createRequire(
  new URL("../../client/package.json", import.meta.url),
);
const React = requireClient("react");
const { renderToStaticMarkup } = requireClient("react-dom/server");
const { transform } = requireClient("esbuild");
async function harness() {
  const raw = await readFile(
    new URL("../../client/src/pages/Dean/DeanDashboard.jsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    raw,
    /AIAssistant|ai-summary|ai\/|pendingRegistrations|registration-summary|setInterval/,
  );
  const compiled = await transform(
    raw
      .replace(/^import.*$/gm, "")
      .replace("export default function", "function"),
    { loader: "jsx" },
  );
  const state = [],
    pending = [],
    effects = [];
  let slot = 0;
  const imports = {
    useState: (initial) => {
      const index = slot++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (value) => {
          state[index] =
            typeof value === "function" ? value(state[index]) : value;
        },
      ];
    },
    useEffect: (fn) => effects.push(fn),
    Link: ({ to, children, ...props }) =>
      React.createElement("a", { ...props, href: to }, children),
    Loading: () => React.createElement("p", null, "Loading dashboard"),
    ErrorState: ({ message, onRetry }) =>
      React.createElement("button", { onClick: onRetry }, message),
    api: (path, options) =>
      new Promise((resolve, reject) =>
        pending.push({ path, options, resolve, reject }),
      ),
  };
  const Component = new Function(
    "React",
    ...Object.keys(imports),
    `${compiled.code}; return DeanDashboard;`,
  )(React, ...Object.values(imports));
  return {
    state,
    pending,
    effects,
    render: () => {
      slot = 0;
      effects.length = 0;
      return Component();
    },
    html: (tree) => renderToStaticMarkup(tree),
  };
}
const data = {
  range: { start: "2026-10-01", end: "2026-10-31" },
  accounts: {
    activeStudents: 3,
    activeFaculty: 2,
    asOf: "2026-10-14T00:00:00Z",
  },
  consultations: { total: 0, byStatus: { pending: 0, completed: 0 } },
  recentImports: [],
  recentConsultations: [],
  limits: { recentImports: 5, recentConsultations: 5 },
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
test("dashboard loading, empty totals, safe routes and range rendering", async () => {
  const h = await harness();
  assert.match(h.html(h.render()), /Loading dashboard/);
  h.effects[0]();
  h.pending[0].resolve(data);
  await settle();
  const html = h.html(h.render());
  for (const text of [
    "Active Student accounts",
    "Active Faculty accounts",
    "Appointments requested during this period",
    "No appointments were requested",
    "No completed imports",
    "No consultation activity",
    "2026-10-01",
    "Asia/Manila",
    "Statistics reflect the consultation statuses currently recorded by SOCConsult.",
  ])
    assert.ok(html.includes(text));
  for (const path of [
    "users",
    "consultations",
    "attendance-review",
    "reports",
    "import",
  ])
    assert.ok(html.includes(`/dean/${path}`));
  assert.doesNotMatch(
    html,
    /Confirmed|Awaiting Attendance Update|Expired|Pending Registration/,
  );
  assert.deepEqual(h.state[1], {
    start: data.range.start,
    end: data.range.end,
  });
});
test("recent consultation activity hides raw references while preserving safe details", async () => {
  const h = await harness();
  h.render();
  h.effects[0]();
  h.pending[0].resolve({
    ...data,
    recentConsultations: [
      {
        reference: "507f1f77bcf86cd799439011",
        subject: "Software Engineering",
        status: "Pending",
        studentName: "Student Example",
        facultyName: "Faculty Example",
        scheduledAt: null,
        updatedAt: "2026-10-14T00:00:00Z",
      },
    ],
  });
  await settle();
  const html = h.html(h.render());
  assert.doesNotMatch(
    html,
    /507f1f77bcf86cd799439011|Reference:|Additional consultation categories|revised appointment workflow/,
  );
  for (const text of [
    "Software Engineering",
    "Pending",
    "Student Example",
    "Faculty Example",
    "Not yet scheduled",
  ])
    assert.ok(html.includes(text));
});
test("errors offer retry and newer ranges cannot be replaced by stale requests", async () => {
  const h = await harness();
  h.render();
  const cleanup = h.effects[0]();
  h.pending[0].reject(new Error("PRIVATE"));
  await settle();
  let tree = h.render();
  assert.match(h.html(tree), /Unable to load/);
  assert.doesNotMatch(h.html(tree), /PRIVATE/);
  const retry = elements(tree).find((element) => element.props?.onRetry);
  retry.props.onRetry();
  assert.equal(h.state[5], 1);
  h.render();
  const cleanupRetry = h.effects[0]();
  h.pending[1].resolve(data);
  await settle();
  tree = h.render();
  h.state[1] = { start: "2026-09-01", end: "2026-09-30" };
  tree = h.render();
  elements(tree)
    .find((element) => element.type === "form")
    .props.onSubmit({ preventDefault() {} });
  cleanupRetry();
  h.render();
  const cleanupOldRange = h.effects[0]();
  assert.match(h.pending[2].path, /start=2026-09-01/);
  h.state[1] = { start: "2026-08-01", end: "2026-08-31" };
  tree = h.render();
  elements(tree)
    .find((element) => element.type === "form")
    .props.onSubmit({ preventDefault() {} });
  cleanupOldRange();
  assert.equal(h.pending[2].options.signal.aborted, true);
  h.render();
  h.effects[0]();
  const newest = { ...data, range: h.state[0] };
  h.pending[3].resolve(newest);
  await settle();
  h.pending[2].resolve(data);
  await settle();
  assert.equal(h.state[2], newest);
  assert.equal(h.state[4], false);
  cleanup();
});
