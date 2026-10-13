import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { csvUpload } from "../middleware/csvUpload.js";
import { accountImportConfig as config } from "../config/accountImport.js";
import {
  validateAccountImport,
  getAccountImport,
} from "../controllers/accountImportController.js";

const router = Router();
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const limiter = rateLimit({
  windowMs: config.uploadWindowMs,
  limit: config.uploadLimit,
  keyGenerator: (req) => String(req.user.id),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = Math.max(
      1,
      Math.ceil(
        ((req.rateLimit?.resetTime?.getTime() ||
          Date.now() + config.uploadWindowMs) -
          Date.now()) /
          1000,
      ),
    );
    res.set("Retry-After", String(retryAfter));
    res
      .status(429)
      .json({
        message: "Too many CSV uploads. Please try again later.",
        retryAfter,
      });
  },
});
router.post("/validate", limiter, csvUpload, validateAccountImport);
router.get("/:previewId", getAccountImport);
export default router;
