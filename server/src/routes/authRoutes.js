import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  changePassword,
  login,
  logout,
  me,
  removeProfilePicture,
  updateProfile,
  updateProfilePicture,
} from "../controllers/authController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { profilePictureUpload } from "../middleware/profilePictureUpload.js";

import { accountLimit, accountMutation } from "../middleware/accountSecurity.js";

const router = Router();
const profileLimit = accountLimit(20);
const avatarLimit = accountLimit(10);
const passwordLimit = accountLimit(5);
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many authentication attempts. Please try again later." },
});
router.post("/login/:role", limiter, login);
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, me);
router.put("/me", authenticate, authorize("student", "faculty", "dean"), profileLimit, accountMutation("profile"), updateProfile);
router.patch(
  "/me/profile-picture",
  authenticate,
  authorize("student", "faculty", "dean"),
  avatarLimit,
  accountMutation("avatar"),
  profilePictureUpload,
  updateProfilePicture,
);
router.delete(
  "/me/profile-picture",
  authenticate,
  authorize("student", "faculty", "dean"),
  avatarLimit,
  accountMutation("avatar"),
  removeProfilePicture,
);
router.put("/change-password", authenticate, authorize("student", "faculty", "dean"), passwordLimit, accountMutation("password"), changePassword);
export default router;
