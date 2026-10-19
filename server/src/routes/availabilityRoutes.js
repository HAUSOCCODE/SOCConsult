import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { calendarAvailabilityDetails } from "../services/calendarAvailabilityDetails.js";
import {
  createAvailability,
  deleteAvailability,
  getAvailableFaculty,
  getFacultyAvailability,
  getAvailabilityDetails,
  getMyAvailability,
  getAppointmentRequestSchedules,
  updateAvailability,
} from "../controllers/availabilityController.js";

const router = Router();
router.get("/:id/calendar-details", authenticate, authorize("faculty", "dean"), async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { res.json(await calendarAvailabilityDetails({ faculty: req.user.id, id: req.params.id, input: req.query })); }
  catch (error) {
    const status = [400, 404].includes(error.statusCode) ? error.statusCode : 503;
    res.status(status).json({ message: status === 400 ? "Invalid availability filters." : status === 404 ? "Availability not found." : "Availability temporarily unavailable. Please try again." });
  }
});
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
router.post("/", authenticate, authorize("faculty", "dean"), createAvailability);
router.put("/:id", authenticate, authorize("faculty", "dean"), updateAvailability);
router.delete("/:id", authenticate, authorize("faculty", "dean"), deleteAvailability);

export default router;
