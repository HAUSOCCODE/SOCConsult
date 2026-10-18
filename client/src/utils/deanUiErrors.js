// User-facing messages are local; never trust exception or server text.
const messages = {
 PREVIEW_UNAVAILABLE: 'This preview is missing or expired. Upload the CSV again.',
 PREVIEW_INVALID: 'Upload a new valid CSV before confirming.',
 IMPORT_PROCESSING: 'Import is processing. Refresh to check its status before trying again.',
 IMPORT_COMPLETED: 'This import has completed. Refresh to see its result.',
 ACCOUNT_CONFLICT: 'The institutional ID or official email is already in use. Check the highlighted fields or rows.',
 REVALIDATION_FAILED: 'Account data changed. Review the row errors and upload a corrected CSV.',
 PROVISIONING_SETUP_UNAVAILABLE: 'Account provisioning setup is unavailable. Please try again later.',
 ACCOUNT_CREATION_UNCERTAIN: 'Account creation could not be confirmed. Refresh the user list before trying again.',
 STATUS_CHANGE_UNCERTAIN: 'The status change could not be confirmed. Refresh the user list before trying again.',
 PASSWORD_RESET_UNCERTAIN: 'The password reset could not be confirmed. Refresh the user list before trying again.',
 STATUS_CONFLICT: 'This account changed. Refresh the user list before trying again.',
 PASSWORD_RESET_CONFLICT: 'This account changed. Refresh the user list before trying again.',
 SERVICE_UNAVAILABLE: 'This service is temporarily unavailable. Please try again later.',
 CSV_MISSING: 'Select one CSV file.',
 CSV_UNSUPPORTED: 'Select one supported CSV file without additional fields.',
 CSV_TOO_LARGE: 'CSV file must be 1 MiB or smaller.',
 CSV_EMPTY: 'CSV must contain at least one data row.',
 CSV_INVALID: 'Check the CSV format, required columns, UTF-8 encoding and row limits, then upload again.',
 PASSWORD_INPUT_INVALID: 'Check your current password and the new password requirements.',
 PASSWORD_SAME: 'Choose a new password different from your current password.',
 PASSWORD_CHANGE_UNCERTAIN: 'Password change could not be confirmed. Check whether you can sign in before trying again.',
 PASSWORD_CHANGE_UNAVAILABLE: 'Password change is temporarily unavailable. Please try again later.',
};
const fallbacks = {
 csv: 'Unable to validate the CSV. Please try again.',
 import: 'Import could not be confirmed. Refresh to check its status before trying again.',
 account: 'Unable to update this account. Refresh before trying again.',
 create: 'Unable to create the account. Check the highlighted fields or refresh the user list before trying again.',
 profile: 'Unable to update your profile. Check the highlighted fields and try again.',
 password: 'Password change could not be confirmed. Check whether you can sign in before trying again.',
 avatar: 'Unable to update your profile picture. Refresh before trying again.',
 pdf: 'Unable to generate the PDF report. Please try again.',
 ai: 'AI summary is unavailable. PDF reports remain available.',
 audit: 'Unable to load audit records. Please try again.',
 document: 'Unable to load this document. Please try again.',
 resolution: 'The review action could not be confirmed. Refresh the details before trying again.',
};
export const isAbortError = error => error?.name === 'AbortError';
export function deanUiError(error, context) {
 if (error?.code === "SERVICE_UNAVAILABLE" && context === "import") return fallbacks.import;
 if (error?.code === "SERVICE_UNAVAILABLE" && context === "ai") return fallbacks.ai;
 if (Object.hasOwn(messages, error?.code)) return messages[error.code];
 if (error?.status === 401) return 'Your session is unavailable. Please sign in again.';
 if (error?.status === 403) return 'You do not have access to this record or action.';
 if (error?.status === 404) return context === 'csv' || context === 'import' ? messages.PREVIEW_UNAVAILABLE : 'This record is no longer available. Refresh the list.';
 if (error?.status === 409) return context === 'ai' ? 'This narrative changed or was already reviewed. Refresh its status before continuing.' : 'This record changed or was already resolved. Refresh before continuing.';
 if ([400, 413].includes(error?.status)) return context === 'resolution' ? 'Choose a valid action and a reason of up to 500 characters.' : ['pdf', 'ai'].includes(context) ? 'Check the date range and filters, then try again.' : context === 'audit' ? 'Check the date range and audit filters, then try again.' : fallbacks[context] || 'Check the highlighted fields and try again.';
 return fallbacks[context] || 'Unable to complete this request. Please try again.';
}
