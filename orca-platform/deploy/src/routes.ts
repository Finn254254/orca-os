import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { AppManifestSchema } from "@orca/shared";
import type { DeployService } from "./deployService.js";

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

const noopMiddleware: RequestHandler = (_req, _res, next: NextFunction) => next();

/** Router for /api/v1/apps. */
export function createAppsRouter(deploy: DeployService, writeGuard: RequestHandler = noopMiddleware): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json(deploy.listDeployments());
  });

  router.post("/", writeGuard, async (req: Request, res: Response) => {
    const parsed = AppManifestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.status(202).json(await deploy.deployApp(parsed.data));
  });

  router.get("/:id", (req: Request, res: Response) => {
    const deployment = deploy.getDeployment(param(req.params.id));
    if (!deployment) {
      res.status(404).json({ error: "deployment not found" });
      return;
    }
    res.json(deployment);
  });

  router.delete("/:id", writeGuard, async (req: Request, res: Response) => {
    const deployment = await deploy.removeApp(param(req.params.id));
    if (!deployment) {
      res.status(404).json({ error: "deployment not found" });
      return;
    }
    res.json(deployment);
  });

  return router;
}
