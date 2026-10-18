import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import { updateProfile } from "../src/controllers/authController.js";
import {
  formatFullName,
  validatePersonName,
} from "../src/services/personNameService.js";

const baseUser = {
  email: "name@student.hau.edu.ph",
  password: "hashed-password",
  role: "student",
};
const patch = (target, key, replacement, restores) => {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
};
const response = () => {
  const result = { statusCode: 200, body: null };
  result.status = (code) => {
    result.statusCode = code;
    return result;
  };
  result.json = (body) => {
    result.body = body;
    return result;
  };
  return result;
};

test("validates and formats structured names with or without a middle name", () => {
  const withMiddle = validatePersonName({
    firstName: "  Mikko ",
    middleName: " E. ",
    lastName: " Pangilinan  ",
  });
  assert.equal(withMiddle.valid, true);
  assert.deepEqual(withMiddle.values, {
    firstName: "Mikko",
    middleName: "E.",
    lastName: "Pangilinan",
  });
  assert.equal(formatFullName(withMiddle.values), "Mikko E. Pangilinan");

  const withoutMiddle = validatePersonName({
    firstName: "Mikko",
    middleName: "   ",
    lastName: "Pangilinan",
  });
  assert.equal(withoutMiddle.valid, true);
  assert.equal(formatFullName(withoutMiddle.values), "Mikko Pangilinan");
});

test("accepts legitimate international punctuation and rejects markup", () => {
  for (const values of [
    { firstName: "Anne-Marie", middleName: "Q.", lastName: "O'Connor" },
    { firstName: "José Luis", middleName: "", lastName: "Dela Cruz" },
    { firstName: "Ma. Elena", middleName: "S.", lastName: "Reyes-García" },
  ]) {
    assert.equal(validatePersonName(values).valid, true);
  }
  const unsafe = validatePersonName({
    firstName: "<script>alert(1)</script>",
    lastName: "User",
  });
  assert.equal(unsafe.valid, false);
  assert.match(unsafe.errors.firstName, /letters/i);
});

test("returns field-specific errors for missing required name parts", () => {
  const missing = validatePersonName({ firstName: " ", lastName: "" });
  assert.equal(missing.valid, false);
  assert.equal(missing.errors.firstName, "First name is required.");
  assert.equal(missing.errors.lastName, "Last name is required.");
  assert.equal(missing.errors.middleName, undefined);
});

test("structured User records require both first and last name", () => {
  const complete = new User({
    ...baseUser,
    name: "Mikko Pangilinan",
    firstName: "Mikko",
    lastName: "Pangilinan",
  });
  assert.equal(complete.validateSync(), undefined);

  const missingLast = new User({
    ...baseUser,
    name: "Mikko",
    firstName: "Mikko",
  });
  assert.ok(missingLast.validateSync()?.errors.lastName);
});

test("legacy accounts remain valid and use name or fullName fallback", () => {
  const legacy = new User({ ...baseUser, name: "Legacy Compound Name" });
  assert.equal(legacy.validateSync(), undefined);
  assert.equal(formatFullName(legacy), "Legacy Compound Name");
  assert.equal(
    formatFullName({ fullName: "Older Full Name" }),
    "Older Full Name",
  );
  assert.equal(
    formatFullName({
      firstName: "New",
      middleName: "",
      lastName: "Name",
      name: "Ignored Legacy Name",
    }),
    "New Name",
  );
});


test("Faculty profile updates persist structured names and return field errors", async () => {
  const restores = [], writes = [];
  patch(User, "findById", () => ({ select: async () => ({ firstName: "Old", lastName: "Name" }) }), restores);
  patch(User, "findByIdAndUpdate", (_id, updates) => {
    writes.push(updates);
    return { select: async () => ({ id: "profile", ...updates }) };
  }, restores);
  patch(AuditLog, "create", async record => record, restores);
  try {
    for (const role of ["faculty"]) {
      for (const middleName of ["E.", ""]) {
        const res = response();
        await updateProfile({ user: { id: "profile", role }, body: { firstName: " Mikko ", middleName, lastName: " Pangilinan " } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.user.firstName, "Mikko");
        assert.equal(res.body.user.middleName, middleName);
        assert.equal(res.body.user.lastName, "Pangilinan");
        assert.equal(writes.at(-1).name, middleName ? "Mikko E. Pangilinan" : "Mikko Pangilinan");
      }
      for (const body of [{ firstName: "", lastName: "Reyes" }, { firstName: "Ana", lastName: "" }, { firstName: "<b>Ana</b>", lastName: "Reyes" }]) {
        const before = writes.length, res = response();
        await updateProfile({ user: { id: "profile", role }, body }, res);
        assert.equal(res.statusCode, 400);
        assert.ok(res.body.errors.firstName || res.body.errors.lastName);
        assert.equal(writes.length, before);
      }
    }
  } finally { restores.reverse().forEach(restore => restore()); }
});
