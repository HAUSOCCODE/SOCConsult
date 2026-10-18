import mongoose from "mongoose";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processConsultationReminders } from "../src/services/consultationReminderService.js";

export async function runReminderCommand({ mongoUri = process.env.MONGODB_URI,
  connect = uri => mongoose.connect(uri, { autoIndex: false }), disconnect = () => mongoose.disconnect(),
  processRun = processConsultationReminders, write = line => console.log(line) } = {}) {
  let result = { scanned: 0, created: 0, skipped: 0, errors: 0 };
  if (!mongoUri) result.errors++;
  else try { await connect(mongoUri); result = await processRun(); }
  catch { result.errors++; }
  finally { try { await disconnect(); } catch { result.errors++; } }
  write(JSON.stringify(result));
  return result.errors ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runReminderCommand();
