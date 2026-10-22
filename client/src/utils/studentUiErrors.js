import { isRecoverableUiError, safeUiError } from "./safeUiErrors.js";

export function safeStudentError(error, fallback = "Something went wrong. Please try again.") {
  return safeUiError(error, fallback, {
    network: "Network connection interrupted. Check your connection and try again.",
    notFound: "You don't have permission to access this content.",
    conflict: "This information changed while you were working. Refresh before trying again.",
  });
}

export const consultationSlotUnavailable = (error) =>
  error?.status === 409 ||
  ["SLOT_UNAVAILABLE", "AVAILABILITY_UNAVAILABLE", "RESERVATION_CONFLICT"].includes(error?.code);

export const isRecoverableStudentError = (error) =>
  isRecoverableUiError(error);
