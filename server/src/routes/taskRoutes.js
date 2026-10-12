import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import {
  completeTask,
  createTask,
  getTasks,
} from "../controllers/taskController.js";
const router = Router();
router.use(authenticate, authorize("student", "faculty", "dean"));
router.get("/", getTasks);
router.post("/", authorize("faculty", "dean"), createTask);
router.put("/:id/complete", authorize("student"), completeTask);
export default router;
