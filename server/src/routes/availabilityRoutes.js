import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import {
  createAvailability,
  deleteAvailability,
  getAvailableFaculty,
  getFacultyAvailability,
  getAvailabilityDetails,
  getMyAvailability,
  getAppointmentRequestSchedules,
  requestFacultyReschedule,
  updateAvailability,
} from "../controllers/availabilityController.js";

const router = Router();
router.get("/faculty", authenticate, authorize("student"), getAvailableFaculty);
router.get(
  "/faculty/:facultyId",
  authenticate,
  authorize("student", "faculty", "dean"),
  getFacultyAvailability,
);
router.get("/mine", authenticate, authorize("faculty", "dean"), getMyAvailability);
router.get(
  "/request-schedules",
  authenticate,
  authorize("faculty", "dean"),
  getAppointmentRequestSchedules,
);
router.get(
  "/:id/details",
  authenticate,
  authorize("faculty", "dean"),
  getAvailabilityDetails,
);
router.put(
  "/:id/appointments/:appointmentId/request-reschedule",
  authenticate,
  authorize("faculty", "dean"),
  requestFacultyReschedule,
);
router.post("/", authenticate, authorize("faculty", "dean"), createAvailability);
router.put("/:id", authenticate, authorize("faculty", "dean"), updateAvailability);
router.delete("/:id", authenticate, authorize("faculty", "dean"), deleteAvailability);

export default router;
