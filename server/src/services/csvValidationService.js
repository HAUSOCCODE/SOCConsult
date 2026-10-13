import { parse } from "csv-parse";
import {
  CSV_ACCOUNT_COLUMNS,
  CSV_ACCOUNT_REQUIRED_FIELDS,
  normalizeCsvAccountHeader,
  normalizeCsvAccountValue,
} from "../config/csvAccountFields.js";
import { accountImportConfig } from "../config/accountImport.js";
import { validatePersonName, formatFullName } from "./personNameService.js";

export class CsvValidationError extends Error {}
const fail = (message) => {
  throw new CsvValidationError(message);
};

export async function validateCsv(
  buffer,
  options,
) {
  const { config = accountImportConfig } = options;
  if (!buffer.length) fail("CSV file is empty.");
  if (buffer.length > config.maxBytes)
    fail("CSV file exceeds the upload size limit.");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail("CSV must contain readable UTF-8 text.");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text))
    fail("Binary or control content is not supported.");
  const parser = parse(text, {
    bom: true,
    cast: false,
    info: true,
    relax_column_count: true,
    max_record_size: config.maxRecordSize,
  });
  let headers,
    previousLine = 0;
  const rows = [];
  try {
    for await (const { record, info } of parser) {
      const startLine = previousLine + 1;
      previousLine = info.lines;
      if (!headers) {
        headers = record.map(normalizeCsvAccountHeader);
        if (new Set(headers).size !== headers.length)
          fail("CSV contains duplicate normalized headers.");
        if (headers.some((h) => !CSV_ACCOUNT_COLUMNS.includes(h)))
          fail("CSV contains unknown columns.");
        if (CSV_ACCOUNT_REQUIRED_FIELDS.some((h) => !headers.includes(h)))
          fail("CSV is missing required columns.");
        continue;
      }
      if (rows.length >= config.maxRows)
        fail("CSV exceeds the data row limit.");
      const row = {
        rowNumber: startLine,
        endLineNumber: info.lines,
        dataRowNumber: rows.length + 1,
        errors: [],
      };
      for (const field of CSV_ACCOUNT_COLUMNS) {
        const index = headers.indexOf(field);
        row[field] = normalizeCsvAccountValue(
          field,
          index < 0 ? "" : (record[index] ?? ""),
        );
      }
      if (record.length !== headers.length)
        row.errors.push({ field: "row", code: "COLUMN_COUNT", message: "Row must have the same number of fields as the header." });
      rows.push(row);
    }
  } catch (error) {
    if (error instanceof CsvValidationError) throw error;
    fail("CSV is malformed or exceeds the record size limit.");
  }
  if (!rows.length) fail("CSV must contain at least one data row.");
  return validateAccountRows(rows, options);
}

// Reuses exactly the upload rules at confirmation, without trusting stored valid/summary.
export async function validateAccountRows(input, { findUsers, studentDomain, facultyDomain, config = accountImportConfig }) {
  if (!Array.isArray(input) || !input.length || input.length > config.maxRows)
    fail("Preview must contain between 1 and 200 accounts.");
  const rows = input.map((value, index) => {
    const row = {
      rowNumber: value.rowNumber,
      endLineNumber: value.endLineNumber,
      dataRowNumber: index + 1,
      errors: [],
    };
    for (const field of CSV_ACCOUNT_COLUMNS) {
      if (typeof value[field] !== "string") fail("Preview contains invalid account data.");
      row[field] = normalizeCsvAccountValue(field, value[field]);
    }
    // A structural upload error cannot be repaired by discarding extra columns.
    if (value.errors?.some((error) => error.code === "COLUMN_COUNT"))
      row.errors.push({ field: "row", code: "COLUMN_COUNT", message: "Row must have the same number of fields as the header." });
    const add = (field, code, message) => row.errors.push({ field, code, message });
    for (const field of CSV_ACCOUNT_REQUIRED_FIELDS)
      if (!row[field]) add(field, "REQUIRED", `${field} is required.`);
    if (Buffer.byteLength(row.institutional_id, "utf8") > 72)
      add("institutional_id", "ID_LENGTH", "Institutional ID must be 72 UTF-8 bytes or fewer.");
    for (const field of CSV_ACCOUNT_COLUMNS)
      if (/[\x00-\x1f\x7f-\x9f]/.test(row[field]))
        add(field, "CONTROL_CONTENT", "Control content is not supported.");
    const names = validatePersonName({
      firstName: row.first_name,
      middleName: row.middle_name,
      lastName: row.last_name,
    });
    for (const [key, message] of Object.entries(names.errors)) {
      const field = {
        firstName: "first_name",
        middleName: "middle_name",
        lastName: "last_name",
      }[key];
      if (row[field]) add(field, "INVALID_NAME", message);
    }
    if (names.valid && !row.errors.some((error) => error.code === "CONTROL_CONTENT")) {
      row.first_name = names.values.firstName;
      row.middle_name = names.values.middleName;
      row.last_name = names.values.lastName;
    }
    row.fullName = formatFullName(names.values);
    if (row.fullName.length > 100)
      add(
        "name",
        "NAME_LENGTH",
        "Full name must be 100 characters or fewer.",
      );
    if (!["student", "faculty"].includes(row.role))
      add("role", "INVALID_ROLE", "Role must be student or faculty.");
    const email = row.official_email;
    const [local, emailDomain] = email.split("@");
    const validDomainLabels =
      emailDomain &&
      emailDomain
        .split(".")
        .every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
        );
    if (
      email &&
      (local.length > 64 ||
        !validDomainLabels ||
        email.length > 254 ||
        !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
          email,
        ) ||
        email.startsWith(".") ||
        email.includes("..") ||
        email.includes(".@"))
    )
      add(
        "official_email",
        "INVALID_EMAIL",
        "Enter a valid official email address.",
      );
    const domain =
      row.role === "student"
        ? studentDomain
        : row.role === "faculty"
          ? facultyDomain
          : null;
    if (email && domain && email.slice(email.lastIndexOf("@") + 1) !== domain)
      add(
        "official_email",
        "EMAIL_DOMAIN",
        "Use the official email domain for this role.",
      );
    return row;
  });
  const ids = [...new Set(rows.map((r) => r.institutional_id).filter(Boolean))];
  const emails = [
    ...new Set(rows.map((r) => r.official_email).filter(Boolean)),
  ];
  const users = await findUsers(ids, emails);
  const usedIds = new Set(
    users.flatMap((u) => [u.institutionalId, u.studentId, u.employeeId]).filter(Boolean),
  );
  const usedEmails = new Set(users.flatMap((u) => [u.email, u.username]).filter(Boolean));
  for (const [field, used] of [
    ["institutional_id", usedIds],
    ["official_email", usedEmails],
  ]) {
    const counts = new Map();
    for (const row of rows)
      if (row[field]) counts.set(row[field], (counts.get(row[field]) || 0) + 1);
    for (const row of rows) {
      if (row[field] && counts.get(row[field]) > 1)
        row.errors.push({
          field,
          code: "DUPLICATE_IN_FILE",
          message: `${field} is repeated in this file.`,
        });
      if (row[field] && used.has(row[field]))
        row.errors.push({
          field,
          code: "EXISTING_ACCOUNT",
          message: `${field} is already used by an account.`,
        });
    }
  }
  for (const row of rows) row.valid = row.errors.length === 0;
  const validRows = rows.filter((r) => r.valid).length;
  const summary = {
    totalRows: rows.length,
    validRows,
    invalidRows: rows.length - validRows,
    duplicateRows: rows.filter((r) =>
      r.errors.some((e) =>
        ["DUPLICATE_IN_FILE", "EXISTING_ACCOUNT"].includes(e.code),
      ),
    ).length,
  };
  return { rows, summary, canConfirm: summary.invalidRows === 0 };
}
