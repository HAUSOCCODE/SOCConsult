import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
const source = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("Dean account UI has only approved edits, read-only identity and accurate session behavior", async () => {
  const [page, app, picture, password] = await Promise.all(["pages/Dean/DeanAccountSettings.jsx", "App.jsx", "components/profile/ProfilePictureEditor.jsx", "components/profile/ProfileForm.jsx"].map(source));
  assert.match(app, /path="account" element=\{<DeanAccountSettings/);
  assert.match(app, /DeanRouteRedirect to="\/dean\/account"/);
  assert.doesNotMatch(app + page, /SystemSettings|System Settings|settings\/password/);
  const keys = JSON.parse(page.match(/const editable = (\[[^;]+\]);/)[1]);
  assert.deepEqual(keys, ["firstName", "middleName", "lastName", "office", "contactNumber"]);
  for (const text of ["Dean profile", "Contact details", "Profile picture", "Account security", "eight-hour expiration", "Password changes do not sign out existing sessions."]) assert.ok(page.includes(text), text);
  for (const key of ["username", "email", "institutionalId", "employeeId", "position", "specialization", "accountSource", "accountStatus", "passwordChangedAt"]) assert.ok(page.includes(`user.${key}`));
  assert.match(page, /if \(pending.current\) return/); assert.match(page, /disabled=\{saving\}/);
  assert.match(picture, /if \(!selection \|\| pending.current\) return/);
  assert.match(password, /if \(pending.current\) return/);
  assert.match(password, /confirmNewPassword: passwords.confirmPassword/);
  assert.match(password, /api\("\/auth\/change-password"/);
  assert.doesNotMatch(page, /sessionStorage|login\(|logout\(/);
});

test("password form's actual submission handler suppresses same-tick repeats and clears secrets", async () => {
  const code = await source("components/profile/ProfileForm.jsx");
  const begin = code.indexOf("  const submit = async (event) => {");
  const end = code.indexOf("\n  };", begin);
  const body = code.slice(begin + "  const submit = async (event) => {".length, end);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction("event", "pending", "passwords", "setValidationError", "setSubmitting", "api", "clear", "toast", "onPasswordChanged", body);
  let release; const wait = new Promise(resolve => { release = resolve; }); let calls = 0, cleared = 0;
  const pending = { current: false }, passwords = { currentPassword: "OldPassword1", newPassword: "NewPassword2", confirmPassword: "NewPassword2" };
  const args = [{ preventDefault() {} }, pending, passwords, () => {}, () => {}, async () => { calls++; await wait; return {}; }, () => { cleared++; }, { success() {}, error() {} }, undefined];
  const first = run(...args); await run(...args); assert.equal(calls, 1); release(); await first;
  assert.equal(cleared, 1); assert.equal(pending.current, false);
});
