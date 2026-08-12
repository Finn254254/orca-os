import { Router, type NextFunction, type Request, type Response } from "express";
import { DevicePlatformSchema, NotificationKindSchema } from "@orca/shared";
import type { SessionPayload } from "@orca/security";
import { AppBackendService } from "./appBackendService.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionPayload;
  }
}

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Router for /api/v1/app — the mobile/desktop client support surface.
 * `/discover` is deliberately left open (a client needs to identify a
 * server before it has a session token to authenticate with); every other
 * route requires auth (applied per-route here, not at the mount level, so
 * `/discover` can stay public while sharing this router). Notification
 * send is additionally gated to admin/operator via `writeGuard` since it
 * can broadcast to every user.
 */
export function createAppBackendRouter(app: AppBackendService, requireAuth: Middleware, writeGuard: Middleware): Router {
  const router = Router();

  router.get("/discover", async (_req: Request, res: Response) => {
    res.json(await app.discover());
  });

  router.get("/summary", requireAuth, async (_req: Request, res: Response) => {
    res.json(await app.summary());
  });

  // ---- Notifications ----

  router.get("/notifications", requireAuth, (req: Request, res: Response) => {
    const unreadOnly = req.query.unreadOnly === "true";
    res.json(app.listNotifications(req.user!.userId, unreadOnly));
  });

  router.post("/notifications", requireAuth, writeGuard, async (req: Request, res: Response) => {
    const kindResult = NotificationKindSchema.safeParse(req.body?.kind);
    const { title, message, userId, data } = req.body ?? {};
    if (!kindResult.success || typeof title !== "string" || !title || typeof message !== "string" || !message) {
      res.status(400).json({ error: "kind, title, and message (strings) are required" });
      return;
    }
    const sent = await app.sendNotification({ userId, kind: kindResult.data, title, message, data });
    res.status(201).json(sent);
  });

  router.post("/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    const notification = await app.markNotificationRead(req.user!.userId, param(req.params.id));
    if (!notification) {
      res.status(404).json({ error: "notification not found" });
      return;
    }
    res.json(notification);
  });

  router.post("/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
    const count = await app.markAllNotificationsRead(req.user!.userId);
    res.json({ marked: count });
  });

  // ---- Devices ----

  router.get("/devices", requireAuth, (req: Request, res: Response) => {
    res.json(app.listDevices(req.user!.userId));
  });

  router.post("/devices", requireAuth, async (req: Request, res: Response) => {
    const platformResult = DevicePlatformSchema.safeParse(req.body?.platform);
    const pushToken = req.body?.pushToken;
    if (!platformResult.success || typeof pushToken !== "string" || !pushToken) {
      res.status(400).json({ error: "platform and pushToken (string) are required" });
      return;
    }
    const device = await app.registerDevice(req.user!.userId, platformResult.data, pushToken, req.body?.label);
    res.status(201).json(device);
  });

  router.delete("/devices/:id", requireAuth, async (req: Request, res: Response) => {
    const removed = await app.unregisterDevice(req.user!.userId, param(req.params.id));
    if (!removed) {
      res.status(404).json({ error: "device not found" });
      return;
    }
    res.status(204).send();
  });

  return router;
}
