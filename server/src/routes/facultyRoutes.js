import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate, authorize } from "../middleware/auth.js";
import { postFacultyReport } from "../controllers/facultyReportController.js";
import { rescheduleFacultyAppointment } from "../controllers/facultyAppointmentController.js";
import { calendarDateAtManilaMidnight, calendarEvent, CALENDAR_STATUSES, facultyCalendar } from "../services/facultyCalendarService.js";
const router = Router();
router.use(authenticate, authorize("faculty", "dean"));
router.post("/reports/pdf", rateLimit({ windowMs: 60000, limit: 4, keyGenerator: req => String(req.user.id), standardHeaders: "draft-7", legacyHeaders: false }), postFacultyReport);
router.get("/calendar", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { res.json(await facultyCalendar({ faculty: req.user.id, input: req.query })); }
  catch (error) {
    const status = [400, 422].includes(error.statusCode) ? error.statusCode : 503;
    res.status(status).json({ message: status === 503 ? "Calendar temporarily unavailable. Please try again." : error.message });
  }
});
router.patch("/appointments/:appointmentId/reschedule", rescheduleFacultyAppointment);
export const facultyCalendarInternals = { CALENDAR_STATUSES, calendarDateAtManilaMidnight, calendarEvent };
export default router;
