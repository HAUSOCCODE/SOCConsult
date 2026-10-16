import { createManualAccount } from "../services/manualAccountService.js";

import {
  listManagedUsers,
  readManagedUser,
  changeManagedUserStatus,
  resetManagedUserPassword,
} from "../services/userManagementService.js";

export async function createUser(req, res) {
  const result = await createManualAccount(req.body, req.user.id);
  return res.status(result.statusCode).json(result.body);
}
export async function getUsers(req, res) {
  const result = await listManagedUsers(req.query);
  return res.status(result.statusCode).json(result.body);
}
export async function getUser(req, res) {
  const result = await readManagedUser(req.params.id);
  return res.status(result.statusCode).json(result.body);
}
export async function resetUserPassword(req, res) {
  if (req.body === undefined && (Number(req.get("Content-Length")) > 0 || req.get("Transfer-Encoding")))
    return res.status(400).json({ message: "Password reset requires an empty request body." });
  const result = await resetManagedUserPassword(req.params.id, req.body, req.user.id, req.get("If-Match"));
  return res.status(result.statusCode).json(result.body);
}
export async function updateUserStatus(req, res) {
  const result = await changeManagedUserStatus(
    req.params.id,
    req.body,
    req.user.id,
  );
  return res.status(result.statusCode).json(result.body);
}
