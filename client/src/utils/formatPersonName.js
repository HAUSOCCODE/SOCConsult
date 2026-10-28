const clean = (value) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const NAME_PATTERN = /^[\p{L}\p{M}]+(?:[\p{L}\p{M} .'’\-]*[\p{L}\p{M}.])?$/u;

export const normalizeNamePart = clean;

export function validatePersonNameFields(person = {}) {
  const values = {
    firstName: clean(person.firstName),
    middleName: clean(person.middleName),
    lastName: clean(person.lastName),
  };
  const errors = {};
  for (const [key, label, required] of [
    ["firstName", "First name", true],
    ["middleName", "Middle name", false],
    ["lastName", "Last name", true],
  ]) {
    const value = values[key];
    if (!value && required) errors[key] = `${label} is required.`;
    else if (value.length > 80)
      errors[key] = `${label} must be 80 characters or fewer.`;
    else if (value && !NAME_PATTERN.test(value))
      errors[key] =
        `${label} may contain letters, spaces, hyphens, apostrophes, and periods only.`;
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

export function formatPersonName(person = "") {
  if (typeof person === "string") return clean(person);
  if (!person || typeof person !== "object") return "";
  const structured = [person.firstName, person.middleName, person.lastName]
    .map(clean)
    .filter(Boolean)
    .join(" ");
  return structured || clean(person.name || person.fullName);
}

const PERSON_ACTION_PATTERN =
  /^(.+?) (submitted|cancelled|requested|selected|completed)\b/i;

export function formatPersonNameInNotification(message = "") {
  if (typeof message !== "string") return "";
  return message.replace(PERSON_ACTION_PATTERN, (match, name, action) =>
    match.replace(`${name} ${action}`, `${formatPersonName(name)} ${action}`),
  );
}
