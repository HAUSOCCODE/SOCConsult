import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  changePassword,
  login,
  me,
  register,
  removeProfilePicture,
  updateProfile,
  updateProfilePicture,
} from "../controllers/authController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { profilePictureUpload } from "../middleware/profilePictureUpload.js";

const router = Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
router.post("/register/:role", limiter, register);
router.post("/login/:role", limiter, login);
router.get("/me", authenticate, me);
router.put("/me", authenticate, updateProfile);
router.patch(
  "/me/profile-picture",
  authenticate,
  authorize("student", "faculty", "dean"),
  limiter,
  profilePictureUpload,
  updateProfilePicture,
);
router.delete(
  "/me/profile-picture",
  authenticate,
  authorize("student", "faculty", "dean"),
  limiter,
  removeProfilePicture,
);
router.put("/change-password", authenticate, limiter, changePassword);
export default router;
