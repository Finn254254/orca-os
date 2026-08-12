import cors from "cors";
import express, { type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { createLogger, type Logger } from "@orca/shared";
import type { HardwareBackend } from "./types.js";

export interface HardwareDaemonHandle {
  httpServer: Server;
  logger: Logger;
  close: () => Promise<void>;
}

export async function createHardwareDaemon(port: number, backend: HardwareBackend): Promise<HardwareDaemonHandle> {
  const logger = createLogger("orca-hardware-daemon");
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", service: "orca-hardware-daemon" }));

  app.get("/api/v1/temperatures", async (_req: Request, res: Response) => res.json(await backend.getTemperatures()));

  app.get("/api/v1/fans", async (_req: Request, res: Response) => res.json(await backend.getFans()));
  app.post("/api/v1/fans/:id", async (req: Request, res: Response) => {
    const targetPct = req.body?.targetPct;
    if (typeof targetPct !== "number") {
      res.status(400).json({ error: "targetPct (number) is required" });
      return;
    }
    try {
      res.json(await backend.setFanSpeed(String(req.params.id), targetPct));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "unknown fan" });
    }
  });

  app.get("/api/v1/power", async (_req: Request, res: Response) => res.json(await backend.getPower()));
  app.post("/api/v1/power", async (req: Request, res: Response) => {
    const state = req.body?.state;
    if (state !== "on" && state !== "standby" && state !== "off") {
      res.status(400).json({ error: 'state must be "on", "standby", or "off"' });
      return;
    }
    res.json(await backend.setPowerState(state));
  });

  app.get("/api/v1/leds", async (_req: Request, res: Response) => res.json(await backend.getLeds()));
  app.post("/api/v1/leds/:id", async (req: Request, res: Response) => {
    const on = req.body?.on;
    if (typeof on !== "boolean") {
      res.status(400).json({ error: "on (boolean) is required" });
      return;
    }
    try {
      res.json(await backend.setLed(String(req.params.id), on));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "unknown LED" });
    }
  });

  app.get("/api/v1/buttons", async (_req: Request, res: Response) => res.json(await backend.getRecentButtonEvents()));

  app.get("/api/v1/watchdog", async (_req: Request, res: Response) => res.json(await backend.getWatchdog()));
  app.post("/api/v1/watchdog/arm", async (req: Request, res: Response) => {
    const timeoutMs = req.body?.timeoutMs;
    if (typeof timeoutMs !== "number" || timeoutMs <= 0) {
      res.status(400).json({ error: "timeoutMs (positive number) is required" });
      return;
    }
    res.json(await backend.armWatchdog(timeoutMs));
  });
  app.post("/api/v1/watchdog/disarm", async (_req: Request, res: Response) => res.json(await backend.disarmWatchdog()));
  app.post("/api/v1/watchdog/pet", async (_req: Request, res: Response) => res.json(await backend.petWatchdog()));

  const httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  logger.info({ port }, "orca-hardware-daemon listening");

  return {
    httpServer,
    logger,
    close: () => new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve()))),
  };
}
