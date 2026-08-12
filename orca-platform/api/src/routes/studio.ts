import { Router, type Request, type Response } from "express";
import { StudioWorkflowStepSchema } from "@orca/shared";
import { param } from "../routeParam.js";
import { NotFoundError, StudioService } from "../studioService.js";

/** Router for /api/v1/studio — Orca Studio's agent configs, workflows, and testing-console runs. Every resource here is per-user, so it's mounted behind auth only (no admin/operator writeGuard), same as Orca AI's conversations router. */
export function createStudioRouter(studio: StudioService): Router {
  const router = Router();

  // ---- Agent configs ----

  router.get("/agents", (req: Request, res: Response) => {
    res.json(studio.listAgentConfigs(req.user!.userId));
  });

  router.post("/agents", async (req: Request, res: Response) => {
    const { name, systemPrompt, model, tools } = req.body ?? {};
    if (typeof name !== "string" || !name || typeof systemPrompt !== "string" || typeof model !== "string" || !model) {
      res.status(400).json({ error: "name, systemPrompt, and model (strings) are required" });
      return;
    }
    if (tools !== undefined && (!Array.isArray(tools) || !tools.every((t) => typeof t === "string"))) {
      res.status(400).json({ error: "tools must be an array of strings" });
      return;
    }
    const config = await studio.createAgentConfig(req.user!.userId, { name, systemPrompt, model, tools });
    res.status(201).json(config);
  });

  router.get("/agents/:id", (req: Request, res: Response) => {
    const config = studio.getOwnedAgentConfig(req.user!.userId, param(req.params.id));
    if (!config) {
      res.status(404).json({ error: "agent config not found" });
      return;
    }
    res.json(config);
  });

  router.put("/agents/:id", async (req: Request, res: Response) => {
    const { name, systemPrompt, model, tools } = req.body ?? {};
    if (tools !== undefined && (!Array.isArray(tools) || !tools.every((t: unknown) => typeof t === "string"))) {
      res.status(400).json({ error: "tools must be an array of strings" });
      return;
    }
    const updated = await studio.updateAgentConfig(req.user!.userId, param(req.params.id), { name, systemPrompt, model, tools });
    if (!updated) {
      res.status(404).json({ error: "agent config not found" });
      return;
    }
    res.json(updated);
  });

  router.delete("/agents/:id", async (req: Request, res: Response) => {
    const deleted = await studio.deleteAgentConfig(req.user!.userId, param(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "agent config not found" });
      return;
    }
    res.status(204).send();
  });

  router.post("/agents/:id/run", async (req: Request, res: Response) => {
    const input = req.body?.input;
    if (typeof input !== "string" || !input) {
      res.status(400).json({ error: "input (string) is required" });
      return;
    }
    try {
      const run = await studio.runAgent(req.user!.userId, param(req.params.id), input);
      res.status(202).json(run);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // ---- Workflows ----

  router.get("/workflows", (req: Request, res: Response) => {
    res.json(studio.listWorkflows(req.user!.userId));
  });

  router.post("/workflows", async (req: Request, res: Response) => {
    const { name, steps } = req.body ?? {};
    const stepsResult = StudioWorkflowStepSchema.array().min(1).safeParse(steps);
    if (typeof name !== "string" || !name || !stepsResult.success) {
      res.status(400).json({ error: "name (string) and steps (non-empty array of {agentConfigId}) are required" });
      return;
    }
    const workflow = await studio.createWorkflow(req.user!.userId, { name, steps: stepsResult.data });
    res.status(201).json(workflow);
  });

  router.get("/workflows/:id", (req: Request, res: Response) => {
    const workflow = studio.getOwnedWorkflow(req.user!.userId, param(req.params.id));
    if (!workflow) {
      res.status(404).json({ error: "workflow not found" });
      return;
    }
    res.json(workflow);
  });

  router.put("/workflows/:id", async (req: Request, res: Response) => {
    const { name, steps } = req.body ?? {};
    let parsedSteps: unknown;
    if (steps !== undefined) {
      const stepsResult = StudioWorkflowStepSchema.array().min(1).safeParse(steps);
      if (!stepsResult.success) {
        res.status(400).json({ error: "steps must be a non-empty array of {agentConfigId}" });
        return;
      }
      parsedSteps = stepsResult.data;
    }
    const updated = await studio.updateWorkflow(req.user!.userId, param(req.params.id), { name, steps: parsedSteps as never });
    if (!updated) {
      res.status(404).json({ error: "workflow not found" });
      return;
    }
    res.json(updated);
  });

  router.delete("/workflows/:id", async (req: Request, res: Response) => {
    const deleted = await studio.deleteWorkflow(req.user!.userId, param(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "workflow not found" });
      return;
    }
    res.status(204).send();
  });

  router.post("/workflows/:id/run", async (req: Request, res: Response) => {
    const input = req.body?.input;
    if (typeof input !== "string" || !input) {
      res.status(400).json({ error: "input (string) is required" });
      return;
    }
    try {
      const run = await studio.runWorkflow(req.user!.userId, param(req.params.id), input);
      res.status(202).json(run);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // ---- Runs (testing-console history) ----

  router.get("/runs", (req: Request, res: Response) => {
    res.json(studio.listRuns(req.user!.userId));
  });

  router.get("/runs/:id", (req: Request, res: Response) => {
    const run = studio.getOwnedRun(req.user!.userId, param(req.params.id));
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    res.json(run);
  });

  return router;
}
