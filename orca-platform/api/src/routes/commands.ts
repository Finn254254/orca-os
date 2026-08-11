import { Router } from "express";
import type { ControlClient } from "../controlClient.js";
import { requireAuth } from "../middleware/auth.js";
import { param } from "../routeParam.js";

export function createCommandsRouter(control: ControlClient, sessionSecret: string): Router {
  const router = Router();
  router.use(requireAuth(sessionSecret));

  router.get("/", async (req, res) => {
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : undefined;
    res.json(await control.listCommands(nodeId));
  });

  router.get("/:id", async (req, res) => {
    res.json(await control.getCommand(param(req.params.id)));
  });

  return router;
}
