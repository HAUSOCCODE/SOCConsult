import multer from "multer";
import path from "node:path";
import { detectOutcomeProofType } from "./outcomeProofUpload.js";

const types = {
  ".jpg": ["image/jpeg", "image/jpg"],
  ".jpeg": ["image/jpeg", "image/jpg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".txt": ["text/plain"],
  ".csv": ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
  ".mp4": ["video/mp4"],
  ".webm": ["video/webm"],
};
const extensionOf = file => path.extname(file.originalname).toLowerCase();

function matchesSignature(file) {
  const { buffer } = file;
  const extension = extensionOf(file);
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension))
    return detectOutcomeProofType(buffer) === types[extension][0];
  if (extension === ".gif")
    return ["GIF87a", "GIF89a"].includes(buffer.toString("latin1", 0, 6));
  if (extension === ".pdf")
    return buffer.subarray(0, 1024).includes("%PDF-");
  return true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  preservePath: true,
  limits: { files: 5, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (/[/\\:\x00-\x1f\x7f]/.test(file.originalname))
      return callback(new Error("UNSAFE_FILE_NAME"));
    const allowed = types[extensionOf(file)];
    const mime = file.mimetype.toLowerCase();
    if (!allowed || (mime !== "application/octet-stream" && !allowed.includes(mime)))
      return callback(new Error("UNSUPPORTED_FILE_TYPE"));
    callback(null, true);
  },
}).array("documents", 5);

export const supportingDocumentUpload = (req, res, next) => {
  upload(req, res, (error) => {
    if (error?.message === "UNSUPPORTED_FILE_TYPE")
      return res
        .status(400)
        .json({ message: "This file type is not supported." });
    if (error?.code === "LIMIT_FILE_SIZE")
      return res
        .status(400)
        .json({ message: "Each supporting file must be 10 MB or smaller." });
    if (["LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"].includes(error?.code))
      return res
        .status(400)
        .json({ message: "You can upload up to 5 supporting files." });
    if (error?.message === "UNSAFE_FILE_NAME")
      return res.status(400).json({ message: "Supporting file names cannot contain path separators or control characters." });
    if (error) return res.status(400).json({ message: "Invalid supporting document upload." });
    const files = req.files || [];
    const totalSize = files.reduce(
      (total, file) => total + file.size,
      0,
    );
    if (totalSize > 25 * 1024 * 1024)
      return res.status(400).json({
        message: "Supporting documents must not exceed 25 MB in total.",
      });
    if (files.some(file => !file.buffer.length))
      return res.status(400).json({ message: "Supporting files cannot be empty." });
    if (files.some(file => !matchesSignature(file)))
      return res.status(400).json({ message: "A supporting file does not match its type." });
    next();
  });
};
