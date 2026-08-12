import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { BackupService } from "./backupService.js";
import { CreateBackupRequestSchema, CreateRestoreRequestSchema, CreateScheduleRequestSchema } from "./types.js";

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

const noopMiddleware: RequestHandler = (_req, _res, next: NextFunction) => next();

/** Router for /api/v1/backups. */
export function createBackupRouter(backup: BackupService, writeGuard: RequestHandler = noopMiddleware): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => res.json(backup.listJobs()));

  router.post("/", writeGuard, async (req: Request, res: Response) => {
    const parsed = CreateBackupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.status(202).json(await backup.runBackup(parsed.data.kind, parsed.data.targetId));
  });

  router.get("/:id", (req: Request, res: Response) => {
    const job = backup.getJob(param(req.params.id));
    if (!job) {
      res.status(404).json({ error: "backup job not found" });
      return;
    }
    res.json(job);
  });

  router.get("/schedules/list", (_req: Request, res: Response) => res.json(backup.listSchedules()));

  router.post("/schedules", writeGuard, async (req: Request, res: Response) => {
    const parsed = CreateScheduleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.status(201).json(await backup.createSchedule(parsed.data));
  });

  router.delete("/schedules/:id", writeGuard, async (req: Request, res: Response) => {
    const deleted = await backup.deleteSchedule(param(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "schedule not found" });
      return;
    }
    res.status(204).send();
  });

  router.get("/restores/list", (_req: Request, res: Response) => res.json(backup.listRestores()));

  router.post("/restores", writeGuard, async (req: Request, res: Response) => {
    const parsed = CreateRestoreRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(await backup.recordRestore(parsed.data));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "could not record restore" });
    }
  });

  return router;
}
