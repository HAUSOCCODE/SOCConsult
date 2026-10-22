import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { me, updateProfile } from "../src/controllers/authController.js";
import { safeMetadata } from "../src/services/auditPolicy.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const chain = (value) => ({ select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test("Faculty self-service response is safe and profile mutations are explicitly allowlisted", async () => {
  const id = new mongoose.Types.ObjectId();
  const faculty = { _id: id, id: String(id), role: "faculty", accountStatus: "Active", firstName: "Ana", middleName: "", lastName: "Reyes", name: "Ana Reyes", institutionalId: "FAC-1", employeeId: "FAC-1", email: "ana@hau.edu.ph", position: "Professor", office: "Room 1", specialization: "Networks", contactNumber: "0917", password: "SECRET_HASH", passwordResetAt: new Date(), approvedBy: "PRIVATE" };
  const originalFindById = User.findById;
  const originalUpdate = User.findByIdAndUpdate;
  User.findById = () => chain(faculty);
  User.findByIdAndUpdate = (_id, updates) => { Object.assign(faculty, updates); return chain(faculty); };
  try {
    const read = response();
    await me({ user: faculty }, read);
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.user.employeeId, "FAC-1");
    assert.doesNotMatch(JSON.stringify(read.body), /SECRET_HASH|passwordResetAt|approvedBy|accountStatus/);
    for (const key of ["institutionalId", "employeeId", "email", "role", "accountStatus", "department", "password", "passwordChangedAt", "approvedBy", "userId", "facultyId", "$set", "unknown"]) {
      const rejected = response();
      await updateProfile({ user: faculty, body: { contactNumber: "0918", [key]: "changed" } }, rejected);
      assert.equal(rejected.statusCode, 400, key);
    }
    const updated = response();
    await updateProfile({ user: faculty, body: { firstName: " Ana ", middleName: "Q.", lastName: "Reyes", position: "Professor", office: " Room 2 ", specialization: " Security ", contactNumber: " 0918 " } }, updated);
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.user.office, "Room 2");
    assert.equal(updated.body.user.contactNumber, "0918");
    assert.equal(faculty.role, "faculty");
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalUpdate;
  }
});

test("Faculty account UI consolidates safe profile and password settings", async () => {
  const [page, app, layout, password, picture] = await Promise.all([
    "../../client/src/pages/Faculty/FacultyAccountSettings.jsx", "../../client/src/App.jsx",
    "../../client/src/layouts/FacultyLayout.jsx", "../../client/src/components/profile/ProfileForm.jsx",
    "../../client/src/components/profile/ProfilePictureEditor.jsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const copy of ["Account Settings", "Profile", "Password", "Institutional Faculty ID", "Official Email Address", "Role", "Position / Designation", "Office", "Specialization", "Contact number", "Save Changes"]) assert.ok(page.includes(copy), copy);
  assert.match(page, /role="tablist"/);
  assert.match(page, /ProfilePictureEditor/);
  assert.match(page, /SecuritySettings/);
  assert.doesNotMatch(page, /Department/);
  assert.match(page, /For account security, consider changing your initial password/);
  assert.doesNotMatch(page, /forcePassword|mustReset|mustChange/);
  assert.match(password, /current-password/);
  assert.match(password, /new-password/);
  assert.match(password, /confirmNewPassword: passwords\.confirmPassword/);
  assert.match(picture, /accept="\.jpg,\.jpeg,\.png,\.webp,image\/jpeg,image\/png,image\/webp"/);
  assert.match(app, /path="account" element=\{<FacultyAccountSettings/);
  assert.match(app, /path="profile" element=\{<DeanRouteRedirect to="\/faculty\/account"/);
  assert.match(app, /path="security" element=\{<DeanRouteRedirect to="\/faculty\/account"/);
  assert.equal((layout.match(/label: "Account Settings"/g) || []).length, 1);
});

test("profile audit metadata permits approved Faculty fields but rejects protected values", () => {
  assert.deepEqual(safeMetadata("profile_updated", { fieldNames: ["firstName", "position", "office", "specialization", "contactNumber"], password: "SECRET", role: "dean" }),
    { fieldNames: ["firstName", "position", "office", "specialization", "contactNumber"] });
  assert.deepEqual(safeMetadata("profile_updated", { fieldNames: ["institutionalId"] }), {});
});
