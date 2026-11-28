// Run with node server/test/pei01PortalStatus.browser.mjs. Set CHROME_PATH if needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "../../client/node_modules/vite/dist/node/index.js";

const requests = [];
const records = ["student", "faculty"].map((role, index) => ({
  _id: String(index + 1).repeat(24),
  initiatedByRole: role,
  status: "Expired",
  subject: `Request from ${role}`,
  startAt: "2026-10-01T01:00:00Z",
  endAt: "2026-10-01T01:30:00Z",
  faculty: { name: "Faculty Fixture" },
  student: { name: "Student Fixture" },
  expirationReason: "faculty_response_deadline_passed",
  statusHistory: [{ previousStatus: "Pending", newStatus: "Expired", changedAt: "2026-10-01T01:01:00Z", changedByRole: "system" }],
}));
const user = role => ({ id: role, name: `${role} Fixture`, role });
const semesterSlots = [
  { _id: "eligible", startAt: "2089-12-31T16:15:00Z", endAt: "2089-12-31T17:00:00Z" },
  { _id: "changed", startAt: "2090-01-01T02:00:00Z", endAt: "2090-01-01T03:00:00Z" },
  { _id: "reserved", startAt: "2090-01-01T03:00:00Z", endAt: "2090-01-01T04:00:00Z", protected: true },
  { _id: "past", startAt: "2000-01-01T02:00:00Z", endAt: "2000-01-01T03:00:00Z", status: "expired" },
].map(slot => ({ mode: "Face-to-Face", location: "Fixture room", isActive: true, status: "active", __v: 0, ...slot }));
let vite, chrome, profile, socket, origin;

function fixtureApi(req, res, next) {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/pei01-api/")) return next();
  const path = url.pathname.slice("/pei01-api".length);
  requests.push({ path, status: url.searchParams.get("status"), method: req.method });
  let data = {};
  const login = /^\/auth\/login\/(student|faculty|dean)$/.exec(path);
  if (login) {
    req.resume();
    const [, role] = login;
    data = { user: user(role), token: role };
  } else if (path === "/auth/me") {
    data = { user: user(req.headers.authorization?.slice("Bearer ".length)) };
  } else if (path === "/appointments/student-history" || path === "/appointments/faculty-history") {
    const consultations = records.filter(record => !url.searchParams.has("status") || record.status === url.searchParams.get("status"));
    data = { consultations, pagination: { page: 1, pageSize: 10, totalPages: 1, total: consultations.length } };
  } else if (path.startsWith("/appointments/consultations/")) {
    data = { appointment: records.find(record => path.endsWith(record._id)) };
  } else if (path === "/availability/mine") {
    data = { availability: semesterSlots };
  } else if (path === "/availability/eligible" && req.method === "PUT") {
    req.resume();
    Object.assign(semesterSlots[0], { isActive: false, status: "inactive", __v: 1 });
    data = { availability: semesterSlots[0] };
  } else if (path === "/availability/changed" && req.method === "PUT") {
    req.resume();
    res.statusCode = 409;
    data = { message: "This availability changed. Refresh and try again." };
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function until(read, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  assert.fail(message);
}

const pending = new Map();
let sequence = 0;
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const { result, exceptionDetails } = await command("Runtime.evaluate", { expression, returnByValue: true });
  assert.equal(exceptionDetails, undefined, JSON.stringify(exceptionDetails));
  return result.value;
}
const waitFor = expression => until(() => evaluate(expression), expression);
const selectByText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.getClientRects().length && node.textContent.trim() === ${JSON.stringify(text)})`;
const clickText = async (selector, text) => {
  const match = selectByText(selector, text);
  await waitFor(`Boolean(${match})`);
  await evaluate(`${match}.click()`);
};
const navigate = async path => {
  await command("Page.navigate", { url: origin + path });
  await waitFor(`location.pathname === ${JSON.stringify(path)} && document.readyState !== "loading"`);
};

before(async () => {
  const root = fileURLToPath(new URL("../../client/", import.meta.url));
  process.chdir(root);
  vite = await createServer({
    root,
    envFile: false,
    server: { host: "127.0.0.1", port: 0 },
    define: { "import.meta.env.VITE_API_URL": '"/pei01-api"' },
    plugins: [{ name: "pei01-fixtures", configureServer: server => { server.middlewares.use(fixtureApi); } }],
  });
  await vite.listen(0);
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  profile = await mkdtemp(join(tmpdir(), "socconsult-pei01-"));
  chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let launchError;
  chrome.on("error", error => { launchError = error; });
  const page = await until(async () => {
    if (launchError) throw launchError;
    try {
      const [port] = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n");
      return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(tab => tab.type === "page");
    } catch { return null; }
  }, "Chrome DevTools did not start");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const { id, result, error } = JSON.parse(event.data);
    if (!pending.has(id)) return;
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    if (error) reject(new Error(JSON.stringify(error)));
    else resolve(result);
  };
  await command("Network.enable");
  await command("Network.setBlockedURLs", { urls: ["https://*"] });
});

after(async () => {
  socket?.close();
  if (chrome?.pid && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
  }
  await vite?.close();
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

test("public portal offers Student and Faculty links at mobile, tablet and desktop widths", async () => {
  await navigate("/get-started");
  await waitFor('document.querySelectorAll("main article").length === 2');
  for (const [width, columns] of [[375, 1], [768, 2], [1440, 2]]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
    await waitFor(`innerWidth === ${width}`);
    assert.deepEqual(await evaluate('[...document.querySelectorAll("main article a")].map(link => [link.textContent.trim(), link.getAttribute("href")])'), [
      ["Continue as Student", "/student/login"], ["Continue as Faculty", "/faculty/login"],
    ]);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("main article").parentElement).gridTemplateColumns.split(" ").length'), columns);
    assert.equal(await evaluate('document.documentElement.scrollWidth === innerWidth'), true);
    assert.equal(await evaluate('Boolean(document.querySelector(\'a[href="/dean/login"]\'))'), false);
  }
  await navigate("/");
  await waitFor('Boolean(document.querySelector(\'a[href="/get-started"]\'))');
  assert.equal(await evaluate('Boolean(document.querySelector(\'a[href="/dean/login"]\'))'), false);
});

for (const role of ["student", "faculty", "dean"]) test(`${role} login opens its dashboard`, async () => {
  await navigate(`/${role}/login`);
  const selector = role === "dean" ? 'input[placeholder="Dean username"]' : 'input[type="email"]';
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await evaluate("sessionStorage.removeItem('consultio_token')");
  const fields = [[selector, role === "dean" ? "fixture-dean" : "fixture@example.test"], ["input[type=password]", "test-only-password"]];
  await evaluate(`for (const [selector, value] of ${JSON.stringify(fields)}) {
    const input = document.querySelector(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }`);
  await clickText("button", "Log In");
  await waitFor(`location.pathname === "/${role}/dashboard"`);
  assert.ok(requests.some(({ path, method }) => path === `/auth/login/${role}` && method === "POST"));
  await evaluate("sessionStorage.removeItem('consultio_token')");
});

for (const role of ["student", "faculty"]) {
  test(`${role} history filters and explains timed-out requests from either initiator`, async () => {
    await evaluate(`sessionStorage.setItem("consultio_token", ${JSON.stringify(role)})`);
    await navigate(`/${role}/history`);
    const option = 'document.querySelector(\'option[value="Expired"]\')';
    await waitFor(`Boolean(${option})`);
    assert.equal(await evaluate(`${option}.textContent`), "Request Timed Out");
    await evaluate(`{ const select = ${option}.parentElement; select.value = "Expired"; select.dispatchEvent(new Event("change", { bubbles: true })); }`);
    if (role === "faculty") await clickText("button", "Apply Filters");
    await until(() => requests.some(request => request.path === `/appointments/${role}-history` && request.status === "Expired"), "History request did not send Expired");
    for (const record of records) {
      const heading = selectByText("article h2, tbody td", record.subject);
      await waitFor(`Boolean(${heading})`);
      await evaluate(`${heading}.closest("tr, article").querySelector("button").click()`);
      const dialog = 'document.querySelector(\'[role="dialog"]\')';
      await waitFor(`Boolean(${dialog}?.innerText.includes("You may submit a new consultation request."))`);
      const details = await evaluate(`${dialog}.innerText`);
      assert.match(details, /The requested consultation time passed before the request was confirmed\. You may submit a new consultation request\./);
      assert.match(details, /Pending\s*→\s*Request Timed Out/);
      assert.doesNotMatch(details, /faculty_response_deadline_passed|no.show/i);
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await waitFor(`!${dialog}`);
    }
  });
}

test("Faculty semester closure confirms the Manila preview and reports partial results", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await evaluate('sessionStorage.setItem("consultio_token", "faculty")');
  await navigate("/faculty/availability");
  await clickText("button", "Past Schedules (1)");
  await clickText("button", "Current & Upcoming (3)");
  await clickText("button", "End Semester Availability");
  const setDate = (index, value) => evaluate(`{
    const input = document.querySelectorAll('#semester-availability input[type=date]')[${index}];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }`);
  await setDate(0, "2090-01-02");
  await setDate(1, "2090-01-01");
  await waitFor('document.body.innerText.includes("Enter valid dates")');
  await setDate(0, "2090-01-01");
  await waitFor('document.body.innerText.includes("2 eligible for deactivation") && document.body.innerText.includes("1 reserved")');
  await clickText("button", "Review Deactivation");
  const updates = () => requests.filter(request => request.method === "PUT").map(request => request.path);
  assert.deepEqual(updates(), []);
  await clickText('[role="dialog"] button', "Deactivate Schedules");
  await waitFor('document.querySelector(\'#semester-availability [role="status"]\').innerText.includes("1 changed or removed")');
  assert.match(await evaluate(`document.querySelector('#semester-availability [role="status"]').innerText`), /1 deactivated/);
  assert.deepEqual(updates(), ["/availability/eligible", "/availability/changed"]);
  assert.equal(await evaluate('document.documentElement.scrollWidth === innerWidth'), true);
});
