import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  CSV_ACCOUNT_COLUMNS,
  CSV_ACCOUNT_REQUIRED_FIELDS,
  CSV_ACCOUNT_OPTIONAL_FIELDS,
  CSV_ACCOUNT_ALLOWED_ROLES,
  normalizeCsvAccountHeader,
  isCsvAccountColumn,
  normalizeCsvAccountValue,
  isAllowedCsvAccountRole,
} from "../src/config/csvAccountFields.js";

test("canonical CSV columns, requirements and import roles are explicit", () => {
  assert.deepEqual(CSV_ACCOUNT_COLUMNS, [
    "institutional_id",
    "first_name",
    "middle_name",
    "last_name",
    "official_email",
    "role",
  ]);
  assert.deepEqual(CSV_ACCOUNT_REQUIRED_FIELDS, [
    "institutional_id",
    "first_name",
    "last_name",
    "official_email",
    "role",
  ]);
  assert.deepEqual(CSV_ACCOUNT_OPTIONAL_FIELDS, ["middle_name"]);
  assert.deepEqual(CSV_ACCOUNT_ALLOWED_ROLES, ["student", "faculty"]);
  for (const definition of [
    CSV_ACCOUNT_COLUMNS,
    CSV_ACCOUNT_REQUIRED_FIELDS,
    CSV_ACCOUNT_OPTIONAL_FIELDS,
    CSV_ACCOUNT_ALLOWED_ROLES,
  ])
    assert.ok(Object.isFrozen(definition));
});

test("headers normalize separators without inventing column mappings", () => {
  for (const header of [
    " Official Email ",
    "OFFICIAL_EMAIL",
    "official-email",
    "official   email",
  ]) {
    assert.equal(normalizeCsvAccountHeader(header), "official_email");
    assert.equal(isCsvAccountColumn(header), true);
  }
  for (const header of ["email", "studentId", "employee_id", "unknown", " "])
    assert.equal(isCsvAccountColumn(header), false);
  assert.throws(
    () => normalizeCsvAccountValue("email", "a@hau.edu.ph"),
    RangeError,
  );
});

test("values trim while preserving IDs, name casing and internal whitespace", () => {
  assert.equal(
    normalizeCsvAccountValue("institutional_id", " 000123 "),
    "000123",
  );
  assert.equal(
    normalizeCsvAccountValue("institutional_id", " FAC-001 "),
    "FAC-001",
  );
  assert.equal(
    typeof normalizeCsvAccountValue("institutional_id", "000123"),
    "string",
  );
  assert.throws(
    () => normalizeCsvAccountValue("institutional_id", 123),
    TypeError,
  );
  assert.equal(normalizeCsvAccountValue("first_name", " Juan "), "Juan");
  assert.equal(
    normalizeCsvAccountValue("middle_name", " Dela  Cruz "),
    "Dela  Cruz",
  );
  assert.equal(normalizeCsvAccountValue("last_name", " Santos "), "Santos");
  assert.equal(normalizeCsvAccountValue("middle_name", " \t "), "");
  for (const field of CSV_ACCOUNT_REQUIRED_FIELDS)
    assert.equal(normalizeCsvAccountValue(field, " \t "), "");
  assert.equal(
    normalizeCsvAccountValue("official_email", " Juan@Student.HAU.edu.ph "),
    "juan@student.hau.edu.ph",
  );
  assert.equal(normalizeCsvAccountValue("role", " FACULTY "), "faculty");
});

test("only Student and Faculty are allowed after normalization", () => {
  for (const role of ["student", "faculty", " Student ", " FACULTY "])
    assert.equal(isAllowedCsvAccountRole(role), true);
  for (const role of ["dean", " DEAN ", "admin", "staff", "", " \t "])
    assert.equal(isAllowedCsvAccountRole(role), false);
});

test("public sample matches the shared contract and canonical sample rows", async () => {
  const csv = await readFile(
    new URL(
      "../../client/public/templates/socconsult-account-import-template.csv",
      import.meta.url,
    ),
    "utf8",
  );
  const lines = csv.trimEnd().split(/\r?\n/);
  assert.deepEqual(lines[0].split(","), CSV_ACCOUNT_COLUMNS);
  assert.deepEqual(lines.slice(1), [
    "202600001,Juan,Dela Cruz,Santos,juansantos@student.hau.edu.ph,student",
    "FAC-001,Maria,,Reyes,mreyes@hau.edu.ph,faculty",
  ]);
});
