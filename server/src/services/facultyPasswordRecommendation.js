import bcrypt from "bcryptjs";
import { resolveResetInstitutionalId } from "./userManagementService.js";

// Provenance alone is insufficient. Compare only after successful Faculty login.
export async function recommendInitialPasswordChange(user) {
  if (user.role !== "faculty" ||
      (!["csv", "manual"].includes(user.accountSource) &&
       !(user.passwordResetAt instanceof Date && Number.isFinite(user.passwordResetAt.getTime())))) return false;
  const id = resolveResetInstitutionalId(user);
  if (!id) return false;
  try { return await bcrypt.compare(id, user.password); } catch { return false; }
}
