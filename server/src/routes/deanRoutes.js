import { Router } from "express";
import accountImportRoutes from "./accountImportRoutes.js";
import { appointmentDocumentRoutes } from "./appointmentRoutes.js";
import { rateLimit } from "express-rate-limit";
import { authenticate, authorize } from "../middleware/auth.js";
import { chatWithAi } from "../controllers/aiController.js";
import {
  exportAuditLogs,
  getAuditUserLogs,
  getAuditUsers,
} from "../controllers/auditController.js";
import {
  approveRegistration,
  changeDeanPassword,
  getDeanAppointments,
  getAiConsultationSummary,
  getRegistration,
  getRegistrations,
  getUser,
  getUsers,
  getUserRegistrationReport,
  rejectRegistration,
  resetUserPassword,
  updateUserStatus,
} from "../controllers/deanController.js";

const router = Router();
router.use("/account-imports", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.use(authenticate, authorize("dean"));
router.use("/account-imports", accountImportRoutes);
router.use("/appointments", (req, _res, next) => { req.deanManagementAccess = true; next(); }, appointmentDocumentRoutes);
const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  keyGenerator: (req) => String(req.user.id),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    const resetTime =
      req.rateLimit?.resetTime?.getTime?.() || Date.now() + 60000;
    const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
    console.warn("[Dean AI] AI_RATE_LIMIT");
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      message:
        "You're sending requests a little too quickly. Please wait a moment and try again.",
      retryAfter,
    });
  },
});
router.post("/ai/chat", aiRateLimit, chatWithAi);
router.get("/registrations", getRegistrations);
router.get("/registrations/:id", getRegistration);
router.put("/registrations/:id/approve", approveRegistration);
router.put("/registrations/:id/reject", rejectRegistration);
router.get("/users", getUsers);
router.get("/reports/user-registrations", getUserRegistrationReport);
router.get("/users/:id", getUser);
router.put("/users/:id/reset-password", resetUserPassword);
router.put("/users/:id/status", updateUserStatus);
router.get("/appointments", getDeanAppointments);
router.get("/audit-users", getAuditUsers);
router.get("/audit-users/:userId/logs", getAuditUserLogs);
router.get("/audit-logs/export", exportAuditLogs);
router.get("/reports/ai-summary", aiRateLimit, getAiConsultationSummary);
router.put("/settings/password", changeDeanPassword);

export default router;
