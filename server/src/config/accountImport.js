// Optional overrides; invalid or excessive values safely use the bounded defaults.
const limit = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isSafeInteger(value) && value > 0 && value <= fallback
    ? value
    : fallback;
};
export const accountImportConfig = Object.freeze({
  maxBytes: limit("CSV_IMPORT_MAX_BYTES", 1024 * 1024),
  maxRows: limit("CSV_IMPORT_MAX_ROWS", 1000),
  maxRecordSize: limit("CSV_IMPORT_MAX_RECORD_SIZE", 16 * 1024),
  lifetimeMs: limit("CSV_IMPORT_LIFETIME_MS", 30 * 60 * 1000),
  uploadLimit: limit("CSV_IMPORT_UPLOAD_LIMIT", 10),
  uploadWindowMs: 15 * 60 * 1000,
});
