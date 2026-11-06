import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { disputeInitiatorOutcome, readAttendance, readOutcomeProof, processAttendance } from "../services/attendanceService.js";
import { outcomeProofUpload } from "../middleware/outcomeProofUpload.js";
import { documentContent, documentHeaders } from "../services/appointmentDocumentAuthorizationService.js";
const router = Router();
router.use((req, res, next) => {
  if (!/^\/[^/]+\/(?:attendance(?:-responses|-dispute)?|attendance-proof)\/?$/.test(req.path)) return next("router");
  res.set("Cache-Control", "no-store"); next();
});
router.use(authenticate, authorize("student", "faculty", "dean"));
const actorFor = req => ({ id: req.user.id, role: req.user.role, management: Boolean(req.deanManagementAccess) });
router.get("/:id/attendance", async (req, res) => {
  res.json({ attendance: await readAttendance({ id: req.params.id, actor: actorFor(req) }) });
});
router.get("/:id/attendance-proof", async (req, res) => {
  const proof = await readOutcomeProof({ id: req.params.id, actor: actorFor(req) });
  const bytes = await documentContent(proof);
  res.set(documentHeaders(proof)).send(bytes);
});
router.post("/:id/attendance-responses", outcomeProofUpload, async (req, res) => {
  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") return res.status(400).json({ message: "Invalid attendance response." });
  await processAttendance({ id: req.params.id, actor: actorFor(req), input: { ...req.body, ...(req.file && { proofFile: req.file }) } });
  res.status(201).json({ message: "Consultation outcome submitted." });
});
router.post("/:id/attendance-dispute", async (req, res) => {
  if (!req.body || Object.keys(req.body).some(key => key !== "reason")) return res.status(400).json({ message: "Invalid dispute request." });
  await disputeInitiatorOutcome({ id: req.params.id, actor: actorFor(req), reason: req.body.reason });
  res.json({ message: "The outcome was sent for Dean review." });
});
export default router;
