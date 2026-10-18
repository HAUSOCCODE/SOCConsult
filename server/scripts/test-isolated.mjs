import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";

// Reusable project runner: portable paths and ephemeral test-only signing values.
// No developer configuration or real service credentials are needed by the suite.
const testKey = randomBytes(32).toString("hex");
const targets = process.argv.slice(2);
if (!targets.length) targets.push(...readdirSync(new URL("../test/", import.meta.url))
  .filter((name) => name.endsWith(".test.js")).sort().map((name) => `test/${name}`));

// The full suite runs files concurrently; crypto-heavy account-import coverage can exceed
// 30 seconds under constrained CI even though it completes well within this bounded limit.
const result = spawnSync(process.execPath, ["--test", "--test-timeout=60000", ...targets], {
  cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test", JWT_SECRET: testKey,
    MONGODB_URI: "mongodb://127.0.0.1:1/socconsult-isolated-test", DEAN_PASSWORD: `Test-only-${testKey}!`,
    CLIENT_URL: "http://localhost:5173", CLOUDINARY_CLOUD_NAME: "isolated-test",
    CLOUDINARY_API_KEY: "test-only", CLOUDINARY_API_SECRET: testKey },
});
process.exitCode = result.status ?? 1;
