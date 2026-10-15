export const notFound = (_req, res) =>
  res.status(404).json({ message: "Route not found." });

export const errorHandler = (err, _req, res, _next) => {
  // Parser errors include raw request bodies, which may contain rejected credentials.
  if (_req.method === "POST" && /^\/api\/dean\/users\/[^/]+\/reset-password\/?(?:\?|$)/i.test(_req.originalUrl || "")) {
    res.set("Cache-Control", "no-store");
    const status = err?.type === "entity.too.large" ? 413 : err?.type === "entity.parse.failed" ? 400 : 503;
    return res.status(status).json({ message: status === 503 ? "Password reset is temporarily unavailable." : "Invalid password reset request." });
  }
  // Never log a status request body: it may contain an audit-only reason.
  if (_req.method === "PATCH" && /^\/api\/dean\/users\/[^/]+\/status\/?(?:\?|$)/i.test(_req.originalUrl || "")) {
    const status = err?.type === "entity.too.large" ? 413 : err?.type === "entity.parse.failed" ? 400 : 503;
    return res.status(status).json({ message: status === 503 ? "User management is temporarily unavailable." : "Invalid account status request." });
  }
  if (_req.method === "POST" && /^\/api\/dean\/users\/?(?:\?|$)/i.test(_req.originalUrl || "")) {
    res.set("Cache-Control", "no-store");
    const status = err?.type === "entity.too.large" ? 413 : err?.type === "entity.parse.failed" ? 400 : 503;
    return res.status(status).json({ message: status === 503 ? "Account creation is temporarily unavailable." : "Invalid account creation request." });
  }
  // Body-parser errors carry the raw body. Never log them for import requests.
  if (/^\/api\/dean\/account-imports(?:\/|$)/.test(_req.originalUrl || "")) {
    const status = err?.type === "entity.too.large" ? 413 : err?.type === "entity.parse.failed" ? 400 : 500;
    return res.status(status).json({ message: status === 500 ? "Account import is temporarily unavailable." : "Invalid account import request." });
  }
  if ([400, 403, 404, 409].includes(err?.statusCode))
    return res.status(err.statusCode).json({ message: err.message });
  console.error(err);
  if (err?.code === 11000)
    return res
      .status(409)
      .json({ message: "An account with those details already exists." });
  res.status(500).json({ message: "An unexpected server error occurred." });
};
