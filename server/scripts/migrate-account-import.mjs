import mongoose from "mongoose";
import { migrateAccountImport } from "../src/services/accountImportMigrationService.js";

// No dotenv and no model imports: inspection must not trigger automatic index creation.
try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) throw new Error("Unsupported argument.");
  if (!process.env.MONGODB_URI) throw new Error("Connection configuration missing.");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  const result = await migrateAccountImport({ users: mongoose.connection.db.collection("users"),
    imports: mongoose.connection.db.collection("accountimports"), apply: args.includes("--apply") });
  console.log(JSON.stringify(result));
  if (!result.safeToApply) process.exitCode = 1;
} catch {
  console.error("Account-import preflight failed. Check configuration, connectivity, and maintenance prerequisites; no private details are displayed.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
