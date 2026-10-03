const NAME_MIN = 1;
const NAME_MAX = 80;
const NAME_PATTERN = /^[\p{L}\p{M}]+(?:[\p{L}\p{M} .'’\-]*[\p{L}\p{M}.])?$/u;

export const cleanNamePart = (value = "") =>
  String(value).normalize("NFC").trim().replace(/\s+/g, " ");

export function validatePersonName(input = {}) {
  const values = {
    firstName: cleanNamePart(input.firstName),
    middleName: cleanNamePart(input.middleName),
    lastName: cleanNamePart(input.lastName),
  };
  const errors = {};
  for (const key of ["firstName", "lastName"]) {
    if (!values[key])
      errors[key] =
        `${key === "firstName" ? "First" : "Last"} name is required.`;
  }
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    const label =
      key === "firstName"
        ? "First name"
        : key === "middleName"
          ? "Middle name"
          : "Last name";
    if (value.length < NAME_MIN || value.length > NAME_MAX)
      errors[key] = `${label} must be ${NAME_MAX} characters or fewer.`;
    else if (!NAME_PATTERN.test(value))
      errors[key] =
        `${label} may contain letters, spaces, hyphens, apostrophes, and periods only.`;
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

export function formatFullName(person = {}) {
  if (typeof person === "string") return cleanNamePart(person);
  const structured = [person.firstName, person.middleName, person.lastName]
    .map(cleanNamePart)
    .filter(Boolean)
    .join(" ");
  return structured || cleanNamePart(person.name || person.fullName);
}

export const personNameInternals = { NAME_MAX, NAME_PATTERN };
