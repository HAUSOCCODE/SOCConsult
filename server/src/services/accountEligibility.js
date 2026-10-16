// Internal legacy compatibility only; never changes stored account state.
export const eligibleRegistrationState = (user) =>
  user.registrationStatus == null || user.registrationStatus === "Approved";
