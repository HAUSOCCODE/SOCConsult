import multer from "multer";
import path from "node:path";

const types = new Map([[".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"]]);
export const detectOutcomeProofType = buffer => {
  if (buffer?.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer?.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer?.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
};
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, done) => {
    const expected = types.get(path.extname(file.originalname).toLowerCase());
    done(expected && expected === file.mimetype.toLowerCase() ? null : new Error("INVALID_OUTCOME_PROOF"), Boolean(expected));
  } }).single("proof");

export function outcomeProofUpload(req, res, next) {
  upload(req, res, error => {
    if (error?.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "Consultation proof must be 5 MB or smaller." });
    if (error?.code === "LIMIT_UNEXPECTED_FILE" || error?.message === "INVALID_OUTCOME_PROOF")
      return res.status(400).json({ message: "Upload a JPEG, PNG, or WebP consultation proof." });
    if (error) return next(error);
    if (req.file && detectOutcomeProofType(req.file.buffer) !== req.file.mimetype.toLowerCase())
      return res.status(400).json({ message: "The consultation proof content does not match its image type." });
    next();
  });
}
