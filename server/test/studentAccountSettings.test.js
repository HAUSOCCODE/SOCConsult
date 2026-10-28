import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { me, updateProfile } from "../src/controllers/authController.js";

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const chain = (value) => ({
  select() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

test("Student self-profile exposes safe institutional data and only updates contact number", async () => {
  const id = new mongoose.Types.ObjectId();
  const student = {
    _id: id, id: String(id), role: "student", name: "Ana Reyes",
    firstName: "Ana", middleName: "", lastName: "Reyes",
    institutionalId: "2026-001", studentId: "2026-001",
    email: "ana@hau.edu.ph", program: "Computer Science", yearLevel: "3",
    contactNumber: "09170000000", accountStatus: "Active",
    password: "SECRET_HASH", resetToken: "SECRET_TOKEN",
  };
  const originalFindById = User.findById;
  User.findById = () => chain(student);
  try {
    const read = response();
    await me({ user: student }, read);
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.user.institutionalId, "2026-001");
    assert.equal(read.body.user.email, "ana@hau.edu.ph");
    assert.equal(read.body.user.role, "student");
    assert.equal(read.body.user.program, "Computer Science");
    assert.equal(read.body.user.yearLevel, "3");
    assert.equal(read.body.user.name, "Ana Reyes");
    assert.doesNotMatch(JSON.stringify(read.body), /SECRET|password|resetToken|accountStatus/);

    for (const key of [
      "institutionalId", "studentId", "email", "role", "accountStatus",
      "program", "yearLevel", "firstName", "middleName", "lastName", "name",
    ]) {
      const rejected = response();
      await updateProfile({ user: student, body: { contactNumber: "0918", [key]: "changed" } }, rejected);
      assert.equal(rejected.statusCode, 400, key);
    }
    for (const invalid of ["x".repeat(101), "bad\nnumber"]) {
      const rejected = response();
      await updateProfile({ user: student, body: { contactNumber: invalid } }, rejected);
      assert.equal(rejected.statusCode, 400);
    }
  } finally {
    User.findById = originalFindById;
  }
});

test("Student Account Settings source has accessible tabs, read-only identity, and approved mutations only", async () => {
  const [page, profile, app, layout] = await Promise.all([
    "../../client/src/pages/Student/StudentAccountSettings.jsx",
    "../../client/src/components/profile/ProfileForm.jsx",
    "../../client/src/App.jsx",
    "../../client/src/layouts/StudentLayout.jsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  for (const text of [
    "Profile", "Password", "Institutional Information", "Editable Profile Information",
    "Institutional ID", "Official email", "Program", "Year level", "contactNumber",
    "If your institutional information is incorrect, please contact the Dean.",
  ]) assert.ok(page.includes(text), text);
  assert.match(page, /role="tablist"/);
  assert.match(page, /role="tab"/);
  assert.match(page, /onKeyDown=/);
  assert.match(page, /JSON\.stringify\(\{ contactNumber: normalized \}\)/);
  assert.doesNotMatch(page, /JSON\.stringify\([^)]*(?:role|program|yearLevel|firstName|lastName)/s);
  assert.match(profile, /autoComplete=\{[\s\S]*current-password[\s\S]*new-password/);
  assert.match(profile, /confirmNewPassword: passwords\.confirmPassword/);
  assert.match(app, /path="account" element=\{<StudentAccountSettings/);
  assert.match(app, /path="profile" element=\{<Navigate to="\/student\/account" replace/);
  assert.match(app, /path="security" element=\{<Navigate to="\/student\/account" replace/);
  assert.equal((layout.match(/label: "Account Settings"/g) || []).length, 1);
  assert.doesNotMatch(page, /forced|password expired|must change/i);
});
