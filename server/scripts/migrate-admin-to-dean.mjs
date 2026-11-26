import mongoose from "mongoose";
import { DeanInitializationError } from "../src/services/deanAccountMigrationService.js";
import { ensureDean } from "../src/services/deanInitializationService.js";

// Intentionally does not load .env: provide variables through the execution environment.
try {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI must be provided through the environment.");
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await ensureDean({ deanBootstrapEnabled: false });
  console.log({ converted: "Admin account converted to Dean; identity and password preserved.", "already-dean": "Account is already Dean; no conversion needed." }[result.status]);
} catch (error) {
  // Database errors can contain connection strings; only known safe errors are displayed.
  const safe = error instanceof DeanInitializationError || error.message.startsWith("MONGODB_URI must");
  console.error(safe ? error.message : "Migration failed connecting to or updating MongoDB. Check connectivity and retry.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
