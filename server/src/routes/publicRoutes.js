import { Router } from "express";
import { getPublicStats } from "../controllers/publicController.js";
const router = Router();
router.get("/stats", getPublicStats);
export default router;
