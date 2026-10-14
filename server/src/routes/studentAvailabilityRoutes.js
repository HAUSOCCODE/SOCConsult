import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import {
  createStudentAvailability,
  deleteStudentAvailability,
  getStudentAvailability,
  updateStudentAvailability,
} from "../controllers/studentAvailabilityController.js";

const router = Router();
router.use(authenticate, authorize("student"));
router.get("/", getStudentAvailability);
router.post("/", createStudentAvailability);
router.put("/:id", updateStudentAvailability);
router.delete("/:id", deleteStudentAvailability);

export default router;
