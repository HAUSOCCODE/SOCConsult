// One-shot operator/job entry point. No .env loading or persistent scheduler.
import mongoose from "mongoose";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyAttendanceCounts, runAppointmentAttendance } from "../src/services/attendanceProcessingService.js";

export async function runAttendanceCommand({ mongoUri = process.env.MONGODB_URI,
  connect = (uri) => mongoose.connect(uri, { autoIndex: false }),
  disconnect = () => mongoose.disconnect(), processRun = runAppointmentAttendance,
  write = (line) => console.log(line) } = {}) {
  let counts = emptyAttendanceCounts();
  if (!mongoUri) counts.errors++;
  else {
    try {
      await connect(mongoUri);
      counts = await processRun();
    } catch {
      // Never print driver errors: they can contain URIs or appointment content.
      counts.errors++; counts.incomplete = 1;
    } finally {
      try { await disconnect(); } catch { counts.errors++; }
    }
  }
  // Whitelist fields even if the processing result is extended later.
  let invalidCounts = false;
  const summary = Object.fromEntries(Object.keys(emptyAttendanceCounts()).map((key) => {
    const value = counts?.[key];
    if (!Number.isInteger(value) || value < 0) { invalidCounts = true; return [key, 0]; }
    return [key, value];
  }));
  if (invalidCounts) summary.errors++;
  write(JSON.stringify(summary));
  return summary.failed || summary.errors || summary.incomplete ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runAttendanceCommand();
