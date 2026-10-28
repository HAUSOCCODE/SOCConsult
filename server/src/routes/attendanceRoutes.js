import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { readAttendance, processAttendance } from "../services/attendanceService.js";
const router = Router();
router.use((req, res, next) => {
  if (!/^\/[^/]+\/attendance(?:-responses)?\/?$/.test(req.path)) return next("router");
  res.set("Cache-Control", "no-store"); next();
});
router.use(authenticate, authorize("student", "faculty", "dean"));
const actorFor = req => ({ id: req.user.id, role: req.user.role, management: Boolean(req.deanManagementAccess) });
router.get("/:id/attendance", async (req, res) => {
  res.json({ attendance: await readAttendance({ id: req.params.id, actor: actorFor(req) }) });
});
router.post("/:id/attendance-responses", async (req, res) => {
  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") return res.status(400).json({ message: "Invalid attendance response." });
  await processAttendance({ id: req.params.id, actor: actorFor(req), input: req.body });
  res.status(201).json({ message: "Attendance response submitted." });
});
export default router;
