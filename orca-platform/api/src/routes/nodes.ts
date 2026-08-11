import { Router } from "express";
import { CommandTypeSchema } from "@orca/shared";
import type { ControlClient } from "../controlClient.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { param } from "../routeParam.js";

export function createNodesRouter(control: ControlClient, sessionSecret: string): Router {
  const router = Router();
  router.use(requireAuth(sessionSecret));

  router.get("/", async (_req, res) => {
    res.json(await control.listNodes());
  });

  router.get("/:id", async (req, res) => {
    const node = await control.getNode(param(req.params.id));
    if (!node) {
      res.status(404).json({ error: "node not found" });
      return;
    }
    res.json(node);
  });

  router.get("/:id/metrics", async (req, res) => {
    res.json(await control.getNodeMetrics(param(req.params.id)));
  });

  router.get("/:id/commands", async (req, res) => {
    res.json(await control.listCommands(param(req.params.id)));
  });

  router.post("/:id/commands", requireRole("admin", "operator"), async (req, res) => {
    const typeResult = CommandTypeSchema.safeParse(req.body?.type);
    if (!typeResult.success) {
      res.status(400).json({ error: "invalid command type" });
      return;
    }
    const command = await control.createCommand(param(req.params.id), typeResult.data, req.body?.payload ?? {});
    res.status(202).json(command);
  });

  return router;
}
