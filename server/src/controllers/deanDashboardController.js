import {
  parseDashboardRange,
  readDeanDashboard,
} from "../services/deanDashboardService.js";

export async function getDeanDashboard(req, res) {
  const parsed = parseDashboardRange(req.query);
  if (!parsed)
    return res
      .status(400)
      .json({
        message:
          "Choose valid start and end dates spanning no more than 366 days.",
      });
  try {
    return res.json(await readDeanDashboard(parsed));
  } catch {
    return res
      .status(503)
      .json({
        message: "Dashboard is temporarily unavailable. Please try again.",
      });
  }
}
