import rateLimit from "express-rate-limit";

export const accountPaths = /^\/api\/auth\/(?:me|change-password|login\/faculty|logout)(?:\/|\?|$)/i;
export const accountNoStore = (req, res, next) => {
  if (accountPaths.test(req.originalUrl || "")) res.set("Cache-Control", "no-store");
  next();
};
export const accountLimit = (limit) => rateLimit({
  windowMs: 15 * 60 * 1000, limit,
  keyGenerator: req => String(req.user.id), standardHeaders: "draft-7", legacyHeaders: false,
  message: { message: "Too many account requests. Please try again later." },
});
// Bound to the request lifetime; conditional database writes also protect across processes.
const pending = new Set();
export const accountMutation = (kind) => (req, res, next) => {
  const key = String(req.user.id) + ":" + kind;
  if (pending.has(key)) return res.status(409).json({ message: "An account update is already in progress." });
  pending.add(key);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    pending.delete(key);
  };
  res.once("finish", release); res.once("close", release);
  next();
};
