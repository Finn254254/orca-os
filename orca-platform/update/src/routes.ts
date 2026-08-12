import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { RolloutStrategySchema } from "@orca/shared";
import type { UpdateService } from "./updateService.js";

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

const noopMiddleware: RequestHandler = (_req, _res, next: NextFunction) => next();

/** Router for /api/v1/updates. */
export function createUpdateRouter(update: UpdateService, writeGuard: RequestHandler = noopMiddleware): Router {
  const router = Router();

  router.get("/manifests", (_req: Request, res: Response) => {
    res.json(update.listManifests());
  });

  router.post("/manifests", writeGuard, async (req: Request, res: Response) => {
    const { version, artifactUrl, checksum, releaseNotes } = req.body ?? {};
    if (typeof version !== "string" || typeof artifactUrl !== "string" || typeof checksum !== "string") {
      res.status(400).json({ error: "version, artifactUrl, checksum (strings) are required" });
      return;
    }
    res.status(201).json(await update.publishManifest({ version, artifactUrl, checksum, releaseNotes }));
  });

  router.get("/rollouts", (_req: Request, res: Response) => {
    res.json(update.listRollouts());
  });

  router.post("/rollouts", writeGuard, async (req: Request, res: Response) => {
    const strategyResult = RolloutStrategySchema.safeParse(req.body?.strategy ?? "all-at-once");
    const version = req.body?.version;
    if (typeof version !== "string" || !strategyResult.success) {
      res.status(400).json({ error: "version (string) and a valid strategy are required" });
      return;
    }
    try {
      const rollout = await update.startRollout({
        version,
        targetNodeIds: req.body?.targetNodeIds,
        targetGroup: req.body?.targetGroup,
        strategy: strategyResult.data,
        stagePct: req.body?.stagePct,
      });
      res.status(202).json(rollout);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "could not start rollout" });
    }
  });

  router.get("/rollouts/:id", (req: Request, res: Response) => {
    const rollout = update.getRollout(param(req.params.id));
    if (!rollout) {
      res.status(404).json({ error: "rollout not found" });
      return;
    }
    res.json(rollout);
  });

  router.post("/rollouts/:id/continue", writeGuard, async (req: Request, res: Response) => {
    try {
      const rollout = await update.continueRollout(param(req.params.id));
      if (!rollout) {
        res.status(404).json({ error: "rollout not found" });
        return;
      }
      res.json(rollout);
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : "could not continue rollout" });
    }
  });

  router.post("/rollouts/:id/rollback", writeGuard, async (req: Request, res: Response) => {
    const rollout = await update.rollback(param(req.params.id));
    if (!rollout) {
      res.status(404).json({ error: "rollout not found" });
      return;
    }
    res.json(rollout);
  });

  return router;
}
