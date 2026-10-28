// Project-defined CSV contract. Parsing and account creation belong to later tasks.
export const CSV_ACCOUNT_COLUMNS = Object.freeze([
  "institutional_id",
  "first_name",
  "middle_name",
  "last_name",
  "official_email",
  "role",
]);
export const CSV_ACCOUNT_REQUIRED_FIELDS = Object.freeze(
  CSV_ACCOUNT_COLUMNS.filter((field) => field !== "middle_name"),
);
export const CSV_ACCOUNT_OPTIONAL_FIELDS = Object.freeze(["middle_name"]);
export const CSV_ACCOUNT_ALLOWED_ROLES = Object.freeze(["student", "faculty"]);

function trimmedString(value) {
  if (typeof value !== "string") {
    throw new TypeError("CSV headers and values must be strings.");
  }
  return value.trim();
}

export function normalizeCsvAccountHeader(value) {
  return trimmedString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function isCsvAccountColumn(value) {
  return CSV_ACCOUNT_COLUMNS.includes(normalizeCsvAccountHeader(value));
}

export function normalizeCsvAccountValue(field, value) {
  const column = normalizeCsvAccountHeader(field);
  if (!CSV_ACCOUNT_COLUMNS.includes(column)) {
    throw new RangeError(`Unknown CSV account column: ${column}`);
  }
  const normalized = trimmedString(value);
  return column === "official_email" || column === "role"
    ? normalized.toLowerCase()
    : normalized;
}

// Normalization does not validate a row. DEA-06 must reject empty required values.
export function isAllowedCsvAccountRole(value) {
  return CSV_ACCOUNT_ALLOWED_ROLES.includes(
    normalizeCsvAccountValue("role", value),
  );
}
