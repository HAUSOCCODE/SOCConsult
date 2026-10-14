import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { env } from "../config/env.js";

export async function authenticate(req, res, next) {
  try {
    const value = req.headers.authorization || "";
    const token = value.startsWith("Bearer ") ? value.slice(7) : null;
    if (!token)
      return res.status(401).json({ message: "Authentication required." });
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user)
      return res.status(401).json({ message: "Account no longer exists." });
    if (user.accountStatus !== "Active")
      return res.status(403).json({ message: "This account is inactive." });
    if (user.role === "faculty" && user.registrationStatus !== "Approved")
      return res.status(403).json({
        message:
          user.registrationStatus === "Rejected"
            ? "Your registration request was rejected. Please contact the School of Computing dean."
            : "Your registration is awaiting dean approval.",
      });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired session." });
  }
}

export const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ message: "Unauthorized for this role." });
    next();
  };
