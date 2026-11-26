import multer from "multer";
import path from "node:path";
import { accountImportConfig as config } from "../config/accountImport.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 1, parts: 3, fieldSize: 1024, fileSize: config.maxBytes },
  fileFilter: (_req, file, callback) => {
    const supported =
      path.extname(file.originalname).toLowerCase() === ".csv" &&
      [
        "text/csv",
        "application/csv",
        "text/plain",
        "application/vnd.ms-excel",
      ].includes(file.mimetype.toLowerCase());
    callback(supported ? null : new Error("UNSUPPORTED_CSV"), supported);
  },
}).single("file");

export function csvUpload(req, res, next) {
  upload(req, res, (error) => {
    if (error || Object.keys(req.body || {}).some((field) => field !== "mapping"))
      return res.status(error?.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        code: error?.code === "LIMIT_FILE_SIZE" ? "CSV_TOO_LARGE" : error?.code === "LIMIT_FIELD_VALUE" ? "CSV_INVALID_MAPPING" : "CSV_UNSUPPORTED",
        message:
          error?.code === "LIMIT_FILE_SIZE"
            ? "CSV file exceeds the upload size limit."
            : error?.code === "LIMIT_FIELD_VALUE"
              ? "Column mapping is too large."
              : "Upload one supported CSV file and, if needed, one column mapping.",
      });
    if (!req.file)
      return res.status(400).json({ code: "CSV_MISSING", message: "Select one CSV file." });
    next();
  });
}
