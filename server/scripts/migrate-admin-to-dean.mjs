import mongoose from "mongoose";
import { migrateDeanAccount } from "../src/services/deanAccountMigrationService.js";

// Intentionally does not load .env: provide variables through the execution environment.
const username = (process.env.DEAN_USERNAME || process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
try {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI must be provided through the environment.");
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await migrateDeanAccount({
    users: mongoose.connection.collection("users"),
    auditLogs: mongoose.connection.collection("auditlogs"),
    username,
  });
  console.log({ converted: "Admin account converted to Dean; identity and password preserved.", "already-dean": "Account is already Dean; no conversion needed.", missing: "No configured management account found; no account created." }[result.status]);
} catch (error) {
  // Database errors can contain connection strings; only known safe errors are displayed.
  const safe = /^(Management account conflict|Configured username|Account changed|MONGODB_URI must)/.test(error.message);
  console.error(safe ? error.message : "Migration failed connecting to or updating MongoDB. Check connectivity and retry.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
