// Explicit standalone tooling; never import from application startup.
// Credentials come only from the invoking environment, never a .env file.
import mongoose from "mongoose";
import { planAppointmentMigration, applyAppointmentMigration } from "../src/services/appointmentStatusMigrationService.js";

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !["--apply", "--backup-confirmed"].includes(arg))) {
  console.error("Supported options: --apply --backup-confirmed"); process.exitCode = 1;
} else if (!process.env.MONGODB_URI || (args.has("--apply") && !args.has("--backup-confirmed"))) {
  console.error("An explicit MONGODB_URI is required; apply also requires --backup-confirmed."); process.exitCode = 1;
} else {
  let connection;
  try {
    connection = await mongoose.createConnection(process.env.MONGODB_URI, { autoIndex: false }).asPromise();
    const collection = connection.collection("appointments");
    const indexes = await collection.indexes();
    const matchingIndex = (index) => index.unique && index.key?.student === 1 && index.key?.faculty === 1 && Object.keys(index.key).length === 2;
    const expectedIndex = (index) => index.partialFilterExpression?.status === "Pending" && index.partialFilterExpression?.bookingMethod === "schedule_request";
    const indexIssues = !indexes.some((index) => matchingIndex(index) && expectedIndex(index)) ||
      indexes.some((index) => matchingIndex(index) && !expectedIndex(index)) ? 1 : 0;
    if (!args.has("--apply")) {
      const knownParticipantIds = new Set((await connection.collection("users").find({}, { projection: { _id: 1 } }).toArray()).map((user) => String(user._id)));
      const { counts, blocked } = planAppointmentMigration(await collection.find({}).toArray(), { knownParticipantIds });
      console.log(JSON.stringify({ mode: "dry-run", ...counts, indexIssues, blocked: blocked || indexIssues > 0 }));
    } else {
      if (indexIssues) throw new Error("Index rollout requires review.");
      const session = await connection.startSession();
      try {
        let counts;
        await session.withTransaction(async () => {
          const records = await collection.find({}, { session }).toArray();
          const knownParticipantIds = new Set((await connection.collection("users").find({}, { session, projection: { _id: 1 } }).toArray()).map((user) => String(user._id)));
          counts = await applyAppointmentMigration({ records, collection, session, knownParticipantIds });
        });
        console.log(JSON.stringify({ mode: "apply", ...counts }));
      } finally { await session.endSession(); }
    }
  } catch {
    // Driver errors can contain hostnames, URIs, or record data.
    console.error("Migration stopped. Review aggregate dry-run results and index readiness; no partial transaction is retained.");
    process.exitCode = 1;
  } finally { if (connection) await connection.close(); }
}
