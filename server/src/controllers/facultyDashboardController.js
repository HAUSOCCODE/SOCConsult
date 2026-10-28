import { readFacultyDashboard } from "../services/facultyDashboardService.js";

export async function getFacultyDashboard(req, res) {
  if (Object.keys(req.query || {}).length) return res.status(400).json({ message: "Dashboard query parameters are not supported." });
  const now = new Date();
  res.json(await readFacultyDashboard(req.user, now));
}
