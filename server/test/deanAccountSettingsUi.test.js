import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
const source = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("Dean account UI has only approved profile and credential edits and accurate session behavior", async () => {
  const [page, app, picture, password] = await Promise.all(["pages/Dean/DeanAccountSettings.jsx", "App.jsx", "components/profile/ProfilePictureEditor.jsx", "components/profile/ProfileForm.jsx"].map(source));
  assert.match(app, /path="account" element=\{<DeanAccountSettings/);
  assert.match(app, /DeanRouteRedirect to="\/dean\/account"/);
  assert.doesNotMatch(app + page, /SystemSettings|System Settings|settings\/password/);
  const keys = JSON.parse(page.match(/const editable = (\[[^;]+\]);/)[1]);
  assert.deepEqual(keys, ["firstName", "middleName", "lastName", "office", "contactNumber"]);
  for (const text of ["Personal Information", "Account Information", "<ProfilePictureEditor compact", "<SecuritySettings compact", "eight-hour expiration", "Password changes do not sign out existing sessions."]) assert.ok(page.includes(text), text);
  assert.doesNotMatch(page, /user\.(studentId|yearLevel)|Not recorded|ConsultIO/);
  assert.match(page, /items.filter/);
  assert.match(page, /formatPersonName\(user\)/);
  assert.match(page, /user.accountStatus \|\| "Status unavailable"/);
  const layout = await source("components/RoleLayout.jsx");
  assert.match(layout, /const displayName = formatPersonName\(user\)/);
  assert.doesNotMatch(layout, /ConsultIO Administrator|SOCConsult Dean/);
  for (const key of ["username", "email", "institutionalId", "employeeId", "position", "specialization", "accountSource", "accountStatus", "passwordChangedAt"]) assert.ok(page.includes(`user.${key}`));
  assert.match(page, /if \(pending.current\) return/); assert.match(page, /disabled=\{saving\}/);
  assert.match(picture, /if \(!selection \|\| pending.current\) return/);
  assert.match(password, /if \(pending.current\) return/);
  assert.match(password, /confirmNewPassword: passwords.confirmPassword/);
  assert.match(password, /api\("\/auth\/change-password"/);
  assert.doesNotMatch(page, /sessionStorage|login\(|logout\(/);
});

test("Dean username settings use password verification, safe feedback and persisted setup state", async () => {
  const [page, messages] = await Promise.all(["pages/Dean/DeanAccountSettings.jsx", "utils/deanUiErrors.js"].map(source));
  assert.match(page, /aria-labelledby="sign-in-username-title"/);
  assert.match(page, /name="currentPassword" type="password" autoComplete="current-password"/);
  assert.match(page, /if \(pending.current\) return/);
  assert.match(page, /api\("\/auth\/me\/username"/);
  assert.match(page, /JSON.stringify\(\{ username, currentPassword \}\)/);
  assert.match(page, /setCurrentPassword\(""\)/);
  assert.match(page, /updateUser\(data.user\)/);
  assert.match(page, /deanUiError\(error, "username"\)/);
  assert.match(page, /user.initialCredentials \?\? \{\}/);
  assert.match(page, /\(usernamePending \|\| passwordPending\) &&/);
  assert.match(messages, /USERNAME_TAKEN: 'That username is already in use.'/);
  assert.match(messages, /USERNAME_PASSWORD_INVALID: 'The current password is incorrect.'/);
});

test("password form's actual submission handler suppresses same-tick repeats and clears secrets", async () => {
  const code = await source("components/profile/ProfileForm.jsx");
  const begin = code.indexOf("  const submit = async (event) => {");
  const end = code.indexOf("\n  };", begin);
  const body = code.slice(begin + "  const submit = async (event) => {".length, end);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction("event", "pending", "passwords", "setValidationError", "setSubmitting", "api", "clear", "toast", "onPasswordChanged", "mounted", "user", body);
  let release; const wait = new Promise(resolve => { release = resolve; }); let calls = 0, cleared = 0;
  const pending = { current: false }, passwords = { currentPassword: "OldPassword1", newPassword: "NewPassword2", confirmPassword: "NewPassword2" };
  const args = [{ preventDefault() {} }, pending, passwords, () => {}, () => {}, async () => { calls++; await wait; return {}; }, () => { cleared++; }, { success() {}, error() {} }, undefined, { current: true }, { role: "dean" }];
  const first = run(...args); await run(...args); assert.equal(calls, 1); release(); await first;
  assert.equal(cleared, 1); assert.equal(pending.current, false);
});

test("shared password form checks UTF-8 bytes before sending and accepts the exact boundary", async () => {
  const code = await source("components/profile/ProfileForm.jsx");
  const begin = code.indexOf("  const submit = async (event) => {");
  const end = code.indexOf("\n  };", begin);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction("event", "pending", "passwords", "setValidationError", "setSubmitting", "api", "clear", "toast", "onPasswordChanged", "mounted", "user", "clearPasswordRecommendation", code.slice(begin + "  const submit = async (event) => {".length, end));
  for (const role of ["student", "faculty", "dean"]) for (const newPassword of ["A1" + "a".repeat(70), "A1" + "é".repeat(35), "A1" + "a".repeat(71), "A1" + "é".repeat(36), "A1" + "😀".repeat(18)]) {
    let calls = 0, error = "";
    await run({ preventDefault() {} }, { current: false }, { currentPassword: " exact historical password ", newPassword, confirmPassword: newPassword },
      value => error = value, () => {}, async (_path, options) => { calls++; assert.equal(JSON.parse(options.body).newPassword, newPassword); },
      () => {}, { success() {}, error() {} }, undefined, { current: true }, { role }, () => {});
    const tooLong = Buffer.byteLength(newPassword, "utf8") > 72;
    assert.equal(calls, tooLong ? 0 : 1);
    assert.equal(error, tooLong ? "New password must be at most 72 UTF-8 bytes." : "");
    assert.ok(!error.includes(newPassword));
  }
  assert.match(code, /Maximum 72 UTF-8 bytes/);
});
