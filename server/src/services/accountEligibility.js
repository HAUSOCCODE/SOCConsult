// Internal legacy compatibility only; never changes stored account state.
export const eligibleRegistrationState = (user) => {
  // Hydration supplies the schema's Pending default for absent legacy fields.
  // Only persisted documents with that generated default represent missing data;
  // explicit Pending values and new accounts must remain ineligible.
  const state = user.isNew === false && user.$isDefault?.("registrationStatus")
    ? undefined : user.registrationStatus;
  return state == null || state === "Approved";
};

const registrationFilter = () => ({ $in: ["Approved", null] });

export const eligibleAccount = (user, role) =>
  Boolean(user && user.role === role && user.accountStatus === "Active" && eligibleRegistrationState(user));

// MongoDB $in containing null also matches an absent field.
export const eligibleAccountFilter = (role) => ({
  role,
  accountStatus: "Active",
  registrationStatus: registrationFilter(),
});

// The Dean's personal consultation workspace retains its separate provider policy.
export const eligibleProviderFilter = () => ({
  accountStatus: "Active",
  $or: [
    { role: "faculty", registrationStatus: registrationFilter() },
    { role: "dean" },
  ],
});
