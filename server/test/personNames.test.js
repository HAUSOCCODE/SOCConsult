import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import { register } from "../src/controllers/authController.js";
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

test("registration and profile flows persist separate fields and compose legacy name on the backend", () => {
  const source = fs.readFileSync(
    new URL("../src/controllers/authController.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /validatePersonName\(req\.body\)/);
  assert.match(source, /firstName,/);
  assert.match(source, /middleName,/);
  assert.match(source, /lastName,/);
  assert.match(source, /name: formatFullName|const name = formatFullName/);
  assert.doesNotMatch(source, /const name = \(req\.body\.name/);
});

test("student and faculty registration endpoints persist structured names with optional middle names", async () => {
  const restores = [];
  const created = [];
  let currentRole = "student";
  patch(User, "findOne", async () => null, restores);
  patch(
    User,
    "create",
    async (record) => {
      const saved = {
        ...record,
        _id: "507f1f77bcf86cd799439011",
        id: "507f1f77bcf86cd799439011",
      };
      created.push(saved);
      currentRole = saved.role;
      return saved;
    },
    restores,
  );
  patch(User, "find", () => ({ select: async () => [] }), restores);
  patch(
    User,
    "findById",
    async () => ({
      _id: "507f1f77bcf86cd799439011",
      id: "507f1f77bcf86cd799439011",
      role: currentRole,
    }),
    restores,
  );
  patch(AuditLog, "create", async (record) => record, restores);
  try {
    const cases = [
      {
        role: "student",
        body: {
          firstName: "Mikko",
          middleName: "E.",
          lastName: "Pangilinan",
          email: "mikko@student.hau.edu.ph",
          password: "Password1",
          studentId: "2026-001",
          program: "Bachelor of Science in Information Technology",
        },
        expected: "Mikko E. Pangilinan",
      },
      {
        role: "student",
        body: {
          firstName: "Ana",
          middleName: "",
          lastName: "Reyes",
          email: "ana@student.hau.edu.ph",
          password: "Password1",
          studentId: "2026-002",
          program: "Bachelor of Science in Computer Science",
        },
        expected: "Ana Reyes",
      },
      {
        role: "faculty",
        body: {
          firstName: "Maria",
          middleName: "L.",
          lastName: "Santos",
          email: "maria@hau.edu.ph",
          password: "Password1",
          employeeId: "FAC-001",
          position: "Professor",
        },
        expected: "Maria L. Santos",
      },
      {
        role: "faculty",
        body: {
          firstName: "Juan",
          lastName: "Dela Cruz",
          email: "juan@hau.edu.ph",
          password: "Password1",
          employeeId: "FAC-002",
          position: "Instructor",
        },
        expected: "Juan Dela Cruz",
      },
    ];
    for (const item of cases) {
      const res = response();
      await register({ params: { role: item.role }, body: item.body }, res);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.user.name, item.expected);
      assert.equal(res.body.user.firstName, item.body.firstName);
      assert.equal(res.body.user.middleName, item.body.middleName || "");
      assert.equal(res.body.user.lastName, item.body.lastName);
    }
    assert.equal(created.length, 4);
    assert.equal(created[0].name, "Mikko E. Pangilinan");
    assert.equal(created[1].middleName, "");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("registration returns field-specific errors before writing invalid names", async () => {
  for (const body of [
    { firstName: "", lastName: "Reyes" },
    { firstName: "Ana", lastName: "" },
    { firstName: "<b>Ana</b>", lastName: "Reyes" },
  ]) {
    const res = response();
    await register({ params: { role: "student" }, body }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors.firstName || res.body.errors.lastName);
  }
});
