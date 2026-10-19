const NETWORK_MESSAGE =
  "Network connection interrupted. Check your connection and try again.";

export function safeStudentError(error, fallback = "Something went wrong. Please try again.") {
  if (!error || error.name === "TypeError" || error.name === "AbortError" && !error.status)
    return NETWORK_MESSAGE;
  if (error.status === 401)
    return "Your session has expired. Please sign in again.";
  if (error.status === 403)
    return "You don't have permission to access this content.";
  if (error.status === 409)
    return "This information changed while you were working. Refresh before trying again.";
  if (error.status >= 500) return fallback;
  return fallback;
}

export const consultationSlotUnavailable = (error) =>
  error?.status === 409 ||
  ["SLOT_UNAVAILABLE", "AVAILABILITY_UNAVAILABLE", "RESERVATION_CONFLICT"].includes(error?.code);

export const isRecoverableStudentError = (error) =>
  ![401, 403].includes(error?.status);
