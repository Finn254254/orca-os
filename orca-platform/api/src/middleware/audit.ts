import type { NextFunction, Request, Response } from "express";
import type { AuditLog } from "@orca/security";

/**
 * Records every non-GET /api/v1 request that didn't fail with a server
 * error. Applied globally so every subsystem's mutating actions are
 * audited without each route file needing to call the audit log itself.
 */
export function auditMiddleware(audit: AuditLog) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET") {
      next();
      return;
    }
    res.on("finish", () => {
      if (res.statusCode >= 500) return;
      // req.originalUrl (not req.path/req.url, which get trimmed while routing through
      // mounted sub-routers) stays the full request path for the whole request lifecycle.
      const path = req.originalUrl.split("?")[0];
      const loginAttempt = path === "/api/v1/auth/login" && typeof req.body?.username === "string";
      const actor = req.user
        ? `${req.user.username} (${req.user.role})`
        : loginAttempt
          ? `${req.body.username} (unauthenticated)`
          : "anonymous";
      void audit.record({
        actor,
        action: `${req.method} ${path}`,
        detail: { status: res.statusCode },
      });
    });
    next();
  };
}
