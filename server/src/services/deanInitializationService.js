import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import { DeanInitializationError, migrateDeanAccount } from "./deanAccountMigrationService.js";
import { normalizeUsername, validDeanUsername } from "./deanUsername.js";
import { passwordValidationError } from "./passwordPolicy.js";

export const deanInstallationMarker = Object.freeze({ _id: "dean-initialized" });
const marker = deanInstallationMarker;
const transactionOptions = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  maxCommitTimeMS: 30000,
};
const recoveryError = () => new DeanInitializationError(
  "The database has no Dean account. Follow the institution-authorized recovery procedure in the SOCConsult deployment guide.",
);

// The marker records installation state and is independent of all user identities.
export async function ensureDean(config) {
  const users = User.collection;
  const installation = mongoose.connection.collection("installationState");
  let session;
  try {
    await users.createIndex({ username: 1 }, { unique: true, sparse: true });
    await mongoose.connection.createCollection("installationState").catch(error => {
      if (error.code !== 48) throw error; // A previous startup already created the collection.
    });
    session = await mongoose.startSession();
    const initialize = () => session.withTransaction(async () => {
      const result = await migrateDeanAccount({ users, session });
      const initialized = await installation.findOne(marker, { session });
      if (result.status === "missing") {
        if (initialized || await users.findOne({}, { session, projection: { _id: 1 } }))
          throw recoveryError();
        if (!config.deanBootstrapEnabled)
          throw new DeanInitializationError("No management account found. For a verified new installation, authorize bootstrap with DEAN_BOOTSTRAP_ENABLED=true.");
        const username = normalizeUsername(config.deanUsername);
        if (!validDeanUsername(username) || !config.deanPassword || passwordValidationError(config.deanPassword))
          throw new DeanInitializationError("Dean bootstrap requires a valid initial username and a password that meets the account password policy.");
        const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
        for (const { name, type } of collections) {
          if (type !== "collection" || name.startsWith("system.") ||
              name === users.name || name === "installationState") continue;
          if (await mongoose.connection.db.collection(name).findOne({}, { session, projection: { _id: 1 } }))
            throw recoveryError();
        }
        // Acquire the shared marker before inserting the account. Both writes commit together.
        await installation.insertOne(marker, { session });
        await User.create([{
          name: "SOCConsult Dean",
          username,
          password: await bcrypt.hash(config.deanPassword, 12),
          role: "dean",
          registrationStatus: "Approved",
          accountStatus: "Active",
          bootstrapCredentialsIssuedAt: new Date(),
        }], { session });
        return { status: "created" };
      }
      if (!initialized) await installation.insertOne(marker, { session });
      return result;
    }, transactionOptions);
    try {
      return await initialize();
    } catch (error) {
      // A competing first startup can commit the same marker before this insert.
      if (error.code !== 11000) throw error;
      return await initialize();
    }
  } catch (error) {
    if (error instanceof DeanInitializationError) throw error;
    throw new DeanInitializationError("Unable to initialize Dean access. Check MongoDB transaction support, permissions, and the unique username index.");
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
}
