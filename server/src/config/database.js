import mongoose from "mongoose";
import { env, validateEnv } from "./env.js";
import { ensureDean } from "../controllers/authController.js";

const cache = globalThis.__consultioDatabase || {
  connectionPromise: null,
  initializationPromise: null,
};

globalThis.__consultioDatabase = cache;

async function initializeDatabase() {
  await ensureDean();
  // Existing accounts are read as stored. No implicit eligibility normalization.
}

export async function connectDatabase() {
  validateEnv();
  if (mongoose.connection.readyState !== 1) {
    if (!cache.connectionPromise) {
      cache.connectionPromise = mongoose.connect(env.mongoUri).catch((error) => {
        cache.connectionPromise = null;
        throw error;
      });
    }
    await cache.connectionPromise;
  }

  if (!cache.initializationPromise) {
    cache.initializationPromise = initializeDatabase().catch((error) => {
      cache.initializationPromise = null;
      throw error;
    });
  }
  await cache.initializationPromise;
  return mongoose.connection;
}
