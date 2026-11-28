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
 CSV_UNSUPPORTED: 'Select one supported CSV file.',
 CSV_TOO_LARGE: 'CSV file must be 1 MiB or smaller.',
 CSV_EMPTY: 'CSV must contain at least one data row.',
 CSV_INVALID: 'Check the CSV format, required columns, UTF-8 encoding and row limits, then upload again.',
 CSV_INVALID_HEADERS: 'Give every column a readable, nonempty header on the first row, then upload the CSV again.',
 CSV_DUPLICATE_HEADERS: 'Rename repeated headers so every source column has a unique name, then upload the CSV again.',
 CSV_ROW_LIMIT: 'This file exceeds the account limit. Prepare separate CSV files of up to 200 accounts each.',
 CSV_INVALID_MAPPING: 'Choose source columns from the uploaded CSV and validate the mapping again.',
 CSV_DUPLICATE_MAPPING: 'Use each account field and source column only once.',
 CSV_MISSING_MAPPING: 'Map the institutional ID, first name, last name, and official email before validating.',
 CSV_INVALID_BATCH_ROLE: 'Map a role column or choose Student or Faculty as the batch account type.',
 PASSWORD_INPUT_INVALID: 'Check your current password and the new password requirements.',
 PASSWORD_SAME: 'Choose a new password different from your current password.',
 PASSWORD_CHANGE_UNCERTAIN: 'Password change could not be confirmed. Check whether you can sign in before trying again.',
 PASSWORD_CHANGE_UNAVAILABLE: 'Password change is temporarily unavailable. Please try again later.',
 USERNAME_INPUT_INVALID: 'Enter a new username and your current password.',
 USERNAME_INVALID: 'Use 3–100 characters and a valid username or email-style sign-in name.',
 USERNAME_SAME: 'Choose a username different from your current one.',
 USERNAME_PASSWORD_INVALID: 'The current password is incorrect.',
 USERNAME_TAKEN: 'That username is already in use.',
 USERNAME_CONFLICT: 'Your account changed. Refresh before trying again.',
 USERNAME_CHANGE_UNCERTAIN: 'Refresh Account Settings to confirm your current username before retrying.',
 USERNAME_CHANGE_UNAVAILABLE: 'Username change is temporarily unavailable. Please try again later.',
 TRANSFER_INPUT_INVALID: 'Select a Faculty successor and a disposition, enter your current password and type TRANSFER.',
 TRANSFER_CONFLICT: 'The Dean or Faculty account changed. Review the current details before confirming again.',
 SUCCESSOR_INELIGIBLE: 'Select an active Faculty account with an eligible registration state.',
 SUCCESSOR_IDENTITY_REQUIRED: 'The Faculty account needs valid institutional identity and sign-in details. Contact the institutional administrator for assistance.',
 SUCCESSOR_PASSWORD_REQUIRED: 'Ask the Faculty member to personalize their password in Faculty Account Settings before transfer. If they cannot sign in, resolve access first.',
 OUTGOING_FACULTY_INELIGIBLE: 'Your account needs a valid official Faculty email and institutional ID to continue as Faculty. Contact the institutional administrator or choose deactivation.',
 OUTGOING_CONSULTATIONS_OPEN: 'Resolve outstanding consultations, reservations and attendance through the consultation workflows before deactivating your account.',
 FACULTY_IDENTITY_REQUIRED: 'Institutional Faculty identity must be verified before this account can be reactivated.',
 TRANSFER_PASSWORD_INVALID: 'The current password is incorrect.',
 TRANSFER_UNAVAILABLE: 'Dean privilege transfer is temporarily unavailable.',
 TRANSFER_UNCERTAIN: 'The transfer could not be confirmed. Contact the institutional administrator to verify the current Dean and transfer audit before trying again.',
};
const fallbacks = {
 csv: 'Unable to validate the CSV. Please try again.',
 import: 'Import could not be confirmed. Refresh to check its status before trying again.',
 account: 'Unable to update this account. Refresh before trying again.',
 create: 'Unable to create the account. Check the highlighted fields or refresh the user list before trying again.',
 profile: 'Unable to update your profile. Check the highlighted fields and try again.',
 password: 'Password change could not be confirmed. Check whether you can sign in before trying again.',
 username: 'Unable to update your sign-in username. Please try again.',
 transfer: 'Unable to load the Faculty account details. Refresh and try again.',
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
 if (error?.status === 429 && context === 'csv') return 'Too many CSV uploads. Wait before trying again.';
 if (error?.status === 429 && context === 'username') return 'Too many username attempts. Wait before trying again.';
 if (error?.status === 429 && context === 'transfer') return 'Too many transfer requests. Wait before trying again.';
 if (error?.status === 409 && context === 'transfer') return messages.TRANSFER_CONFLICT;
 if (error?.status === 409 && context === 'username') return messages.USERNAME_CONFLICT;
 if (error?.status === 404) return context === 'csv' || context === 'import' ? messages.PREVIEW_UNAVAILABLE : 'This record is no longer available. Refresh the list.';
 if (error?.status === 409) return context === 'ai' ? 'This narrative changed or was already reviewed. Refresh its status before continuing.' : 'This record changed or was already resolved. Refresh before continuing.';
 if ([400, 413].includes(error?.status)) return context === 'resolution' ? 'Choose a valid action and a reason of up to 500 characters.' : ['pdf', 'ai'].includes(context) ? 'Check the date range and filters, then try again.' : context === 'audit' ? 'Check the date range and audit filters, then try again.' : fallbacks[context] || 'Check the highlighted fields and try again.';
 return fallbacks[context] || 'Unable to complete this request. Please try again.';
}
