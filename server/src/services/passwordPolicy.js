export const passwordValidationMessage =
  "Password must be at least 8 characters and include one uppercase letter and one number. Spaces are not allowed.";
export const passwordLengthMessage = "New password must be at most 72 UTF-8 bytes.";

export function passwordValidationError(password) {
  if (Buffer.byteLength(password, "utf8") > 72) return passwordLengthMessage;
  if (password.length < 8 || /\s/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
    return passwordValidationMessage;
  return "";
}
