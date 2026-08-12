import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { now, type CommandType, type NodeRecord } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { DeployService } from "./deployService.js";
import { createAppsRouter } from "./routes.js";
import { AppStore } from "./store.js";

class StaticControlPort implements ControlPort {
  constructor(private readonly nodes: NodeRecord[]) {}
  async listNodes() {
    return this.nodes;
  }
  async createCommand(nodeId: string, type: CommandType, payload: Record<string, unknown>) {
    return { id: "cmd_1", nodeId, type, payload, status: "sent" as const, createdAt: now() };
  }
  async getCommand(id: string) {
    return { id, nodeId: "node_1", type: "deploy_app" as const, payload: {}, status: "running" as const, createdAt: now() };
  }
}

describe("apps router", () => {
  let dir: string;
  let app: express.Express;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-deploy-routes-"));
    const store = new AppStore(dir);
    await store.init();
    const control = new StaticControlPort([
      {
        id: "node_1",
        name: "node-1",
        group: "default",
        status: "online",
        services: [],
        registeredAt: now(),
        labels: {},
        capabilities: { cpuCores: 8, gpus: [], tags: [] },
      },
    ]);
    const deployService = new DeployService({ store, control });
    app = express();
    app.use(express.json());
    app.use("/api/v1/apps", createAppsRouter(deployService));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("rejects an invalid manifest", async () => {
    const res = await request(app).post("/api/v1/apps").send({});
    expect(res.status).toBe(400);
  });

  it("deploys and retrieves an app", async () => {
    const createRes = await request(app).post("/api/v1/apps").send({ name: "web", image: "nginx" });
    expect(createRes.status).toBe(202);
    expect(createRes.body.state).toBe("deploying");

    const getRes = await request(app).get(`/api/v1/apps/${createRes.body.id}`);
    expect(getRes.status).toBe(200);
  });

  it("404s for an unknown deployment", async () => {
    expect((await request(app).get("/api/v1/apps/app_nope")).status).toBe(404);
    expect((await request(app).delete("/api/v1/apps/app_nope")).status).toBe(404);
  });

  it("lists apps and removes one", async () => {
    const createRes = await request(app).post("/api/v1/apps").send({ name: "web", image: "nginx" });
    const listRes = await request(app).get("/api/v1/apps");
    expect(listRes.body).toHaveLength(1);

    const removeRes = await request(app).delete(`/api/v1/apps/${createRes.body.id}`);
    expect(removeRes.status).toBe(200);
    expect(removeRes.body.state).toBe("stopped");
  });
});
