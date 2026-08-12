import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { JobSpecSchema } from "@orca/shared";
import type { JobService } from "./jobService.js";

/** Route params param — Express 5 types repeating params as `string | string[]`; our routes never repeat. */
function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

const noopMiddleware: RequestHandler = (_req, _res, next: NextFunction) => next();

/**
 * Router for /api/v1/jobs. Auth is intentionally not baked in here — the
 * caller (Orca API) mounts this behind its own auth middleware, same as
 * every other subsystem router. `writeGuard` is an optional extra
 * middleware (e.g. a role check) applied only to mutating routes
 * (submit/cancel), so read access can stay open to any authenticated role.
 */
export function createJobsRouter(jobs: JobService, writeGuard: RequestHandler = noopMiddleware): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json(jobs.listJobs());
  });

  router.post("/", writeGuard, async (req: Request, res: Response) => {
    const parsed = JobSpecSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const job = await jobs.submitJob(parsed.data);
    res.status(202).json(job);
  });

  router.get("/:id", (req: Request, res: Response) => {
    const job = jobs.getJob(param(req.params.id));
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(job);
  });

  router.post("/:id/cancel", writeGuard, async (req: Request, res: Response) => {
    const job = await jobs.cancelJob(param(req.params.id));
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(job);
  });

  return router;
}
