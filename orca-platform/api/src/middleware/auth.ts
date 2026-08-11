import type { NextFunction, Request, Response } from "express";
import { verifySessionToken, type SessionPayload } from "@orca/security";

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionPayload;
  }
}

export function requireAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const payload = verifySessionToken(token, secret);
    if (!payload) {
      res.status(401).json({ error: "invalid or expired token" });
      return;
    }
    req.user = payload;
    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "insufficient permissions" });
      return;
    }
    next();
  };
}
