import multer from "multer";
import path from "node:path";
import { accountImportConfig as config } from "../config/accountImport.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 0, parts: 2, fileSize: config.maxBytes },
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
    if (error)
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "CSV file exceeds the upload size limit."
            : "Upload exactly one supported CSV file in the file field, without other fields.",
      });
    if (!req.file)
      return res.status(400).json({ message: "Select one CSV file." });
    next();
  });
}
