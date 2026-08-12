import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { now, type CommandType, type NodeRecord } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { createUpdateRouter } from "./routes.js";
import { UpdateService } from "./updateService.js";
import { UpdateStore } from "./store.js";

class StaticControlPort implements ControlPort {
  constructor(private readonly nodes: NodeRecord[]) {}
  async listNodes() {
    return this.nodes;
  }
  async createCommand(nodeId: string, type: CommandType, payload: Record<string, unknown>) {
    return { id: "cmd_1", nodeId, type, payload, status: "sent" as const, createdAt: now() };
  }
  async getCommand(id: string) {
    return { id, nodeId: "n1", type: "apply_update" as const, payload: {}, status: "running" as const, createdAt: now() };
  }
}

describe("update router", () => {
  let dir: string;
  let app: express.Express;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-update-routes-"));
    const store = new UpdateStore(dir);
    await store.init();
    const control = new StaticControlPort([{ id: "n1", name: "node-1", group: "default", status: "online", services: [], registeredAt: now(), labels: {} }]);
    const service = new UpdateService({ store, control });
    app = express();
    app.use(express.json());
    app.use("/api/v1/updates", createUpdateRouter(service));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("publishes and lists manifests", async () => {
    const create = await request(app).post("/api/v1/updates/manifests").send({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    expect(create.status).toBe(201);
    expect((await request(app).get("/api/v1/updates/manifests")).body).toHaveLength(1);
  });

  it("rejects an invalid manifest", async () => {
    expect((await request(app).post("/api/v1/updates/manifests").send({})).status).toBe(400);
  });

  it("starts a rollout and retrieves it", async () => {
    await request(app).post("/api/v1/updates/manifests").send({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    const start = await request(app).post("/api/v1/updates/rollouts").send({ version: "1.0.0" });
    expect(start.status).toBe(202);
    expect((await request(app).get(`/api/v1/updates/rollouts/${start.body.id}`)).status).toBe(200);
  });

  it("404s for an unknown rollout", async () => {
    expect((await request(app).get("/api/v1/updates/rollouts/rollout_nope")).status).toBe(404);
  });

  it("rejects starting a rollout for an unpublished version", async () => {
    const res = await request(app).post("/api/v1/updates/rollouts").send({ version: "9.9.9" });
    expect(res.status).toBe(400);
  });
});
