import { listReviews, reviewDetails, reviewOptions, submitReview } from "../services/attendanceReviewService.js";
const actor = req => ({ id: req.user.id, role: req.user.role, accountStatus: req.user.accountStatus, management: true });
const handle = work => async (req, res) => {
  try { await work(req, res); }
  catch (error) {
    const status = [400, 403, 404, 409].includes(error.statusCode) ? error.statusCode : 503;
    res.status(status).json({ message: status === 503 ? "Attendance review is temporarily unavailable. Please retry." : error.message });
  }
};
export const getReviews = handle(async (req, res) => res.json(await listReviews(req.query, actor(req))));
export const getReviewOptions = handle(async (req, res) => res.json(await reviewOptions(req.query, actor(req))));
export const getReview = handle(async (req, res) => {
  if (Object.keys(req.query).length) throw Object.assign(new Error("Invalid query."), { statusCode: 400 });
  res.json(await reviewDetails(req.params.id, actor(req)));
});
export const postReview = handle(async (req, res) => {
  if (Object.keys(req.query).length) throw Object.assign(new Error("Invalid query."), { statusCode: 400 });
  res.status(201).json(await submitReview({ id: req.params.id, actor: actor(req), input: req.body }));
});
