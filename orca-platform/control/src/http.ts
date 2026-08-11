import { Router, type Request, type Response } from "express";
import { CommandTypeSchema, NodeGroupSchema, type ClusterConfig } from "@orca/shared";
import type { ClusterStore } from "./store.js";
import type { MeshServer } from "@orca/mesh";

/** Our routes only ever use single (non-repeating) path params, so this narrows Express 5's `string | string[]` param type. */
function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export function createControlRouter(store: ClusterStore, mesh: MeshServer): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "orca-control", time: new Date().toISOString() });
  });

  router.get("/cluster/config", (_req, res) => {
    res.json(store.getClusterConfig());
  });

  router.put("/cluster/config", async (req: Request, res: Response) => {
    const patch = req.body as Partial<ClusterConfig>;
    const config = await store.updateClusterConfig(patch);
    res.json(config);
  });

  router.get("/cluster/groups", (_req, res) => {
    res.json(store.getClusterConfig().groups);
  });

  router.post("/cluster/groups", async (req: Request, res: Response) => {
    const parsed = NodeGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const config = await store.addGroup(parsed.data);
    res.status(201).json(config.groups);
  });

  router.get("/nodes", (_req, res) => {
    const nodes = store.listNodes().map((n) => ({ ...n, connected: mesh.isConnected(n.id) }));
    res.json(nodes);
  });

  router.get("/nodes/:id", (req: Request, res: Response) => {
    const node = store.getNode(param(req.params.id));
    if (!node) {
      res.status(404).json({ error: "node not found" });
      return;
    }
    res.json({ ...node, connected: mesh.isConnected(node.id) });
  });

  router.get("/nodes/:id/metrics", (req: Request, res: Response) => {
    const node = store.getNode(param(req.params.id));
    if (!node) {
      res.status(404).json({ error: "node not found" });
      return;
    }
    res.json(node.lastMetrics ?? null);
  });

  router.get("/nodes/:id/commands", (req: Request, res: Response) => {
    res.json(store.listCommands(param(req.params.id)));
  });

  router.post("/nodes/:id/commands", async (req: Request, res: Response) => {
    const node = store.getNode(param(req.params.id));
    if (!node) {
      res.status(404).json({ error: "node not found" });
      return;
    }
    const typeResult = CommandTypeSchema.safeParse(req.body?.type);
    if (!typeResult.success) {
      res.status(400).json({ error: "invalid command type" });
      return;
    }
    const command = await store.createCommand(node.id, typeResult.data, req.body?.payload ?? {});
    const delivered = mesh.sendCommand(command);
    const updated = delivered ? await store.markCommandStatus(command.id, "sent") : command;
    res.status(202).json(updated ?? command);
  });

  router.get("/commands/:id", (req: Request, res: Response) => {
    const command = store.getCommand(param(req.params.id));
    if (!command) {
      res.status(404).json({ error: "command not found" });
      return;
    }
    res.json(command);
  });

  router.get("/commands", (req: Request, res: Response) => {
    res.json(store.listCommands(typeof req.query.nodeId === "string" ? req.query.nodeId : undefined));
  });

  return router;
}
