import jwt from "jsonwebtoken";
import app from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { appointmentHarness, newId } from "./appointmentHarness.js";

export async function appointmentHttp() {
  const h = appointmentHarness();
  const users = {};
  for (const role of ["student", "faculty", "dean", "otherStudent", "otherFaculty"]) {
    const id = newId();
    users[role] = { id, _id: id, role: role.startsWith("other") ? role.slice(5).toLowerCase() : role,
      name: role, yearLevel: "3rd Year", accountStatus: "Active", registrationStatus: "Approved" };
    h.state.users.push(users[role]);
  }
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  return { ...h, users,
    request: (path, role = "student", method = "GET", body) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { ...(role && { Authorization: `Bearer ${jwt.sign({ sub: users[role].id }, env.jwtSecret)}` }),
        "Content-Type": "application/json", Connection: "close" }, ...(body && { body: JSON.stringify(body) }),
    }),
    close: async () => { await new Promise((resolve) => server.close(resolve)); h.restore(); },
  };
}
