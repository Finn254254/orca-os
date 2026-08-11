import { Router } from "express";
import { NodeGroupSchema } from "@orca/shared";
import type { ControlClient } from "../controlClient.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export function createClusterRouter(control: ControlClient, sessionSecret: string): Router {
  const router = Router();
  router.use(requireAuth(sessionSecret));

  router.get("/config", async (_req, res) => {
    res.json(await control.getClusterConfig());
  });

  router.put("/config", requireRole("admin"), async (req, res) => {
    res.json(await control.updateClusterConfig(req.body ?? {}));
  });

  router.get("/groups", async (_req, res) => {
    res.json(await control.listGroups());
  });

  router.post("/groups", requireRole("admin", "operator"), async (req, res) => {
    const parsed = NodeGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.status(201).json(await control.createGroup(parsed.data));
  });

  return router;
}
