const NETWORK_MESSAGE =
  "Unable to connect to SOCConsult. Check your connection and try again.";

const SESSION_MESSAGE = "Your session has expired. Please sign in again.";
const UNAVAILABLE_MESSAGE =
  "This record is unavailable or you no longer have access to it.";
const STALE_MESSAGE =
  "This consultation has already been updated. Refresh the details to see the latest status.";

export function safeUiError(
  error,
  fallback = "Something went wrong. Please try again.",
  options = {},
) {
  if (error?.name === "AbortError") return "";
  if (!error?.status) return options.network || NETWORK_MESSAGE;
  if (error.status === 401) return SESSION_MESSAGE;
  if ([403, 404].includes(error.status))
    return options.notFound || UNAVAILABLE_MESSAGE;
  if (error.status === 409) return options.conflict || STALE_MESSAGE;
  if (error.status >= 500) return fallback;
  return options.validation || fallback;
}

export const isRecoverableUiError = (error) =>
  ![401, 403].includes(error?.status);

export const uiErrorMessages = {
  network: NETWORK_MESSAGE,
  session: SESSION_MESSAGE,
  unavailable: UNAVAILABLE_MESSAGE,
  stale: STALE_MESSAGE,
};
