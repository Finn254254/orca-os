import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { ModelRuntimeSchema } from "@orca/shared";
import type { ModelService } from "./modelService.js";

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

const noopMiddleware: RequestHandler = (_req, _res, next: NextFunction) => next();

/** Router for /api/v1/models. See routes.ts in compute/ for the writeGuard pattern this mirrors. */
export function createModelsRouter(models: ModelService, writeGuard: RequestHandler = noopMiddleware): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json(models.listModels());
  });

  router.get("/:id", (req: Request, res: Response) => {
    const model = models.getModel(param(req.params.id));
    if (!model) {
      res.status(404).json({ error: "model not found" });
      return;
    }
    res.json(model);
  });

  router.post("/pull", writeGuard, async (req: Request, res: Response) => {
    const runtimeResult = ModelRuntimeSchema.safeParse(req.body?.runtime);
    const name = req.body?.name;
    if (!runtimeResult.success || typeof name !== "string" || !name) {
      res.status(400).json({ error: "runtime and name are required" });
      return;
    }
    try {
      const model = await models.pullModel(runtimeResult.data, name);
      res.status(202).json(model);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "pull failed" });
    }
  });

  router.delete("/:id", writeGuard, async (req: Request, res: Response) => {
    const deleted = await models.deleteModel(param(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "model not found" });
      return;
    }
    res.status(204).send();
  });

  return router;
}
