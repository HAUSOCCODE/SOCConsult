import { getReviews, getReviewOptions, getReview, postReview } from "../controllers/attendanceReviewController.js";
import { Router } from "express";
import { postDeanReport } from "../controllers/deanReportController.js";
import { getConsultations, getConsultationOptions, getConsultation, getConsultationDocument } from "../controllers/deanConsultationController.js";
import accountImportRoutes from "./accountImportRoutes.js";
import { rateLimit } from "express-rate-limit";
import { authenticate, authorize } from "../middleware/auth.js";
import { postNarrative, getNarrative, postNarrativeReview } from "../controllers/reportNarrativeController.js";
import {
  exportAuditLogs,
  getAuditUserLogs,
  getAuditUsers,
} from "../controllers/auditController.js";
import {
  createUser,
  getUser,
  getUsers,
  getUserRegistrationReport,
  resetUserPassword,
  updateUserStatus,
} from "../controllers/deanController.js";

const router = Router();
router.use("/reports/pdf", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.use(["/consultations", "/appointments"], (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.use("/users", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.use("/account-imports", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.use("/attendance-review", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.use("/reports/ai-summaries", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.use(authenticate, authorize("dean"));
const narrativeLimit = (limit) => rateLimit({ windowMs: 60000, limit, keyGenerator: req => String(req.user.id), standardHeaders: "draft-7", legacyHeaders: false, message: { message: "Too many narrative requests. Please wait before retrying." } });
router.post("/reports/ai-summaries", narrativeLimit(4), postNarrative);
router.get("/reports/ai-summaries/:id", narrativeLimit(30), getNarrative);
router.post("/reports/ai-summaries/:id/review", narrativeLimit(8), postNarrativeReview);
router.post("/reports/pdf", rateLimit({ windowMs: 60000, limit: 4, keyGenerator: req => String(req.user.id), standardHeaders: "draft-7", legacyHeaders: false }), postDeanReport);
router.get("/attendance-review", getReviews);
router.get("/attendance-review/filter-options", getReviewOptions);
router.get("/attendance-review/:id", getReview);
router.post("/attendance-review/:id/actions", postReview);
router.use("/account-imports", accountImportRoutes);
router.use(["/consultations", "/appointments"], (req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) return res.status(403).json({ message: "Dean management access is read-only." });
  next();
});
router.get("/consultations", getConsultations);
router.get("/consultations/filter-options", getConsultationOptions);
router.get("/consultations/:consultationId/documents/:documentId", getConsultationDocument);
router.get("/consultations/:consultationId/document", getConsultationDocument);
router.get("/consultations/:consultationId", getConsultation);
router.get("/appointments/:id/documents/:documentId", getConsultationDocument);
router.get("/appointments/:id/document", getConsultationDocument);

router.get("/users", getUsers);
router.post(
  "/users",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => String(req.user.id),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) =>
      res
        .status(429)
        .json({
          message:
            "Too many account creation attempts. Please try again later.",
        }),
  }),
  createUser,
);
router.get("/reports/user-registrations", getUserRegistrationReport);
router.get("/users/:id", getUser);
router.post("/users/:id/reset-password", resetUserPassword);
router.patch("/users/:id/status", updateUserStatus);
router.get("/appointments", getConsultations);
router.get("/audit-users", getAuditUsers);
router.get("/audit-users/:userId/logs", getAuditUserLogs);
router.get("/audit-logs/export", exportAuditLogs);



export default router;
