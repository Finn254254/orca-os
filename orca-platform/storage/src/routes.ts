import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { StorageService } from "./storageService.js";
import { CreateLocationRequestSchema, CreatePoolRequestSchema, StorageLocationKindSchema } from "./types.js";

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

const noopMiddleware: RequestHandler = (_req, _res, next: NextFunction) => next();

/** Router for /api/v1/storage. */
export function createStorageRouter(storage: StorageService, writeGuard: RequestHandler = noopMiddleware): Router {
  const router = Router();

  router.get("/devices", async (_req: Request, res: Response) => {
    res.json(await storage.listDevices());
  });

  router.get("/capacity", async (_req: Request, res: Response) => {
    res.json(await storage.clusterCapacity());
  });

  router.get("/pools", (_req: Request, res: Response) => {
    res.json(storage.listPools());
  });

  router.post("/pools", writeGuard, async (req: Request, res: Response) => {
    const parsed = CreatePoolRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.status(201).json(await storage.createPool(parsed.data));
  });

  router.delete("/pools/:id", writeGuard, async (req: Request, res: Response) => {
    const deleted = await storage.deletePool(param(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "pool not found" });
      return;
    }
    res.status(204).send();
  });

  router.get("/locations", (req: Request, res: Response) => {
    const kindResult = StorageLocationKindSchema.safeParse(req.query.kind);
    res.json(storage.listLocations(kindResult.success ? kindResult.data : undefined));
  });

  router.post("/locations", writeGuard, async (req: Request, res: Response) => {
    const parsed = CreateLocationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.status(201).json(await storage.createLocation(parsed.data));
  });

  router.delete("/locations/:id", writeGuard, async (req: Request, res: Response) => {
    const deleted = await storage.deleteLocation(param(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "location not found" });
      return;
    }
    res.status(204).send();
  });

  return router;
}
