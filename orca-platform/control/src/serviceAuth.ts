import type { NextFunction, Request, Response } from "express";
import { constantTimeEqual } from "@orca/shared";

/**
 * Optional service-to-service auth for Control's REST API. By default
 * Control's REST API assumes a trusted internal network (no auth), same
 * as it always has — set ORCA_CONTROL_SERVICE_TOKEN to require callers
 * (Orca API) to present it as a Bearer token. /health stays open either
 * way so orchestration/health checks don't need the token.
 */
export function requireServiceToken(serviceToken?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!serviceToken || req.path === "/health") {
      next();
      return;
    }
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token || !constantTimeEqual(token, serviceToken)) {
      res.status(401).json({ error: "missing or invalid service token" });
      return;
    }
    next();
  };
}
