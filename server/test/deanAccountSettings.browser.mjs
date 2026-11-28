// Run with: node server/test/deanAccountSettings.browser.mjs
// Uses installed Chrome and Vite, with in-browser API fixtures; no database or credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../client/node_modules/vite/dist/node/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(resolve(root, "client"));
const output = resolve(process.env.DEAN_BROWSER_OUTPUT || resolve(root, "artifacts/dean-account-settings"));
const profile = await mkdtemp(resolve(tmpdir(), "socconsult-dean-ui-"));
process.env.VITE_API_URL = "http://127.0.0.1:1/api";
const vite = await createServer({ root: resolve(root, "client"), envFile: false, server: { host: "127.0.0.1", port: 0 } });
let chrome, socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await mkdir(output, { recursive: true });
  await vite.listen();
  const port = vite.httpServer.address().port;
  chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let browser;
  for (let i = 0; i < 100; i++) {
    try { const [debugPort] = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n");
      browser = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); break;
    } catch { await delay(100); }
  }
  assert.ok(browser, "Chrome debugging endpoint started");
  socket = new WebSocket(browser.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map(), exceptions = [];
  const resourceErrors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Network.loadingFailed" && message.params.type === "Script")
      resourceErrors.push(message.params.errorText);
    if (message.id) {
      const task = pending.get(message.id); pending.delete(message.id);
      if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result);
    }
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(50); }
    throw new Error(`Timed out: ${expression} at ${await evaluate("location.pathname")}. Browser exceptions: ${exceptions.join(", ")}. Script errors: ${resourceErrors.join(", ")}`);
  };
  await command("Page.enable"); await command("Runtime.enable"); await command("Network.enable");
  await command("Page.addScriptToEvaluateOnNewDocument", { source: `
    sessionStorage.setItem('consultio_token', 'test-only');
    window.fixture = {
      user: { id: 'dean-fixture', role: 'dean', name: 'Ana Reyes', firstName: 'Ana', middleName: '', lastName: 'Reyes', username: 'dean', email: 'dean@example.edu', employeeId: 'EMP-1', office: 'SOC Office', contactNumber: '09123456789', accountStatus: 'Active', accountSource: 'manual', initialCredentials: { usernamePending: true, passwordPending: true } },
      requests: [], failProfile: false, failPassword: false, failPhoto: false, usernameError: null
    };
    const realFetch = window.fetch;
    window.fetch = async (url, options = {}) => {
      if (!String(url).includes('/api/')) return realFetch(url, options);
      const f = window.fixture, path = new URL(url, location.href).pathname, method = options.method || 'GET';
      const body = !(options.body instanceof FormData) && options.body ? JSON.parse(options.body) : null;
      const safeBody = body && Object.fromEntries(Object.entries(body).filter(([key]) => !/password/i.test(key)));
      f.requests.push({ path, method, body: options.body instanceof FormData ? { photo: options.body.get('photo')?.name } : safeBody });
      const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      const candidates = [
        { _id: '000000000000000000000001', name: 'Robin Fixture', email: 'robin@example.edu', institutionalId: 'FIX-001', accountStatus: 'Active', version: null },
        { _id: '000000000000000000000002', name: 'Casey Fixture', email: 'casey@example.edu', institutionalId: 'FIX-002', accountStatus: 'Active', version: null },
      ];
      if (path === '/api/dean/users') return reply({ users: candidates, pagination: { page: 1, totalPages: 1 } });
      if (path.includes('/privilege-transfer/successors/')) {
        const successor = candidates.find(candidate => path.endsWith(candidate._id));
        return reply({ successor, successorIssue: successor === candidates[1] ? 'SUCCESSOR_PASSWORD_REQUIRED' : null, outgoingVersion: null, canRemainFaculty: true });
      }
      if (path.endsWith('/privilege-transfer')) {
        if (f.transferError) return reply({ code: f.transferError, message: 'Internal transfer detail' }, f.transferError === 'TRANSFER_UNCERTAIN' ? 503 : 400);
        if (f.holdTransfer) await new Promise(resolve => { f.releaseTransfer = resolve; });
        return reply({ code: 'TRANSFER_COMPLETED' });
      }
      if (path.endsWith('/profile-picture')) {
        if (f.failPhoto) return reply({}, 503);
        if (method === 'DELETE') delete f.user.profilePicture;
        else f.user.profilePicture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=';
        return reply({ user: f.user });
      }
      if (path.endsWith('/change-password')) {
        if (f.failPassword) return reply({ code: 'PASSWORD_INPUT_INVALID' }, 400);
        f.user.passwordChangedAt = '2026-11-23T04:00:00Z';
        f.user.initialCredentials.passwordPending = false;
        return reply({});
      }
      if (path.endsWith('/auth/me/username')) {
        if (f.usernameError) return reply({ code: f.usernameError, message: 'Internal fixture detail' }, f.usernameError === 'USERNAME_TAKEN' ? 409 : 400);
        if (f.holdUsername) await new Promise(resolve => { f.releaseUsername = resolve; });
        f.user.username = body.username.trim().toLowerCase();
        f.user.initialCredentials.usernamePending = false;
        return reply({ user: f.user });
      }
      if (path.endsWith('/auth/me')) {
        if (method === 'PUT') {
          if (f.failProfile) return reply({ errors: { office: 'Office could not be saved.' } }, 400);
          Object.assign(f.user, JSON.parse(options.body));
          f.user.name = [f.user.firstName, f.user.middleName, f.user.lastName].filter(Boolean).join(' ');
        }
        return reply({ user: f.user });
      }
      return reply({ notifications: [], unreadCount: 0 });
    };
    window.setField = (selector, value) => {
      const input = document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.clickText = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text).click();
    window.selectPhoto = (name, type, size = 10) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(size)], name, { type }));
      const input = document.querySelector('input[type=file]'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
  ` });
  await command("Page.navigate", { url: `http://127.0.0.1:${port}/dean/account` });
  await wait(`document.querySelector('#personal-information-title')`);
  assert.equal(await evaluate(`document.querySelectorAll('main input:not([type=file])').length`), 11);
  assert.equal(await evaluate(`document.querySelector('#dean-initial-setup-title')?.textContent`), "Set Up Your Dean Account");
  assert.equal(await evaluate(`/Student ID|Year level|Not recorded|ConsultIO/.test(document.querySelector('main').innerText)`), false);
  assert.equal(await evaluate(`document.querySelector('#dean-profile-title').textContent`), "Ana Reyes");
  for (const [name, width, height] of [["mobile", 375, 812], ["tablet", 768, 1024], ["desktop", 1440, 1000]]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(200);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `${name}: no horizontal overflow`);
    assert.equal(await evaluate(`[...document.querySelectorAll('main input:not([type=file])')].every(input => { const r = input.getBoundingClientRect(); return r.width > 100 && r.left >= 0 && r.right <= innerWidth; })`), true, `${name}: inputs fit viewport`);
    const screenshot = await command("Page.captureScreenshot", { captureBeyondViewport: true });
    await writeFile(resolve(output, `${name}.png`), Buffer.from(screenshot.data, "base64"));
  }
  await evaluate(`setField('input[autocomplete="given-name"]', 'Elena')`);
  await evaluate(`clickText('Save profile')`);
  await wait(`document.querySelector('#dean-profile-title').textContent === 'Elena Reyes'`);
  assert.deepEqual(await evaluate(`Object.keys(fixture.requests.find(r => r.method === 'PUT' && r.path.endsWith('/auth/me')).body).sort()`), ["contactNumber", "firstName", "lastName", "middleName", "office"]);
  await evaluate(`fixture.failProfile = true; clickText('Save profile')`);
  await wait(`document.querySelector('#dean-profile-office-error')?.textContent === 'Office could not be saved.'`);
  await evaluate(`fixture.failProfile = false; setField('input[autocomplete="given-name"]', '123')`);
  await evaluate(`clickText('Save profile')`);
  await wait(`document.querySelector('#dean-profile-firstName-error')`);
  await evaluate(`setField('input[autocomplete="given-name"]', 'Elena')`);
  await evaluate(`clickText('Save profile')`);
  await wait(`!document.querySelector('#dean-profile-firstName-error')`);

  await evaluate(`selectPhoto('invalid.txt', 'text/plain')`);
  assert.equal(await evaluate(`!!document.querySelector('[role=dialog]')`), false);
  await evaluate(`selectPhoto('large.png', 'image/png', 4 * 1024 * 1024 + 1)`);
  assert.equal(await evaluate(`!!document.querySelector('[role=dialog]')`), false);
  await evaluate(`selectPhoto('portrait.png', 'image/png')`);
  await wait(`document.querySelector('[role=dialog]')`);
  await evaluate(`fixture.failPhoto = true; clickText('Save Photo')`);
  await wait(`document.body.innerText.includes('Unable to update your profile picture.')`);
  assert.equal(await evaluate(`!!document.querySelector('[role=dialog]')`), true);
  await evaluate(`fixture.failPhoto = false; clickText('Save Photo')`);
  await wait(`!document.querySelector('[role=dialog]') && !!fixture.user.profilePicture`);
  assert.equal(await evaluate(`fixture.requests.find(r => r.method === 'PATCH').body.photo`), "portrait.png");
  await evaluate(`clickText('Remove Photo')`);
  await wait(`document.querySelector('[role=dialog]')`);
  await evaluate(`clickText('Remove')`);
  await wait(`!document.querySelector('[role=dialog]') && !fixture.user.profilePicture`);

  const usernameField = '#sign-in-username-title ~ form input[name=username]';
  const usernamePassword = '#sign-in-username-title ~ form input[type=password]';
  const fillUsername = async (name, password) => {
    await evaluate(`setField(${JSON.stringify(usernameField)}, ${JSON.stringify(name)}); setField(${JSON.stringify(usernamePassword)}, ${JSON.stringify(password)})`);
  };
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(usernamePassword)}).autocomplete`), "current-password");
  await evaluate(`document.querySelector(${JSON.stringify(usernameField)}).focus()`);
  for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(usernamePassword)})`), true);
  for (const [code, message] of [
    ["USERNAME_PASSWORD_INVALID", "The current password is incorrect."],
    ["USERNAME_TAKEN", "That username is already in use."],
  ]) {
    await evaluate(`fixture.usernameError = ${JSON.stringify(code)}`);
    await fillUsername("Reserved.Name", "FixturePassword1");
    await evaluate(`clickText('Save Username')`);
    await wait(`document.querySelector('#sign-in-username-title ~ form [role=alert]')?.textContent === ${JSON.stringify(message)}`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(usernamePassword)}).value`), "");
    assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Internal fixture detail')`), false);
  }
  await evaluate(`fixture.usernameError = null; fixture.holdUsername = true`);
  await fillUsername("Personal.Dean", "FixturePassword1");
  await evaluate(`const usernameForm = document.querySelector('#sign-in-username-title ~ form'); usernameForm.requestSubmit(); usernameForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));`);
  await wait(`fixture.releaseUsername && document.querySelector('#sign-in-username-title ~ form button').disabled`);
  assert.equal(await evaluate(`fixture.requests.filter(r => r.path.endsWith('/auth/me/username')).length`), 3);
  await evaluate(`fixture.releaseUsername()`);
  await wait(`document.querySelector('#sign-in-username-title ~ form [role=status]')?.textContent.includes('Sign-in username updated')`);
  assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('consultio_user')).username`), "personal.dean");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(usernamePassword)}).value`), "");
  assert.equal(await evaluate(`document.querySelector('#dean-initial-setup-title + ol').textContent.includes('Choose your sign-in username.')`), false);
  assert.equal(await evaluate(`document.querySelector('#dean-initial-setup-title + ol').textContent.includes('Change your temporary password.')`), true);

  const passwordCurrent = 'form:has(#change-password-title) input[autocomplete=current-password]';
  const fillPasswords = async (current, next, confirmation = next) => {
    const selectors = [passwordCurrent, "input[autocomplete=new-password]", "label:last-child input[autocomplete=new-password]"];
    for (const [i, value] of [current, next, confirmation].entries()) await evaluate(`setField(${JSON.stringify(selectors[i])}, ${JSON.stringify(value)})`);
    await evaluate(`document.querySelector(${JSON.stringify(passwordCurrent)}).closest('form').requestSubmit()`);
  };
  for (const [current, next, confirm, message] of [
    ["OldPassword1", "NewPassword2", "Mismatch2", "New passwords do not match."],
    ["OldPassword1", "New Password2", "New Password2", "Password cannot contain spaces."],
    ["OldPassword1", "weak", "weak", "Password must be at least 8 characters"],
    ["OldPassword1", "OldPassword1", "OldPassword1", "New password must be different"],
  ]) {
    await fillPasswords(current, next, confirm);
    await wait(`document.querySelector('#password-validation-error')?.textContent.includes(${JSON.stringify(message)})`);
  }
  assert.equal(await evaluate(`fixture.requests.filter(r => r.path.endsWith('/change-password')).length`), 0);
  await evaluate(`document.querySelector('[aria-label="Show current password"]').click()`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(passwordCurrent)}).type`), "text");
  await evaluate(`fixture.failPassword = true`);
  await fillPasswords("OldPassword1", "NewPassword2");
  await wait(`document.body.innerText.includes('Check your current password and the new password requirements.')`);
  await evaluate(`fixture.failPassword = false`);
  await fillPasswords("OldPassword1", "NewPassword2");
  await wait(`document.querySelector(${JSON.stringify(passwordCurrent)}).value === ''`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(passwordCurrent)}).type`), "password");
  assert.equal(await evaluate(`sessionStorage.getItem('consultio_token')`), "test-only");
  await wait(`document.querySelector('main').innerText.includes('Nov 23') || document.querySelector('main').innerText.includes('2026')`);
  await wait(`!document.querySelector('#dean-initial-setup-title')`);

  // An old stored display name remains an identity, rather than being replaced by branding.
  await evaluate(`fixture.user.firstName = ''; fixture.user.lastName = ''; fixture.user.name = 'ConsultIO Administrator'; fixture.user.accountStatus = 'Inactive'; sessionStorage.setItem('consultio_user', JSON.stringify(fixture.user))`);
  // Refresh AuthContext from the fixture via the existing password-success callback.
  await fillPasswords("NewPassword2", "AnotherPassword3");
  await wait(`document.querySelector('#dean-profile-title').textContent === 'ConsultIO Administrator'`);
  assert.equal(await evaluate(`document.querySelector('#dean-profile-title').parentElement.innerText.includes('Inactive')`), true);
  assert.equal(await evaluate(`document.body.innerText.includes('SOCConsult Dean')`), false);

  const switchWorkspace = workspace => evaluate(`(() => {
    const workspaceSelect = document.querySelector('select:has(option[value=faculty])');
    workspaceSelect.value = ${JSON.stringify(workspace)};
    workspaceSelect.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await switchWorkspace("faculty");
  await wait(`location.pathname === '/dean/faculty/dashboard'`);
  await switchWorkspace("management");
  await wait(`location.pathname === '/dean/dashboard'`);
  assert.equal(await evaluate(`sessionStorage.getItem('consultio_token')`), "test-only");

  await command("Page.navigate", { url: `http://127.0.0.1:${port}/dean/account?workspace=faculty` });
  await wait(`document.querySelector('#personal-information-title') && location.search`);
  assert.equal(await evaluate(`Boolean(document.querySelector('#dean-transfer-title'))`), false);
  await command("Page.navigate", { url: `http://127.0.0.1:${port}/dean/account` });
  await wait(`document.querySelector('#dean-transfer-title') && !location.search`);

  const transferSection = 'section[aria-labelledby=dean-transfer-title]';
  const transferForm = `${transferSection} form[aria-label]`;
  const transferPassword = `${transferForm} input[type=password]`;
  const confirmationField = `${transferForm} input[maxlength="8"]`;
  const fillTransfer = async (password, confirmation = "TRANSFER") => {
    await evaluate(`setField(${JSON.stringify(transferPassword)}, ${JSON.stringify(password)}); setField(${JSON.stringify(confirmationField)}, ${JSON.stringify(confirmation)})`);
  };
  const pick = name => evaluate(`[...document.querySelectorAll('${transferSection} li button')].find(button => button.textContent.includes(${JSON.stringify(name)})).click()`);
  await evaluate(`clickText('Search Faculty')`);
  await wait(`document.querySelectorAll('${transferSection} li button').length === 2`);
  await pick("Casey Fixture");
  await wait(`document.querySelector('${transferSection}').textContent.includes('personalize their password')`);
  assert.equal(await evaluate(`Boolean(document.querySelector('${transferForm}'))`), false);
  await pick("Robin Fixture");
  await wait(`document.querySelector('${transferForm}')`);
  assert.equal(await evaluate(`document.querySelector('${transferPassword}').type`), "password");
  await evaluate(`document.querySelector('${transferForm} input[value=Inactive]').click()`);
  await wait(`document.querySelector('${transferForm}').textContent.includes('inactive Faculty')`);
  await evaluate(`document.querySelector('${transferForm} input[value=Active]').click()`);
  await wait(`document.querySelector('${transferForm}').textContent.includes('active Faculty')`);
  await evaluate(`document.querySelector('${transferPassword}').focus()`);
  for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(confirmationField)})`), true);
  await fillTransfer("WrongFixture1", "WRONG");
  assert.equal(await evaluate(`document.querySelector('${transferForm} button[type=submit]').disabled`), true);
  await fillTransfer("WrongFixture1");
  await evaluate(`fixture.transferError = 'TRANSFER_PASSWORD_INVALID'; clickText('Transfer Dean privileges')`);
  await wait(`document.querySelector('${transferSection} [role=alert]')?.textContent === 'The current password is incorrect.'`);
  assert.equal(await evaluate(`document.querySelector('${transferPassword}').value`), "");
  assert.equal(await evaluate(`document.querySelector('${transferSection}').textContent.includes('Internal transfer detail')`), false);
  for (const width of [375, 768, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });
    await wait(`innerWidth === ${width}`);
    await delay(200);
    const layout = await evaluate(`({ pageWidth: document.documentElement.scrollWidth, formRight: document.querySelector('${transferForm}').getBoundingClientRect().right })`);
    assert.ok(layout.pageWidth <= width && layout.formRight <= width, `Transfer layout at ${width}px: ${JSON.stringify(layout)}`);
  }
  await fillTransfer("FixturePassword1");
  await evaluate(`fixture.transferError = 'TRANSFER_UNCERTAIN'; clickText('Transfer Dean privileges')`);
  await wait(`document.querySelector('${transferSection} [role=alert]')?.textContent.includes('verify the current Dean')`);
  assert.equal(await evaluate(`document.querySelector('${transferForm} button[type=submit]').disabled && sessionStorage.getItem('consultio_token') === 'test-only'`), true);
  await command("Page.reload");
  await wait(`document.querySelector('#dean-transfer-title') && !fixture.transferError`);
  await evaluate(`clickText('Search Faculty')`);
  await wait(`document.querySelectorAll('${transferSection} li button').length === 2`);
  await pick("Robin Fixture");
  await wait(`document.querySelector('${transferForm}')`);
  await evaluate(`document.querySelector('${transferForm} input[value=Active]').click(); fixture.holdTransfer = true`);
  await fillTransfer("FixturePassword1");
  await evaluate(`{ const form = document.querySelector('${transferForm}'); form.requestSubmit(); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }`);
  await wait(`fixture.releaseTransfer && document.querySelector('${transferForm} button[type=submit]').disabled`);
  assert.equal(await evaluate(`fixture.requests.filter(r => r.path.endsWith('/privilege-transfer')).length`), 1);
  await evaluate(`fixture.releaseTransfer()`);
  await wait(`location.pathname === '/faculty/login' && document.body.textContent.includes('Dean privileges transferred.')`);
  assert.equal(await evaluate(`sessionStorage.getItem('consultio_token') || sessionStorage.getItem('consultio_user')`), null);

  await command("Page.navigate", { url: `http://127.0.0.1:${port}/dean/account` });
  await wait(`document.querySelector('#dean-transfer-title')`);
  await evaluate(`clickText('Search Faculty')`);
  await wait(`document.querySelectorAll('${transferSection} li button').length === 2`);
  await pick("Robin Fixture");
  await wait(`document.querySelector('${transferForm}')`);
  await evaluate(`document.querySelector('${transferForm} input[value=Inactive]').click()`);
  await fillTransfer("FixturePassword1");
  await evaluate(`clickText('Transfer Dean privileges')`);
  await wait(`location.pathname === '/dean/login' && document.body.textContent.includes('Dean privileges transferred.')`);
  assert.equal(await evaluate(`sessionStorage.getItem('consultio_token') || sessionStorage.getItem('consultio_user')`), null);
  assert.deepEqual(exceptions, []);
  console.log("PASS: Dean settings regressions and transfer lookup, eligibility, disposition, masking, keyboard confirmation, wrong-password and uncertain-result feedback, duplicate prevention, sign-out, and layouts (375/768/1440px).");
} finally {
  socket?.close();
  if (chrome) { chrome.kill(); await delay(500); }
  await vite.close();
  assert.equal(dirname(profile), resolve(tmpdir()));
  assert.ok(basename(profile).startsWith("socconsult-dean-ui-"));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
