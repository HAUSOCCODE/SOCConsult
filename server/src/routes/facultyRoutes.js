import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate, authorize } from "../middleware/auth.js";
import { chatWithRoleAi } from "../controllers/roleAiController.js";

const router = Router();
router.use(authenticate, authorize("faculty"));
router.post("/ai/chat", rateLimit({ windowMs: 60000, limit: 8, keyGenerator: (req) => String(req.user._id), standardHeaders: "draft-7", legacyHeaders: false, handler: (req, res) => res.status(429).json({ message: "You're sending requests a little too quickly. Please wait a moment and try again.", retryAfter: 60 }) }), chatWithRoleAi("faculty"));
export default router;
